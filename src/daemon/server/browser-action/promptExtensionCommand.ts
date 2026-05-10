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
  BROWSER_ACTION_PROMPT_COMMAND_WAIT_MS,
  continuePromptBrowserActionPlan
} from "./promptPlan.js";
import {
  completePromptAsExtensionPending,
  completePromptWithResult,
  emitPromptApprovalRequired
} from "./promptResponses.js";
import { summarizeBrowserActionPlan } from "./presentation.js";
import type { BrowserActionPromptInput } from "./promptTypes.js";

export async function handlePromptExtensionCommand(input: BrowserActionPromptInput, detail: {
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
  command: BrowserQueuedCommand;
}): Promise<boolean> {
  const commandResultPromise = waitForBrowserActionCommandResult({
    requestId: detail.command.requestId,
    waiters: input.browserActionCommandWaiters,
    timeoutMs: BROWSER_ACTION_PROMPT_COMMAND_WAIT_MS
  });
  broadcast(input.clients, {
    type: "browserAction.progress",
    actionSessionId: detail.plan.actionSessionId,
    status: "plan_paused_for_extension",
    detail: { requestId: detail.command.requestId, action: detail.command.action.type, plan: summarizeBrowserActionPlan(detail.plan) }
  });
  const commandResult = await commandResultPromise;
  if (!commandResult) {
    recordRuntimeActivity(input.storage, input.sessionId, "warn", "browser-action", "Prompt Browser Action extension command still pending after wait", {
      requestId: detail.command.requestId,
      action: detail.command.action.type,
      waitedMs: BROWSER_ACTION_PROMPT_COMMAND_WAIT_MS,
      planId: detail.plan.id
    });
    completePromptAsExtensionPending(input, detail.plan, detail.results);
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
    emitPromptApprovalRequired(input, {
      approval: continued.approval,
      plan: continued.plan,
      results: continued.results
    });
    return true;
  }
  if (continued.pendingCommand) {
    completePromptAsExtensionPending(input, continued.plan, continued.results);
    return true;
  }
  completePromptWithResult(input, {
    plan: continued.plan,
    results: continued.results,
    runtimeSummary: `Prompt Browser Action ${continued.plan.status} after extension result`
  });
  return true;
}
