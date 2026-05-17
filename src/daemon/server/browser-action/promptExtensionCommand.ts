import {
  type BrowserActionPlan,
  type BrowserActionResult,
  type BrowserQueuedCommand
} from "../../browser-action/index.js";
import { broadcast } from "../events.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import {
  waitForBrowserActionCommandResult
} from "./commandWaiters.js";
import {
  continuePromptBrowserActionPlan,
  readBrowserActionPromptCommandWaitMs
} from "./promptPlan.js";
import { markPromptPlanStepFromResult } from "./promptPlanState.js";
import {
  completePromptWithResult,
  emitPromptApprovalRequired
} from "./promptResponses.js";
import {
  recordBrowserActionCapabilityApproval,
  recordBrowserActionCapabilityCommandQueued,
  recordBrowserActionCapabilityResult
} from "./capabilityMirror.js";
import {
  recordPromptBrowserActionEvalCheckpoint,
  recordPromptBrowserActionTimingSummary,
  type BrowserActionPromptEvalContext
} from "./promptEvalLedger.js";
import { summarizeBrowserActionPlan } from "./presentation.js";
import type { BrowserActionPromptInput } from "./promptTypes.js";

export async function handlePromptExtensionCommand(input: BrowserActionPromptInput, detail: {
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
  command: BrowserQueuedCommand;
  evalContext?: BrowserActionPromptEvalContext;
}): Promise<boolean> {
  const transactionId = detail.results.at(-1)?.transaction?.transactionId;
  input.browserActions.markInteractionTiming(transactionId, "extension_command_wait_started", "executing", {
    requestId: detail.command.requestId,
    action: detail.command.action.type,
    bridgeStatus: summarizeBridgeStatus(input.browserExtensionBridge.snapshot())
  });
  const commandResultPromise = waitForBrowserActionCommandResult({
    requestId: detail.command.requestId,
    waiters: input.browserActionCommandWaiters,
    timeoutMs: readBrowserActionPromptCommandWaitMs(detail.command.action)
  });
  broadcast(input.clients, {
    type: "browserAction.progress",
    actionSessionId: detail.plan.actionSessionId,
    status: "plan_paused_for_extension",
    detail: { requestId: detail.command.requestId, action: detail.command.action.type, plan: summarizeBrowserActionPlan(detail.plan) }
  });
  const commandResult = await commandResultPromise;
  input.browserActions.markInteractionTiming(transactionId, "extension_command_wait_completed", "executing", {
    requestId: detail.command.requestId,
    action: detail.command.action.type,
    received: Boolean(commandResult),
    status: commandResult?.status,
    verification: commandResult?.verification.status
  });
  if (!commandResult) {
    const waitedMs = readBrowserActionPromptCommandWaitMs(detail.command.action);
    const error = `Browser Bridge did not pick up the action within ${Math.round(waitedMs / 1000)} seconds. The queued browser command was cancelled before it could execute.`;
    const failedResult = input.browserActions.failExtensionCommand(detail.command.requestId, error);
    const results = failedResult ? [...detail.results.slice(0, -1), failedResult] : detail.results;
    if (failedResult) {
      markPromptPlanStepFromResult(detail.plan, failedResult);
      recordBrowserActionCapabilityResult({
        storage: input.storage,
        clients: input.clients,
        result: failedResult,
        requestId: detail.command.requestId,
        sessionId: input.sessionId,
        evalRunId: detail.evalContext?.evalRunId
      });
    } else {
      detail.plan.status = "failed";
      detail.plan.summary = error;
    }
    recordRuntimeActivity(input.storage, input.sessionId, "warn", "browser-action", "Prompt Browser Action extension command still pending after wait", {
      requestId: detail.command.requestId,
      action: detail.command.action.type,
      waitedMs,
      planId: detail.plan.id,
      cancelled: Boolean(failedResult),
      bridgeStatus: summarizeBridgeStatus(input.browserExtensionBridge.snapshot()),
      command: {
        createdAt: detail.command.createdAt,
        expiresAt: detail.command.expiresAt,
        deliveredAt: detail.command.deliveredAt,
        deliveryAttempts: detail.command.deliveryAttempts
      }
    });
    completePromptWithResult(input, {
      plan: detail.plan,
      results,
      runtimeSummary: "Prompt Browser Action failed because the extension did not pick up the command in time"
    });
    recordPromptFinalEval(input, detail.evalContext, detail.plan, results, transactionId);
    return true;
  }

  const continued = await continuePromptBrowserActionPlan({
    plan: detail.plan,
    initialResults: detail.results,
    completedCommandResult: commandResult,
    providers: input.providers,
    browserActions: input.browserActions,
    browserExtensionBridge: input.browserExtensionBridge,
    storage: input.storage,
    clients: input.clients,
    sessionId: input.sessionId,
    evalRunId: detail.evalContext?.evalRunId,
    waiters: input.browserActionCommandWaiters
  });
  if (continued.approval) {
    recordBrowserActionCapabilityApproval({
      storage: input.storage,
      clients: input.clients,
      requestId: continued.approval.id,
      actionSessionId: continued.approval.actionSessionId,
      sessionId: input.sessionId,
      evalRunId: detail.evalContext?.evalRunId,
      action: continued.approval.action,
      result: continued.results.at(-1),
      approvalId: continued.approval.id
    });
    emitPromptApprovalRequired(input, {
      approval: continued.approval,
      plan: continued.plan,
      results: continued.results
    });
    return true;
  }
  if (continued.pendingCommand) {
    recordBrowserActionCapabilityCommandQueued({
      storage: input.storage,
      clients: input.clients,
      command: continued.pendingCommand,
      sessionId: input.sessionId,
      evalRunId: detail.evalContext?.evalRunId,
      result: continued.results.at(-1)
    });
    return handlePromptExtensionCommand(input, {
      plan: continued.plan,
      results: continued.results,
      command: continued.pendingCommand,
      evalContext: detail.evalContext
    });
  }
  completePromptWithResult(input, {
    plan: continued.plan,
    results: continued.results,
    runtimeSummary: `Prompt Browser Action ${continued.plan.status} after extension result`
  });
  const latestResult = continued.results.at(-1);
  if (latestResult) {
    recordBrowserActionCapabilityResult({
      storage: input.storage,
      clients: input.clients,
      result: latestResult,
      sessionId: input.sessionId,
      evalRunId: detail.evalContext?.evalRunId
    });
  }
  recordPromptFinalEval(input, detail.evalContext, continued.plan, continued.results, transactionId);
  return true;
}

