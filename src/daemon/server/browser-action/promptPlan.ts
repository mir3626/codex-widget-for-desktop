import type { WebSocket } from "ws";
import {
  BrowserActionSessionManager,
  type BrowserActionApproval,
  type BrowserActionPlan,
  type BrowserActionResult,
  type BrowserQueuedCommand
} from "../../browser-action/index.js";
import type { ProviderRegistry } from "../../providers/providerRegistry.js";
import type { StorageService } from "../../storage/storage.js";
import {
  waitForBrowserActionCommandResult,
  type BrowserActionCommandWaiter
} from "./commandWaiters.js";
import { summarizeBrowserActionPlan } from "./presentation.js";
import { recordBrowserActionAudit } from "./helpers.js";
import {
  recordBrowserActionCapabilityCommandQueued,
  recordBrowserActionCapabilityResult
} from "./capabilityMirror.js";
import type { BrowserExtensionBridgeStore } from "../browser-bridge/store.js";
import { broadcast } from "../events.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import {
  markPromptPlanStepFromResult,
  preparePromptStepRetryAfterSourceRefresh
} from "./promptPlanState.js";
import { refreshPromptBrowserActionSnapshotAfterCommand } from "./promptSnapshotRefresh.js";

export const BROWSER_ACTION_PROMPT_COMMAND_WAIT_MS = 25_000;
const BROWSER_ACTION_PROMPT_NAVIGATION_WAIT_MS = 25_000;

export function readBrowserActionPromptCommandWaitMs(action: BrowserQueuedCommand["action"]): number {
  return action.type === "back" || action.type === "forward" || action.type === "reload" || action.type === "navigate"
    ? BROWSER_ACTION_PROMPT_NAVIGATION_WAIT_MS
    : BROWSER_ACTION_PROMPT_COMMAND_WAIT_MS;
}

