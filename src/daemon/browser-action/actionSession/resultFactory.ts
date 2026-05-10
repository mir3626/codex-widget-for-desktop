import { randomUUID } from "node:crypto";
import type {
  BrowserAction,
  BrowserActionApproval,
  BrowserActionResult,
  BrowserActionSafetyDecision,
  BrowserActionSession,
  BrowserObservation,
  TargetResolution
} from "../types.js";

export function createPendingBrowserActionResult(
  input: {
    session: BrowserActionSession;
    adapterId?: string;
    action: BrowserAction;
  },
  observation: BrowserObservation,
  targetResolution: TargetResolution,
  safety: BrowserActionSafetyDecision
): BrowserActionResult {
  return {
    id: `browser-result-${randomUUID()}`,
    actionSessionId: input.session.id,
    adapterId: input.adapterId,
    action: input.action,
    target: targetResolution.primary,
    alternatives: targetResolution.alternatives,
    startedAt: new Date().toISOString(),
    status: "pending",
    safety,
    before: observation,
    verification: { status: "unknown", reason: "Action has not completed yet." }
  };
}

export function createBrowserActionApproval(
  input: {
    session: BrowserActionSession;
    adapterId?: string;
    action: BrowserAction;
  },
  result: BrowserActionResult,
  target: BrowserActionResult["target"],
  safety: BrowserActionResult["safety"]
): BrowserActionApproval {
  result.status = "needs_approval";
  result.completedAt = new Date().toISOString();
  return {
    id: `browser-approval-${randomUUID()}`,
    actionSessionId: input.session.id,
    resultId: result.id,
    adapterId: input.adapterId,
    createdAt: new Date().toISOString(),
    action: input.action,
    target,
    safety
  };
}
