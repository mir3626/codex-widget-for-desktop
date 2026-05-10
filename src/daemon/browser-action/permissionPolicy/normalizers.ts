import { createHash, randomUUID } from "node:crypto";
import type { BrowserActionApproval, BrowserActionPolicy, BrowserActionPolicyInput } from "../types.js";
import { redactSensitiveText } from "./redaction.js";

type AlwaysAllowPolicyInput = {
  approval: BrowserActionApproval;
  mode?: BrowserActionPolicyInput["mode"];
};

export function normalizeBrowserActionPolicy(input: BrowserActionPolicyInput, existing?: BrowserActionPolicy): BrowserActionPolicy {
  const now = new Date().toISOString();
  const id = sanitizePolicyId(input.id) || existing?.id || `browser-policy-${randomUUID()}`;
  return {
    id,
    decision: input.decision === "allow" || input.decision === "deny" ? input.decision : "ask",
    actionFamily: normalizeActionFamily(input.actionFamily),
    actionLabel: normalizeActionLabel(input.actionLabel),
    origin: normalizeOrigin(input.origin),
    targetRisk: normalizeTargetRisk(input.targetRisk),
    mode: normalizePolicyMode(input.mode),
    expiresAt: normalizeFutureDate(input.expiresAt),
    note: typeof input.note === "string" ? redactSensitiveText(input.note).slice(0, 240) : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revokedAt: existing?.revokedAt
  };
}

export function createAlwaysAllowBrowserActionPolicyInput(input: AlwaysAllowPolicyInput): BrowserActionPolicyInput {
  const risk = input.approval.safety.destructive ? "destructive" : normalizeTargetRisk(input.approval.safety.risk);
  const actionFamily = readGroupedActionFamily(input.approval);
  const specific = risk === "destructive" || risk === "credential" || risk === "high";
  const actionLabel = specific ? readBrowserActionApprovalPolicyLabel(input.approval) : undefined;
  const mode = "any";
  return {
    id: buildAlwaysAllowPolicyId({ actionFamily, actionLabel, mode, risk }),
    decision: "allow",
    actionFamily,
    actionLabel,
    targetRisk: risk,
    mode,
    note: buildAlwaysAllowPolicyNote({ actionFamily, actionLabel, risk })
  };
}

export function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "") || undefined;
  }
}

function normalizeActionFamily(value: BrowserActionPolicyInput["actionFamily"]): BrowserActionPolicy["actionFamily"] {
  const allowed = new Set<BrowserActionPolicy["actionFamily"]>([
    "read",
    "click",
    "type",
    "select",
    "check",
    "scroll",
    "navigate",
    "back",
    "forward",
    "reload",
    "hotkey",
    "screenshot",
    "evaluate",
    "safe_read_scroll",
    "safe_click_type",
    "all"
  ]);
  return allowed.has(value) ? value : "all";
}

function normalizePolicyMode(value: BrowserActionPolicyInput["mode"]): BrowserActionPolicy["mode"] {
  return value === "read_only" || value === "ask_before_action" || value === "auto_safe_actions" || value === "full_control_dev" || value === "any"
    ? value
    : "any";
}

function normalizeTargetRisk(value: BrowserActionPolicyInput["targetRisk"]): BrowserActionPolicy["targetRisk"] {
  return value === "low" || value === "medium" || value === "high" || value === "destructive" || value === "credential" ? value : undefined;
}

function normalizeActionLabel(value: string | undefined): string | undefined {
  return typeof value === "string" ? redactSensitiveText(value).replace(/\s+/g, " ").trim().slice(0, 240) || undefined : undefined;
}

function normalizeFutureDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && time > Date.now() ? new Date(time).toISOString() : undefined;
}

function sanitizePolicyId(value: string | undefined): string | undefined {
  return typeof value === "string" ? value.trim().replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 80) || undefined : undefined;
}

function readGroupedActionFamily(approval: BrowserActionApproval): BrowserActionPolicyInput["actionFamily"] {
  if (approval.action.type === "read" || approval.action.type === "scroll" || approval.action.type === "screenshot") {
    return "safe_read_scroll";
  }
  if (approval.action.type === "click" || approval.action.type === "type" || approval.action.type === "select" || approval.action.type === "check") {
    return "safe_click_type";
  }
  return approval.action.type;
}

function readBrowserActionApprovalPolicyLabel(approval: BrowserActionApproval): string {
  return [approval.safety.actionLabel, approval.safety.targetSummary].filter(Boolean).join(" ");
}

function buildAlwaysAllowPolicyId(input: {
  actionFamily: BrowserActionPolicyInput["actionFamily"];
  actionLabel?: string;
  mode: BrowserActionPolicyInput["mode"];
  origin?: string;
  risk?: BrowserActionPolicyInput["targetRisk"];
}): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 16);
  return `browser-policy-always-${hash}`;
}

function buildAlwaysAllowPolicyNote(input: {
  actionFamily: BrowserActionPolicyInput["actionFamily"];
  actionLabel?: string;
  risk?: BrowserActionPolicyInput["targetRisk"];
}): string {
  const label = input.actionLabel ? ` matching ${input.actionLabel}` : "";
  return `Always allow similar Browser Actions: ${input.actionFamily}${label}${input.risk ? ` (${input.risk} risk)` : ""}`;
}
