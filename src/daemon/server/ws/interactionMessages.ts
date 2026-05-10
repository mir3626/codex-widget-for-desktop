import type { ClientMessage } from "../../../shared/protocol.js";
import {
  redactBrowserActionSecret,
  createAlwaysAllowBrowserActionPolicyInput,
  normalizeBrowserActionPolicy,
  summarizeBrowserActionResult,
  type BrowserActionResult,
  type BrowserQueuedCommand
} from "../../browser-action/index.js";
import {
  broadcastBrowserActionPolicies,
  broadcastExecutionPermissions,
  broadcastLedgerSnapshot,
  sendExecutionPermissions
} from "../clientEvents.js";
import { respondToSemanticTargetClarification } from "../browser-action/clarification.js";
import { waitForBrowserActionCommandResult } from "../browser-action/commandWaiters.js";
import { readBrowserActionPromptCommandWaitMs } from "../browser-action/promptPlan.js";
import { broadcast, send } from "../events.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import { resolveClientSessionId } from "../runtime/sessionIds.js";
import type { MessageRouterContext } from "./context.js";

export async function handleInteractionMessage(message: ClientMessage, context: MessageRouterContext): Promise<boolean> {
  const {
    socket,
    clients,
    storage,
    providers,
    browserActions,
    semanticMemory,
    semanticClarifications,
    browserPerception,
    browserExtensionBridge,
    codexAppServer
  } = context;

  if (message.type === "interaction.respond") {
    if (await respondToSemanticTargetClarification({
      message,
      socket,
      clients,
      storage,
      providers,
      browserPerception,
      browserExtensionBridge,
      browserActions,
      semanticMemory,
      semanticClarifications,
      browserActionCommandWaiters: context.browserActionCommandWaiters
    })) {
      return true;
    }
    const browserActionResponse = await browserActions.respondToInteraction({ id: message.id, decision: message.decision });
    if (browserActionResponse.handled) {
      const session = browserActionResponse.approval ? browserActions.get(browserActionResponse.approval.actionSessionId) : undefined;
      if (message.decision === "always_allow" && browserActionResponse.approval) {
        const policy = normalizeBrowserActionPolicy(createAlwaysAllowBrowserActionPolicyInput({
          approval: browserActionResponse.approval,
          mode: session?.mode ?? "any"
        }));
        const policies = storage.setBrowserActionPolicy(policy);
        broadcastBrowserActionPolicies(clients, policies);
        recordRuntimeActivity(storage, resolveClientSessionId(storage, session?.sessionId), "info", "permission", `Always allow Browser Action group: ${policy.actionFamily}`, {
          actionFamily: policy.actionFamily,
          actionLabel: policy.actionLabel,
          decision: "allow",
          targetRisk: policy.targetRisk,
          mode: policy.mode,
          policyCount: policies.length
        });
      }
      if (browserActionResponse.command && session) {
        broadcast(clients, {
          type: "browserAction.progress",
          actionSessionId: session.id,
          status: "queued",
          detail: { requestId: browserActionResponse.command.requestId, action: browserActionResponse.command.action.type }
        });
        recordRuntimeActivity(storage, resolveClientSessionId(storage, session.sessionId), "info", "browser-action", "Browser action approved and queued", {
          requestId: browserActionResponse.command.requestId,
          action: browserActionResponse.command.action.type
        });
        void settleApprovedBrowserActionCommand({
          command: browserActionResponse.command,
          actionSessionId: session.id,
          messageId: readPromptMessageIdFromActionSessionId(session.id),
          sessionId: resolveClientSessionId(storage, session.sessionId),
          clients,
          storage,
          browserActions,
          waiters: context.browserActionCommandWaiters
        });
      }
      if (browserActionResponse.result && session && !browserActionResponse.command) {
        broadcast(clients, {
          type: "browserAction.result",
          actionSessionId: session.id,
          result: summarizeBrowserActionResult(browserActionResponse.result)
        });
        recordRuntimeActivity(storage, resolveClientSessionId(storage, session.sessionId), "info", "browser-action", "Browser action approval resolved", summarizeBrowserActionResult(browserActionResponse.result));
        broadcastLedgerSnapshot(clients, storage, resolveClientSessionId(storage, session.sessionId));
      }
      return true;
    }
    const result = codexAppServer.respondToInteraction(message);
    if (!result.handled) {
      send(socket, {
        type: "error",
        message: "That Codex interaction is no longer active."
      });
      return true;
    }
    const action = result.action ?? message.action;
    if (result.remember && action) {
      const permissions = storage.setExecutionPermission({ action, decision: "allow" });
      broadcastExecutionPermissions(clients, permissions);
      recordRuntimeActivity(storage, storage.ensureSessionSnapshot().activeSessionId, "info", "permission", `Always allow: ${action}`, {
        action,
        decision: "allow"
      });
    }
    return true;
  }

  if (message.type === "execution.permissions.refresh") {
    sendExecutionPermissions(socket, storage);
    return true;
  }

  if (message.type === "execution.permission.set") {
    try {
      const permissions = storage.setExecutionPermission({
        action: message.action,
        decision: message.decision
      });
      broadcastExecutionPermissions(clients, permissions);
      recordRuntimeActivity(storage, storage.ensureSessionSnapshot().activeSessionId, "info", "permission", `Permission ${message.decision}: ${message.action}`, {
        action: message.action,
        decision: message.decision
      });
      broadcastLedgerSnapshot(clients, storage);
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to update execution permissions."
      });
    }
    return true;
  }

  return false;
}