function summarizeBridgeStatus(status: ReturnType<BrowserActionPromptInput["browserExtensionBridge"]["snapshot"]>): Record<string, unknown> {
  return {
    connected: status.connected,
    mode: status.mode,
    reason: status.reason,
    updatedAt: status.updatedAt,
    lastError: status.lastError,
    activeTab: status.activeTab
      ? {
          tabId: status.activeTab.tabId,
          windowId: status.activeTab.windowId,
          url: status.activeTab.url,
          title: status.activeTab.title,
          permission: status.activeTab.permission
        }
      : undefined
  };
}

function recordPromptFinalEval(
  input: BrowserActionPromptInput,
  evalContext: BrowserActionPromptEvalContext | undefined,
  plan: BrowserActionPlan,
  results: BrowserActionResult[],
  transactionId: string | undefined
): void {
  if (!evalContext) {
    return;
  }
  const timingSource = input.browserActions.getInteraction(transactionId ?? evalContext.transactionId);
  const completedEval = recordPromptBrowserActionEvalCheckpoint({
    storage: input.storage,
    sessionId: input.sessionId,
    context: evalContext,
    plan,
    results,
    timingSource,
    terminal: true
  });
  if (completedEval) {
    recordPromptBrowserActionTimingSummary({
      storage: input.storage,
      sessionId: input.sessionId,
      context: evalContext,
      plan,
      timingSource,
      completedEval
    });
  }
}
