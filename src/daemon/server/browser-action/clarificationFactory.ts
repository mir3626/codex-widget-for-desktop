import type {
  BrowserAction,
  BrowserActionResult
} from "../../browser-action/index.js";
import { cryptoRandomId } from "../runtimeActivity.js";
import { uniqueBrowserElements } from "./clarificationTarget.js";
import type { PendingSemanticClarification } from "./clarificationTypes.js";

export function createSemanticTargetClarification(input: {
  requestId?: string;
  sessionId: string;
  actionSessionId: string;
  adapterId?: string;
  action?: BrowserAction;
  utterance: string;
  targetHint?: string;
  latestResult?: BrowserActionResult;
}): PendingSemanticClarification | undefined {
  if (!input.action || input.latestResult?.status !== "needs_clarification") {
    return undefined;
  }
  const candidates = uniqueBrowserElements([
    input.latestResult.target,
    ...(input.latestResult.alternatives ?? [])
  ]).slice(0, 5);
  if (candidates.length === 0) {
    return undefined;
  }
  return {
    id: `semantic-clarification-${cryptoRandomId()}`,
    requestId: input.requestId,
    sessionId: input.sessionId,
    actionSessionId: input.actionSessionId,
    adapterId: input.adapterId,
    action: input.action,
    utterance: input.utterance,
    transactionId: input.latestResult.transaction?.transactionId,
    targetHint: input.targetHint,
    observationUrl: input.latestResult.before?.url,
    candidates
  };
}
