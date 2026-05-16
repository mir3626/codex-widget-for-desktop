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
import {
  recordBrowserActionCapabilityApproval,
  recordBrowserActionCapabilityCommandQueued,
  recordBrowserActionCapabilityResult
} from "./capabilityMirror.js";
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
import { buildPerceptionGraphFromBrowserObservation } from "../../perception-graph/index.js";
import { recordStructuredFailure } from "../../failure-memory/index.js";
import {
  recordPromptBrowserActionEvalCheckpoint,
  recordPromptBrowserActionTimingSummary,
  type BrowserActionPromptEvalContext
} from "./promptEvalLedger.js";

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
  transaction = input.browserActions.markInteractionTiming(transaction.transactionId, "prompt_plan_created", "perceiving", {
    planId: promptPlan.id,
    stepCount: promptPlan.steps.length,
    firstAction: promptPlan.steps[0]?.action.type,
    confidence: promptPlan.confidence
  }) ?? transaction;
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
  const evalRun = input.storage.createComputerUseEvalRun({
    scenarioId: `browser-action:${promptPlan.id}`,
    sessionId: input.sessionId,
    modalities: ["browser"],
    prompt: input.message.text,
    scenario: {
      id: `browser-action:${promptPlan.id}`,
      title: promptPlan.goal,
      modalities: ["browser"],
      source: "prompt",
      prompt: input.message.text,
      expectedOutcome: promptPlan.steps.map((step) => step.expected ?? step.action.type),
      tags: ["browser_action", "prompt"]
    },
    metrics: {
      plannedSteps: promptPlan.steps.length,
      firstAction: promptPlan.steps[0]?.action.type
    }
  });
  const evalContext: BrowserActionPromptEvalContext = {
    evalRunId: evalRun.id,
    perceptionGraphId: "",
    transactionId: transaction.transactionId
  };

  const firstAction = promptPlan.steps[0]?.action;
  transaction = input.browserActions.markInteractionTiming(transaction.transactionId, "fresh_context_wait_started", "perceiving", {
    firstAction: firstAction?.type
  }) ?? transaction;
  const snapshotResult = await readFreshPromptBrowserSnapshot(input, new Date(), firstAction);
  transaction = input.browserActions.markInteractionTiming(transaction.transactionId, "fresh_context_wait_completed", "perceiving", {
    handled: snapshotResult.handled,
    hasContext: Boolean(snapshotResult.context),
    hasSnapshot: Boolean(snapshotResult.snapshot),
    viewRevision: snapshotResult.context?.viewRevision,
    routeKey: snapshotResult.context?.routeKey
  }) ?? transaction;
  if (snapshotResult.handled) {
    input.storage.updateComputerUseEvalRun({
      id: evalRun.id,
      status: "completed",
      taskSuccess: "abstained",
      failureClass: "restricted_surface",
      completedAt: new Date().toISOString(),
      metrics: {
        handledDuringFreshContext: true
      }
    });
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
  const perceptionGraph = input.storage.recordPerceptionGraph({
    graph: buildPerceptionGraphFromBrowserObservation({
      observation: observed.observation,
      sessionId: input.sessionId
    }),
    sessionId: input.sessionId,
    source: "browser_action"
  });
  evalContext.perceptionGraphId = perceptionGraph.id;
  input.storage.appendComputerUseEvalStep({
    runId: evalRun.id,
    kind: "perception_graph",
    phase: "perceiving",
    status: "completed",
    perceptionGraphId: perceptionGraph.id,
    input: {
      observationId: observed.observation.id,
      url: observed.observation.url,
      elementCount: observed.observation.elements.length
    },
    output: {
      graphId: perceptionGraph.id,
      nodeCount: perceptionGraph.nodes.length,
      edgeCount: perceptionGraph.edges.length,
      thresholds: perceptionGraph.thresholds
    },
    startedAt: observed.observation.capturedAt,
    completedAt: perceptionGraph.createdAt,
    elapsedMs: Math.max(0, Date.parse(perceptionGraph.createdAt) - Date.parse(observed.observation.capturedAt))
  });
  transaction = input.browserActions.markInteractionTiming(transaction.transactionId, "observation_recorded", "framing_intent", {
    url: observed.observation.url,
    title: observed.observation.title,
    elements: observed.observation.elements.length,
    viewRevision: observed.observation.viewGraph?.identity.viewRevision
  }) ?? transaction;
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
  transaction = input.browserActions.markInteractionTiming(transaction.transactionId, "plan_execution_started", "executing", {
    planId: plan.id,
    stepCount: plan.steps.length
  }) ?? transaction;
  const execution = await input.browserActions.executePlan({
    plan,
    snapshot,
    contextLease,
    transaction,
    adapterId: promptPlan.adapterId,
    policies: input.storage.readBrowserActionPolicies()
  });
  transaction = input.browserActions.markInteractionTiming(transaction.transactionId, "plan_execution_completed", "verifying", {
    planStatus: execution.plan.status,
    resultCount: execution.results.length,
    latestStatus: execution.results.at(-1)?.status,
    pendingCommand: execution.command?.requestId,
    approval: execution.approval?.id
  }) ?? transaction;
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

  let debugBundle: ReturnType<typeof createBrowserInteractionDebugBundle> | undefined;
  if (execution.plan.status !== "completed") {
    const latestResult = execution.results.at(-1);
    debugBundle = createBrowserInteractionDebugBundle({
      transaction,
      diagnostics: {
        planStatus: execution.plan.status,
        resultCount: execution.results.length,
        latestResult: latestResult
          ? summarizeBrowserActionResultForDebug(latestResult)
          : undefined
      }
    });
    recordRuntimeActivity(input.storage, input.sessionId, "warn", "browser-action", "Browser Action debug bundle", {
      debugBundle
    });
  }
  const completedEval = recordPromptBrowserActionEvalCheckpoint({
    storage: input.storage,
    sessionId: input.sessionId,
    context: evalContext,
    plan: execution.plan,
    results: execution.results,
    timingSource: transaction,
    terminal: !execution.command
  });
  if (completedEval && completedEval.failureClass !== "none" && completedEval.failureClass !== "unknown") {
    recordStructuredFailure({
      storage: input.storage,
      failureClass: completedEval.failureClass,
      surface: "browser",
      source: "browser_action_prompt_runner",
      scenarioId: completedEval.scenarioId,
      evalRunId: completedEval.id,
      perceptionGraphId: perceptionGraph.id,
      badTargetPatterns: execution.results.map((result) => result.target?.label || result.target?.text || result.target?.id).filter((value): value is string => Boolean(value)),
      recoveryHints: ["refresh_observation", "ask_target_clarification"],
      ttlMs: 14 * 24 * 60 * 60 * 1000
    });
  }
  if (completedEval) {
    recordPromptBrowserActionTimingSummary({
      storage: input.storage,
      sessionId: input.sessionId,
      context: evalContext,
      plan: execution.plan,
      timingSource: transaction,
      completedEval
    });
  }
  broadcast(input.clients, {
    type: "browserAction.diagnostics",
    actionSessionId: session.id,
    diagnostics: {
      schemaVersion: "browser-action-diagnostics.v1",
      transactionId: transaction.transactionId,
      requestId: input.message.id,
      phase: transaction.phase,
      planStatus: execution.plan.status,
      timingSummary: transaction ? Object.fromEntries(transaction.timings.map((timing) => [timing.name, timing.elapsedMs])) : {},
      debugBundle
    }
  });

  broadcast(input.clients, { type: "browserAction.plan", actionSessionId: session.id, plan: summarizeBrowserActionPlan(execution.plan) });
  if (execution.approval) {
    recordBrowserActionCapabilityApproval({
      storage: input.storage,
      clients: input.clients,
      requestId: input.message.id,
      actionSessionId: session.id,
      sessionId: input.sessionId,
      evalRunId: evalRun.id,
      action: execution.approval.action,
      result: execution.results.at(-1),
      approvalId: execution.approval.id
    });
    emitPromptApprovalRequired(input, {
      approval: execution.approval,
      plan: execution.plan,
      results: execution.results
    });
    return true;
  }

  if (execution.command) {
    recordBrowserActionCapabilityCommandQueued({
      storage: input.storage,
      clients: input.clients,
      command: execution.command,
      sessionId: input.sessionId,
      evalRunId: evalRun.id,
      result: execution.results.at(-1)
    });
    return handlePromptExtensionCommand(input, {
      plan: execution.plan,
      results: execution.results,
      command: execution.command,
      evalContext
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
  const latestResult = execution.results.at(-1);
  if (latestResult) {
    recordBrowserActionCapabilityResult({
      storage: input.storage,
      clients: input.clients,
      result: latestResult,
      requestId: input.message.id,
      sessionId: input.sessionId,
      evalRunId: evalRun.id
    });
  }
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
      destructive: result.safety.destructive,
      browserInteraction: result.safety.metadata?.browserInteraction,
      bridgeExecution: result.safety.metadata?.bridgeExecution
    },
    error: result.error
  };
}
