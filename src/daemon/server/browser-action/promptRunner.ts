import {
  buildIntentFrameFromAction,
  createBrowserInteractionDebugBundle,
  createBrowserViewContextLease,
  classifyBrowserActionRisk,
  planBrowserActionFromPrompt,
  summarizeBrowserActionSession,
  summarizeBrowserObservation,
  type BrowserActionResult
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
import { createBrowserActionPromptToolInvocation } from "../../agent-tools/index.js";
import { summarizeCapabilityTimings } from "../../capability-transaction/index.js";

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
  let transaction = input.browserActions.beginInteraction({
    requestId: input.message.id,
    actionSessionId: session.id,
    sessionId: input.sessionId,
    utterance: input.message.text,
    source: "prompt",
    mode: promptPlan.mode,
    browserSource: promptPlan.source
  });
  recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", "Prompt-driven Browser Action started", {
    requestId: input.message.id,
    planId: promptPlan.id,
    reason: promptPlan.reason,
    transactionId: transaction.transactionId,
    toolInvocation: createBrowserActionPromptToolInvocation({
      requestId: input.message.id,
      sessionId: input.sessionId,
      promptPlan,
      utterance: input.message.text
    })
  });

  const firstAction = promptPlan.steps[0]?.action;
  const snapshotResult = await readFreshPromptBrowserSnapshot(input, new Date(), firstAction);
  if (snapshotResult.handled) {
    return true;
  }

  const snapshot = snapshotResult.snapshot;
  const contextLease = snapshotResult.context && firstAction
    ? createBrowserViewContextLease({
        context: snapshotResult.context,
        leaseReason: "prompt",
        requiredRiskClass: classifyBrowserActionRisk(firstAction)
      })
    : undefined;
  if (contextLease) {
    transaction = input.browserActions.attachInteractionLease(transaction.transactionId, contextLease) ?? transaction;
  }
  if (firstAction) {
    transaction = input.browserActions.recordInteractionIntent(transaction.transactionId, buildIntentFrameFromAction({
      utterance: input.message.text,
      action: firstAction,
      targetPhrase: promptPlan.steps[0]?.targetSummary,
      confidence: promptPlan.confidence
    })) ?? transaction;
  }
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
    contextLease,
    transaction,
    adapterId: promptPlan.adapterId,
    policies: input.storage.readBrowserActionPolicies()
  });
  for (const audit of execution.audits) {
    recordBrowserActionAudit(input.storage, audit);
  }
  transaction = input.browserActions.updateInteractionPhase(
    transaction.transactionId,
    execution.plan.status === "completed" ? "completed" : execution.plan.status === "cancelled" ? "cancelled" : execution.plan.status === "awaiting_approval" ? "awaiting_approval" : execution.plan.status === "paused" ? "executing" : "failed",
    `Browser Action plan ${execution.plan.status}`,
    {
      planId: execution.plan.id,
      resultCount: execution.results.length,
      latestStatus: execution.results.at(-1)?.status
    }
  ) ?? transaction;

  if (execution.plan.status !== "completed") {
    const latestResult = execution.results.at(-1);
    recordRuntimeActivity(input.storage, input.sessionId, "warn", "browser-action", "Browser Action debug bundle", {
      debugBundle: createBrowserInteractionDebugBundle({
        transaction,
        diagnostics: {
          planStatus: execution.plan.status,
          resultCount: execution.results.length,
          latestResult: latestResult
            ? summarizeBrowserActionResultForDebug(latestResult)
            : undefined
        }
      })
    });
  }
  recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", "Browser Action timing summary", {
    transactionId: transaction.transactionId,
    planStatus: execution.plan.status,
    timings: summarizeCapabilityTimings(transaction.timings)
  });

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

function summarizeBrowserActionResultForDebug(result: BrowserActionResult): Record<string, unknown> {
  return {
    id: result.id,
    status: result.status,
    verification: result.verification,
    transaction: result.transaction,
    safety: {
      decision: result.safety.decision,
      risk: result.safety.risk,
      reason: result.safety.reason,
      destructive: result.safety.destructive
    },
    error: result.error
  };
}
