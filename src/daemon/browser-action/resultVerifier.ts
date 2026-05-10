import { verifyExpectedBrowserEffects } from "./interaction/verificationResolver.js";
import type { BrowserAction, BrowserActionResult, BrowserExpectedState, BrowserObservation, BrowserVerificationResult } from "./types.js";

export function verifyBrowserAction(input: {
  action: BrowserAction;
  expected?: BrowserExpectedState[];
  before?: BrowserObservation;
  after?: BrowserObservation;
  ok?: boolean;
  error?: string;
}): BrowserVerificationResult {
  return verifyExpectedBrowserEffects(input);
}

export function summarizeBrowserActionResult(result: BrowserActionResult): Record<string, unknown> {
  return {
    id: result.id,
    actionSessionId: result.actionSessionId,
    adapterId: result.adapterId,
    action: result.action.type,
    status: result.status,
    transaction: result.transaction,
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