export async function continuePromptBrowserActionPlan(input: {
  plan: BrowserActionPlan;
  initialResults: BrowserActionResult[];
  completedCommandResult: BrowserActionResult;
  providers: ProviderRegistry;
  browserActions: BrowserActionSessionManager;
  browserExtensionBridge: BrowserExtensionBridgeStore;
  storage: StorageService;
  clients: Set<WebSocket>;
  sessionId: string;
  evalRunId?: string;
  waiters: Map<string, BrowserActionCommandWaiter>;
}): Promise<{
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
  approval?: BrowserActionApproval;
  pendingCommand?: BrowserQueuedCommand;
}> {
  const plan = input.plan;
  const results = [...input.initialResults.slice(0, -1), input.completedCommandResult];
  let snapshot: unknown = await refreshPromptBrowserActionSnapshotAfterCommand({
    actionSessionId: plan.actionSessionId,
    result: input.completedCommandResult,
    providers: input.providers,
    browserActions: input.browserActions,
    browserExtensionBridge: input.browserExtensionBridge,
    storage: input.storage,
    clients: input.clients,
    sessionId: input.sessionId
  });
  if (preparePromptStepRetryAfterSourceRefresh(plan, input.completedCommandResult)) {
    recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", "Retrying prompt Browser Action after active view refresh", {
      planId: plan.id,
      resultId: input.completedCommandResult.id,
      error: input.completedCommandResult.error,
      refreshedUrl: input.completedCommandResult.after?.url
    });
  } else {
    markPromptPlanStepFromResult(plan, input.completedCommandResult);
  }

  while (plan.status !== "failed" && plan.status !== "cancelled") {
    const nextStep = plan.steps.find((step) => step.status === "pending");
    if (!nextStep) {
      plan.status = plan.steps.every((step) => step.status === "succeeded" || step.status === "skipped") ? "completed" : plan.status;
      plan.summary = plan.status === "completed" ? `Browser Action plan completed with ${results.length} result(s).` : plan.summary;
      return { plan, results };
    }

    nextStep.status = "running";
    nextStep.startedAt = new Date().toISOString();
    nextStep.attempts = (nextStep.attempts ?? 0) + 1;
    const execution = await input.browserActions.execute({
      actionSessionId: plan.actionSessionId,
      action: nextStep.action,
      snapshot,
      transaction: input.browserActions.getInteraction(input.completedCommandResult.transaction?.transactionId),
      expected: nextStep.expected,
      adapterId: plan.adapterId,
      targetHint: nextStep.targetSummary,
      policies: input.storage.readBrowserActionPolicies()
    });
    recordBrowserActionAudit(input.storage, execution.audit);
    results.push(execution.result);
    nextStep.resultId = execution.result.id;
    nextStep.safety = execution.result.safety;

    if (execution.approval) {
      nextStep.status = "awaiting_approval";
      nextStep.completedAt = new Date().toISOString();
      plan.status = "awaiting_approval";
      plan.summary = `Plan paused for approval at ${nextStep.id}.`;
      return { plan, results, approval: execution.approval };
    }

    if (execution.command) {
      recordBrowserActionCapabilityCommandQueued({
        storage: input.storage,
        clients: input.clients,
        command: execution.command,
        sessionId: input.sessionId,
        evalRunId: input.evalRunId,
        result: execution.result
      });
      input.browserActions.markInteractionTiming(execution.result.transaction?.transactionId, "extension_followup_wait_started", "executing", {
        requestId: execution.command.requestId,
        action: execution.command.action.type,
        stepId: nextStep.id,
        bridgeStatus: summarizeBridgeStatus(input.browserExtensionBridge.snapshot())
      });
      nextStep.status = "awaiting_extension";
      nextStep.completedAt = new Date().toISOString();
      plan.status = "paused";
      plan.summary = `Plan paused while extension executes ${nextStep.id}.`;
      const commandResultPromise = waitForBrowserActionCommandResult({
        requestId: execution.command.requestId,
        waiters: input.waiters,
        timeoutMs: readBrowserActionPromptCommandWaitMs(execution.command.action)
      });
      broadcast(input.clients, {
        type: "browserAction.progress",
        actionSessionId: plan.actionSessionId,
        status: "plan_paused_for_extension",
        detail: { requestId: execution.command.requestId, action: execution.command.action.type, plan: summarizeBrowserActionPlan(plan) }
      });
      const commandResult = await commandResultPromise;
      input.browserActions.markInteractionTiming(execution.result.transaction?.transactionId, "extension_followup_wait_completed", "executing", {
        requestId: execution.command.requestId,
        action: execution.command.action.type,
        stepId: nextStep.id,
        received: Boolean(commandResult),
        status: commandResult?.status,
        verification: commandResult?.verification.status
      });
      if (!commandResult) {
        const waitedMs = readBrowserActionPromptCommandWaitMs(execution.command.action);
        const error = `Browser Bridge did not pick up the follow-up action within ${Math.round(waitedMs / 1000)} seconds. The queued browser command was cancelled before it could execute.`;
        const failedResult = input.browserActions.failExtensionCommand(execution.command.requestId, error);
        if (failedResult) {
          results[results.length - 1] = failedResult;
          markPromptPlanStepFromResult(plan, failedResult);
          recordBrowserActionCapabilityResult({
            storage: input.storage,
            clients: input.clients,
            result: failedResult,
            requestId: execution.command.requestId,
            sessionId: input.sessionId,
            evalRunId: input.evalRunId
          });
        } else {
          nextStep.status = "failed";
          nextStep.error = error;
          nextStep.completedAt = new Date().toISOString();
          plan.status = "failed";
          plan.summary = `Plan stopped at ${nextStep.id}: ${error}`;
        }
        recordRuntimeActivity(input.storage, input.sessionId, "warn", "browser-action", "Prompt Browser Action follow-up command still pending after wait", {
          requestId: execution.command.requestId,
          action: execution.command.action.type,
          waitedMs,
          planId: plan.id,
          stepId: nextStep.id,
          cancelled: Boolean(failedResult),
          bridgeStatus: summarizeBridgeStatus(input.browserExtensionBridge.snapshot()),
          command: {
            createdAt: execution.command.createdAt,
            expiresAt: execution.command.expiresAt,
            deliveredAt: execution.command.deliveredAt,
            deliveryAttempts: execution.command.deliveryAttempts
          }
        });
        return { plan, results };
      }
      results[results.length - 1] = commandResult;
      recordBrowserActionCapabilityResult({
        storage: input.storage,
        clients: input.clients,
        result: commandResult,
        requestId: execution.command.requestId,
        sessionId: input.sessionId,
        evalRunId: input.evalRunId
      });
      snapshot = await refreshPromptBrowserActionSnapshotAfterCommand({
        actionSessionId: plan.actionSessionId,
        result: commandResult,
        providers: input.providers,
        browserActions: input.browserActions,
        browserExtensionBridge: input.browserExtensionBridge,
        storage: input.storage,
        clients: input.clients,
        sessionId: input.sessionId
      });
      if (preparePromptStepRetryAfterSourceRefresh(plan, commandResult)) {
        recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", "Retrying prompt Browser Action follow-up after active view refresh", {
          planId: plan.id,
          resultId: commandResult.id,
          error: commandResult.error,
          refreshedUrl: commandResult.after?.url
        });
        continue;
      }
      markPromptPlanStepFromResult(plan, commandResult);
      continue;
    }

    if (execution.result.status !== "succeeded") {
      markPromptPlanStepFromResult(plan, execution.result);
      return { plan, results };
    }

    nextStep.status = "succeeded";
    nextStep.completedAt = new Date().toISOString();
    snapshot = execution.result.after ?? snapshot;
  }

  return { plan, results };
}

function summarizeBridgeStatus(status: ReturnType<BrowserExtensionBridgeStore["snapshot"]>): Record<string, unknown> {
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
