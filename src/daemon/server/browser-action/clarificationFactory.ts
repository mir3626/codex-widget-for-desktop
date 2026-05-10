import type {
  BrowserAction,
  BrowserActionPlan,
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
  plan?: BrowserActionPlan;
  results?: BrowserActionResult[];
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
  const clarifiedStep = input.plan?.steps.find((step) => step.resultId === input.latestResult?.id) ??
    input.plan?.steps.find((step) => step.status === "failed" || step.status === "running" || step.status === "awaiting_extension");
  return {
    id: `semantic-clarification-${cryptoRandomId()}`,
    requestId: input.requestId,
    sessionId: input.sessionId,
    actionSessionId: input.actionSessionId,
    adapterId: input.adapterId,
    action: input.action,
    utterance: input.utterance,
    transactionId: input.latestResult.transaction?.transactionId,
    plan: input.plan ? cloneJson(input.plan) : undefined,
    results: input.results ? cloneJson(input.results) : undefined,
    stepId: clarifiedStep?.id,
    targetHint: input.targetHint,
    observationUrl: input.latestResult.before?.url,
    candidates
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
