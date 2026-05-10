import type { ClientMessage } from "../../../shared/protocol.js";
import { summarizeBrowserActionResult } from "../../browser-action/index.js";
import {
  broadcastExecutionPermissions,
  broadcastLedgerSnapshot,
  sendExecutionPermissions
} from "../clientEvents.js";
import { respondToSemanticTargetClarification } from "../browser-action/clarification.js";
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
      semanticClarifications
    })) {
      return true;
    }
    const browserActionResponse = await browserActions.respondToInteraction({ id: message.id, decision: message.decision });
    if (browserActionResponse.handled) {
      const session = browserActionResponse.approval ? browserActions.get(browserActionResponse.approval.actionSessionId) : undefined;
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
