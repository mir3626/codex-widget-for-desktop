import { randomUUID } from "node:crypto";
import { isDestructiveBrowserAction } from "./safetyPolicy.js";
import type {
  BrowserAction,
  BrowserActionMode,
  BrowserActionPolicy,
  BrowserActionPolicyInput,
  BrowserActionPolicyMatch,
  BrowserActionSafetyDecision,
  BrowserElement,
  BrowserObservation
} from "./types.js";

export const BROWSER_ACTION_POLICY_SETTING_KEY = "browser-action.policies.v1";

export function normalizeBrowserActionPolicy(input: BrowserActionPolicyInput, existing?: BrowserActionPolicy): BrowserActionPolicy {
  const now = new Date().toISOString();
  const id = sanitizePolicyId(input.id) || existing?.id || `browser-policy-${randomUUID()}`;
  return {
    id,
    decision: input.decision === "allow" || input.decision === "deny" ? input.decision : "ask",
    actionFamily: normalizeActionFamily(input.actionFamily),
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

export function matchBrowserActionPolicy(input: {
  policies: BrowserActionPolicy[];
  action: BrowserAction;
  target?: BrowserElement;
  observation?: BrowserObservation;
  mode: BrowserActionMode;
  safety: BrowserActionSafetyDecision;
}): BrowserActionPolicyMatch {
  const active = input.policies
    .filter((policy) => !policy.revokedAt && !isExpired(policy))
    .sort((left, right) => policySpecificity(right) - policySpecificity(left));
  const origin = normalizeOrigin(input.observation?.url);
  const risk = classifyActionRisk(input.action, input.target, input.safety);
  for (const policy of active) {
    if (!matchesActionFamily(policy.actionFamily, input.action)) {
      continue;
    }
    if (policy.mode && policy.mode !== "any" && policy.mode !== input.mode) {
      continue;
    }
    if (policy.origin && policy.origin !== origin) {
      continue;
    }
    if (policy.targetRisk && policy.targetRisk !== risk && policy.targetRisk !== input.safety.risk) {
      continue;
    }
    if (policy.decision === "allow" && isCredentialOrDestructiveRisk(risk) && !isExplicitHighRiskPolicy(policy)) {
      return {
        decision: "ask",
        policy,
        reason: "Saved policy matched, but destructive or credential-sensitive Browser Actions still require explicit confirmation."
      };
    }
    return {
      decision: policy.decision,
      policy,
      reason: `Matched Browser Action policy ${policy.id}.`
    };
  }
  return {
    decision: "ask",
    reason: "No Browser Action policy matched this action."
  };
}

export function applyBrowserActionPolicyToSafety(input: {
  safety: BrowserActionSafetyDecision;
  match?: BrowserActionPolicyMatch;
}): BrowserActionSafetyDecision {
  const match = input.match;
  if (!match || match.decision === "ask" || input.safety.decision === "block" || input.safety.decision === "clarify") {
    return input.safety;
  }
  if (match.decision === "deny") {
    return {
      ...input.safety,
      decision: "block",
      reason: `Saved Browser Action policy denied this action. ${match.reason}`,
      metadata: {
        ...input.safety.metadata,
        policyId: match.policy?.id,
        policyDecision: match.decision
      }
    };
  }
  return {
    ...input.safety,
    decision: input.safety.decision === "confirm" ? "allow" : input.safety.decision,
    reason: `${input.safety.reason} Saved Browser Action policy allowed this action. ${match.reason}`,
    metadata: {
      ...input.safety.metadata,
      policyId: match.policy?.id,
      policyDecision: match.decision
    }
  };
}

export function redactBrowserActionSecret(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactBrowserActionSecret);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|token|cookie|credential|payment|card|secret/i.test(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = redactBrowserActionSecret(item);
    }
  }
  return output;
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/(password|token|cookie|credential|payment|card|secret)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\b(?:sk|pk|ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{12,}\b/g, "[redacted-token]")
    .replace(/\b\d{12,19}\b/g, "[redacted-number]");
}

function classifyActionRisk(action: BrowserAction, target: BrowserElement | undefined, safety: BrowserActionSafetyDecision): "low" | "medium" | "high" | "destructive" | "credential" {
  if (target?.riskHints.some((hint) => hint === "password" || hint === "payment" || hint === "auth")) {
    return "credential";
  }
  if (isDestructiveBrowserAction(action, target) || safety.destructive) {
    return "destructive";
  }
  return safety.risk;
}

function isCredentialOrDestructiveRisk(risk: string): boolean {
  return risk === "credential" || risk === "destructive" || risk === "high";
}

function isExplicitHighRiskPolicy(policy: BrowserActionPolicy): boolean {
  return policy.targetRisk === "destructive" || policy.targetRisk === "credential";
}

function matchesActionFamily(family: BrowserActionPolicy["actionFamily"], action: BrowserAction): boolean {
  if (family === "all" || family === action.type) {
    return true;
  }
  if (family === "safe_read_scroll") {
    return action.type === "read" || action.type === "scroll" || action.type === "screenshot";
  }
  if (family === "safe_click_type") {
    return action.type === "click" || action.type === "type" || action.type === "select" || action.type === "check";
  }
  return false;
}

function policySpecificity(policy: BrowserActionPolicy): number {
  return [
    policy.origin ? 4 : 0,
    policy.targetRisk ? 3 : 0,
    policy.mode && policy.mode !== "any" ? 2 : 0,
    policy.actionFamily !== "all" ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
}

function isExpired(policy: BrowserActionPolicy): boolean {
  return Boolean(policy.expiresAt && Date.parse(policy.expiresAt) <= Date.now());
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

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "") || undefined;
  }
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
