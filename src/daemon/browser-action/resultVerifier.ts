import type { BrowserAction, BrowserActionResult, BrowserObservation, BrowserVerificationResult } from "./types.js";

export function verifyBrowserAction(input: {
  action: BrowserAction;
  before?: BrowserObservation;
  after?: BrowserObservation;
  ok?: boolean;
  error?: string;
}): BrowserVerificationResult {
  if (input.error) {
    return { status: "failed", reason: input.error };
  }
  if (input.ok === false) {
    return { status: "failed", reason: "Browser adapter reported failure." };
  }
  if (!input.after) {
    return { status: input.action.type === "read" ? "passed" : "unknown", reason: "No after observation was available." };
  }
  if (input.action.type === "navigate") {
    return input.after.url.includes(input.action.url)
      ? { status: "passed", reason: "After observation URL matches the requested navigation." }
      : { status: "unknown", reason: "Navigation command completed but URL did not exactly match the requested URL." };
  }
  if (input.before && input.after && input.before.id !== input.after.id) {
    return { status: "passed", reason: "Action returned a refreshed browser observation." };
  }
  return { status: "passed", reason: "Browser adapter completed the action." };
}

export function summarizeBrowserActionResult(result: BrowserActionResult): Record<string, unknown> {
  return {
    id: result.id,
    actionSessionId: result.actionSessionId,
    adapterId: result.adapterId,
    action: result.action.type,
    status: result.status,
    target: result.safety.targetSummary,
    risk: result.safety.risk,
    safety: result.safety.decision,
    verification: result.verification.status,
    reason: result.verification.reason,
    codeHash: typeof result.safety.metadata?.codeHash === "string" ? result.safety.metadata.codeHash : undefined,
    error: result.error,
    before: result.before ? { url: result.before.url, title: result.before.title, elements: result.before.elements.length } : undefined,
    after: result.after ? { url: result.after.url, title: result.after.title, elements: result.after.elements.length } : undefined
  };
}
