import {
  type BrowserAction,
  type BrowserActionAuditEntry,
  type BrowserActionPlan,
  type BrowserActionResult
} from "../../browser-action/index.js";
import type { StorageService } from "../../storage/storage.js";
import type { ClientMessage } from "../../../shared/protocol.js";
import { cryptoRandomId, recordRuntimeActivity } from "../runtimeActivity.js";

export function normalizeBrowserActionPlan(input: {
  actionSessionId: string;
  input: Extract<ClientMessage, { type: "browserAction.plan" }>["plan"];
}): BrowserActionPlan {
  const now = new Date().toISOString();
  const id = typeof input.input.id === "string" && input.input.id.trim() ? input.input.id.trim() : `browser-plan-${cryptoRandomId()}`;
  return {
    id,
    actionSessionId: input.actionSessionId,
    createdAt: now,
    goal: input.input.goal.trim().slice(0, 500) || "Browser Action plan",
    adapterId: input.input.adapterId?.trim() || undefined,
    status: "proposed",
    expectedOutcome: typeof input.input.expectedOutcome === "string" ? input.input.expectedOutcome.slice(0, 500) : undefined,
    confidence: clampUnit(Number(input.input.confidence ?? 0.7)),
    steps: input.input.steps.map((step, index) => ({
      id: step.id?.trim() || `step-${index + 1}`,
      action: step.action as BrowserAction,
      targetSummary: step.targetSummary?.slice(0, 240),
      reason: step.reason?.slice(0, 500),
      expected: [],
      status: "pending"
    }))
  };
}

export function summarizePromptPlanTarget(plan: { goal?: string; steps: Array<{ action: BrowserAction }> }): string | undefined {
  return readBrowserActionTargetText(plan.steps[0]?.action) ?? plan.goal;
}

export function browserActionUrlsMatch(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeBrowserActionUrl(left);
  const normalizedRight = normalizeBrowserActionUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function recordBrowserActionAudit(storage: StorageService, audit: BrowserActionAuditEntry): void {
  recordRuntimeActivity(
    storage,
    resolveAuditSessionId(storage, audit.sessionId),
    audit.level,
    "browser-action",
    audit.summary,
    audit.detail
  );
}

export function buildBrowserActionApprovalBody(result: BrowserActionResult): string {
  const metadata = result.safety.metadata ?? {};
  const codePreview = typeof metadata.codePreview === "string" ? metadata.codePreview : "";
  const codeHash = typeof metadata.codeHash === "string" ? metadata.codeHash : "";
  const timeoutMs = typeof metadata.timeoutMs === "number" ? metadata.timeoutMs : undefined;
  const resultLimitBytes = typeof metadata.resultLimitBytes === "number" ? metadata.resultLimitBytes : undefined;
  return [
    result.safety.actionLabel,
    result.safety.targetSummary ? `Target: ${result.safety.targetSummary}` : "",
    `Risk: ${result.safety.risk}`,
    result.safety.reason,
    codeHash ? `Code SHA-256: ${codeHash}` : "",
    timeoutMs ? `Timeout: ${timeoutMs}ms` : "",
    resultLimitBytes ? `Result limit: ${resultLimitBytes} bytes` : "",
    codePreview ? `Code preview:\n${codePreview}` : ""
  ].filter(Boolean).join("\n");
}

function readBrowserActionTargetText(action: BrowserAction | undefined): string | undefined {
  if (!action || !("target" in action)) {
    return undefined;
  }
  const target = action.target;
  if (target?.kind === "text") return target.text;
  if (target?.kind === "selector") return target.selector;
  if (target?.kind === "element_id") return target.id;
  return undefined;
}

function normalizeBrowserActionUrl(value: string | undefined): string {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function resolveAuditSessionId(storage: StorageService, sessionId: string | undefined): string {
  const snapshot = storage.ensureSessionSnapshot();
  if (sessionId && snapshot.sessions.some((session) => session.id === sessionId)) {
    return sessionId;
  }
  return snapshot.activeSessionId;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
