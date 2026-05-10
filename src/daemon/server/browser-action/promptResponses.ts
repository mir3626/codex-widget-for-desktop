import {
  summarizeBrowserActionResult,
  summarizeBrowserElement,
  type BrowserActionApproval,
  type BrowserActionPlan,
  type BrowserActionResult,
  type BrowserActionPromptPlan
} from "../../browser-action/index.js";
import { broadcastLedgerSnapshot } from "../clientEvents.js";
import { broadcast } from "../events.js";
import {
  buildSemanticTargetClarificationInteraction,
  createSemanticTargetClarification,
  renderSemanticTargetClarificationResponse
} from "./clarification.js";
import { buildBrowserActionApprovalBody, summarizePromptPlanTarget } from "./helpers.js";
import { renderBrowserPromptResponse, summarizeBrowserActionPlan } from "./presentation.js";
import type { BrowserActionPromptInput } from "./promptTypes.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";

export function emitPromptApprovalRequired(input: BrowserActionPromptInput, detail: {
  approval: BrowserActionApproval;
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
}): void {
  const latestResult = detail.results.at(-1);
  broadcast(input.clients, {
    type: "interaction.required",
    interaction: {
      id: detail.approval.id,
      requestId: input.message.id,
      kind: "approval",
      title: "Browser action approval",
      body: latestResult ? buildBrowserActionApprovalBody(latestResult) : "Browser Action requires approval.",
      action: `Browser action: ${detail.approval.safety.actionLabel}`
    }
  });
  completePromptWithResponse(input, renderBrowserPromptResponse(detail.plan, detail.results, "approval_required", input.message.text));
}

export function completePromptWithResult(input: BrowserActionPromptInput, detail: {
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
  runtimeSummary?: string;
}): void {
  broadcast(input.clients, {
    type: "browserAction.result",
    actionSessionId: detail.plan.actionSessionId,
    result: {
      plan: summarizeBrowserActionPlan(detail.plan),
      results: detail.results.map(summarizeBrowserActionResult)
    }
  });
  completePromptWithResponse(input, renderBrowserPromptResponse(detail.plan, detail.results, detail.plan.status, input.message.text));
  if (detail.runtimeSummary) {
    recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", detail.runtimeSummary, summarizeBrowserActionPlan(detail.plan));
  }
}

export function completePromptAsExtensionPending(input: BrowserActionPromptInput, plan: BrowserActionPlan, results: BrowserActionResult[]): void {
  completePromptWithResponse(input, renderBrowserPromptResponse(plan, results, "extension_pending", input.message.text));
}

export function completePromptWithResponse(input: BrowserActionPromptInput, text: string): void {
  input.emit({
    type: "message.completed",
    id: input.message.id,
    text
  });
  input.emit({ type: "session.state", state: "idle", id: input.message.id });
  broadcastLedgerSnapshot(input.clients, input.storage, input.sessionId);
}

export function requestPromptTargetClarification(input: BrowserActionPromptInput, detail: {
  promptPlan: BrowserActionPromptPlan;
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
}): boolean {
  const clarification = createSemanticTargetClarification({
    requestId: input.message.id,
    sessionId: input.sessionId,
    actionSessionId: detail.plan.actionSessionId,
    adapterId: detail.promptPlan.adapterId,
    action: detail.promptPlan.steps[0]?.action,
    utterance: input.message.text,
    targetHint: summarizePromptPlanTarget(detail.promptPlan),
    latestResult: detail.results.at(-1)
  });
  if (!clarification) {
    return false;
  }

  input.semanticClarifications.set(clarification.id, clarification);
  broadcast(input.clients, {
    type: "interaction.required",
    interaction: buildSemanticTargetClarificationInteraction(clarification)
  });
  completePromptWithResponse(input, renderSemanticTargetClarificationResponse(clarification, input.message.text));
  recordRuntimeActivity(input.storage, input.sessionId, "info", "semantic-memory", "Browser Action target clarification requested", {
    interactionId: clarification.id,
    actionSessionId: clarification.actionSessionId,
    candidates: clarification.candidates.map((candidate) => summarizeBrowserElement(candidate))
  });
  return true;
}
