import {
  planBrowserActionFromPrompt,
  summarizeBrowserActionSession,
  summarizeBrowserObservation
} from "../../browser-action/index.js";
import { broadcast } from "../events.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import {
  normalizeBrowserActionPlan,
  recordBrowserActionAudit
} from "./helpers.js";
import { handlePromptExtensionCommand } from "./promptExtensionCommand.js";
import {
  completePromptWithResult,
  emitPromptApprovalRequired,
  requestPromptTargetClarification
} from "./promptResponses.js";
import { readFreshPromptBrowserSnapshot } from "./promptSnapshot.js";
import type { BrowserActionPromptInput } from "./promptTypes.js";
import {
  readBrowserSourceFromSnapshot,
  summarizeBrowserActionPlan
} from "./presentation.js";

export async function tryRunBrowserActionPrompt(input: BrowserActionPromptInput): Promise<boolean> {
  const promptPlan = planBrowserActionFromPrompt({
    text: input.message.text,
    mode: input.message.mode,
    source: readBrowserSourceFromSnapshot(input.providers.getDomSnapshot())
  });
  if (!promptPlan) {
    return false;
  }

  const session = input.browserActions.start({
    id: `browser-action-prompt-${input.message.id}`,
    sessionId: input.sessionId,
    mode: promptPlan.mode,
    source: promptPlan.source
  });
  input.emit({ type: "session.state", state: "tooling", id: input.message.id });
  broadcast(input.clients, { type: "browserAction.started", actionSessionId: session.id, summary: summarizeBrowserActionSession(session) });
  recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", "Prompt-driven Browser Action started", {
    requestId: input.message.id,
    planId: promptPlan.id,
    reason: promptPlan.reason
  });

  const snapshotResult = await readFreshPromptBrowserSnapshot(input, new Date());
  if (snapshotResult.handled) {
    return true;
  }

  const snapshot = snapshotResult.snapshot;
  const observed = input.browserActions.observe({ actionSessionId: session.id, snapshot });
  recordBrowserActionAudit(input.storage, observed.audit);
  broadcast(input.clients, {
    type: "browserAction.observation",
    actionSessionId: session.id,
    observationSummary: summarizeBrowserObservation(observed.observation)
  });

  const plan = normalizeBrowserActionPlan({
    actionSessionId: session.id,
    input: {
      id: promptPlan.id,
      goal: promptPlan.goal,
      adapterId: promptPlan.adapterId,
      mode: promptPlan.mode,
      steps: promptPlan.steps,
      confidence: promptPlan.confidence
    }
  });
  const execution = await input.browserActions.executePlan({
    plan,
    snapshot,
    adapterId: promptPlan.adapterId,
    policies: input.storage.readBrowserActionPolicies()
  });
  for (const audit of execution.audits) {
    recordBrowserActionAudit(input.storage, audit);
  }

  broadcast(input.clients, { type: "browserAction.plan", actionSessionId: session.id, plan: summarizeBrowserActionPlan(execution.plan) });
  if (execution.approval) {
    emitPromptApprovalRequired(input, {
      approval: execution.approval,
      plan: execution.plan,
      results: execution.results
    });
    return true;
  }

  if (execution.command) {
    return handlePromptExtensionCommand(input, {
      plan: execution.plan,
      results: execution.results,
      command: execution.command
    });
  }

  if (requestPromptTargetClarification(input, {
    promptPlan,
    plan: execution.plan,
    results: execution.results
  })) {
    return true;
  }

  completePromptWithResult(input, {
    plan: execution.plan,
    results: execution.results,
    runtimeSummary: `Prompt Browser Action ${execution.plan.status}`
  });
  return true;
}
