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
import { summarizeBrowserActionPlan } from "./presentation.js";
import type { BrowserActionPromptInput } from "./promptTypes.js";

export async function handlePromptExtensionCommand(input: BrowserActionPromptInput, detail: {
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
  command: BrowserQueuedCommand;
}): Promise<boolean> {
  const transactionId = detail.results.at(-1)?.transaction?.transactionId;
  input.browserActions.markInteractionTiming(transactionId, "extension_command_wait_started", "executing", {
    requestId: detail.command.requestId,
    action: detail.command.action.type
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
        sessionId: input.sessionId
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
      cancelled: Boolean(failedResult)
    });
    completePromptWithResult(input, {
      plan: detail.plan,
      results,
      runtimeSummary: "Prompt Browser Action failed because the extension did not pick up the command in time"
    });
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
    waiters: input.browserActionCommandWaiters
  });
  if (continued.approval) {
    recordBrowserActionCapabilityApproval({
      storage: input.storage,
      clients: input.clients,
      requestId: continued.approval.id,
      actionSessionId: continued.approval.actionSessionId,
      sessionId: input.sessionId,
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
      result: continued.results.at(-1)
    });
    return handlePromptExtensionCommand(input, {
      plan: continued.plan,
      results: continued.results,
      command: continued.pendingCommand
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
      sessionId: input.sessionId
    });
  }
  return true;
}