async function settleApprovedBrowserActionCommand(input: {
  command: BrowserQueuedCommand;
  actionSessionId: string;
  messageId?: string;
  sessionId: string;
  clients: Set<MessageRouterContext["socket"]>;
  storage: MessageRouterContext["storage"];
  browserActions: MessageRouterContext["browserActions"];
  waiters: MessageRouterContext["browserActionCommandWaiters"];
}): Promise<void> {
  const commandResult = await waitForBrowserActionCommandResult({
    requestId: input.command.requestId,
    waiters: input.waiters,
    timeoutMs: readBrowserActionPromptCommandWaitMs(input.command.action)
  });
  const result = commandResult ?? input.browserActions.failExtensionCommand(
    input.command.requestId,
    `Browser Bridge did not complete the approved action within ${Math.round(readBrowserActionPromptCommandWaitMs(input.command.action) / 1000)} seconds.`
  );
  if (!result) {
    return;
  }
  recordRuntimeActivity(input.storage, input.sessionId, result.status === "succeeded" ? "info" : "warn", "browser-action", "Approved Browser Action finished", summarizeBrowserActionResult(result));
  broadcast(input.clients, {
    type: "browserAction.result",
    actionSessionId: input.actionSessionId,
    result: { results: [summarizeBrowserActionResult(result)] }
  });
  if (input.messageId) {
    broadcast(input.clients, {
      type: "message.completed",
      id: input.messageId,
      text: renderApprovedBrowserActionResult(result)
    });
    broadcast(input.clients, { type: "session.state", state: "idle", id: input.messageId });
  }
  broadcastLedgerSnapshot(input.clients, input.storage, input.sessionId);
}

function readPromptMessageIdFromActionSessionId(actionSessionId: string): string | undefined {
  const prefix = "browser-action-prompt-";
  return actionSessionId.startsWith(prefix) ? actionSessionId.slice(prefix.length) : undefined;
}

function renderApprovedBrowserActionResult(result: BrowserActionResult): string {
  const action = result.action.type === "navigate" && result.action.url
    ? `navigate ${result.action.url}`
    : result.safety.actionLabel || result.action.type;
  if (result.status !== "succeeded") {
    const reason = result.error || result.verification.reason;
    return [
      "Browser Action을 완료하지 못했습니다.",
      reason ? `이유: ${reason}` : undefined
    ].filter(Boolean).map((line) => String(redactBrowserActionSecret(line))).join("\n");
  }
  const page = result.after ?? result.before;
  return [
    "브라우저 동작을 완료했습니다.",
    `실행: ${action}`,
    page?.url ? `현재 페이지: ${page.title || "제목 없음"} (${page.url})` : undefined,
    result.verification.reason ? `검증: ${result.verification.reason}` : undefined
  ].filter(Boolean).map((line) => String(redactBrowserActionSecret(line))).join("\n");
}
