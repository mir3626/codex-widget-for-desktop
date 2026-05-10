import {
  summarizeBrowserActionSession
} from "../../../browser-action/index.js";
import type { ClientMessage } from "../../../../shared/protocol.js";
import { broadcastLedgerSnapshot } from "../../clientEvents.js";
import { broadcast, send } from "../../events.js";
import { recordRuntimeActivity } from "../../runtimeActivity.js";
import { resolveClientSessionId } from "../../runtime/sessionIds.js";
import type { BrowserActionMessageContext } from "./context.js";

export async function handleBrowserActionSessionMessage(
  message: ClientMessage,
  context: BrowserActionMessageContext
): Promise<boolean> {
  const { socket, clients, storage, browserActions } = context;

  if (message.type === "browserAction.start") {
    try {
      const sessionId = resolveClientSessionId(storage, message.sessionId);
      const session = browserActions.start({
        id: message.actionSessionId,
        sessionId,
        mode: message.mode,
        source: message.source
      });
      recordRuntimeActivity(storage, sessionId, "info", "browser-action", "Browser Action session started", summarizeBrowserActionSession(session));
      broadcast(clients, { type: "browserAction.started", actionSessionId: session.id, summary: summarizeBrowserActionSession(session) });
      broadcastLedgerSnapshot(clients, storage, sessionId);
    } catch (error) {
      send(socket, {
        type: "browserAction.error",
        actionSessionId: message.actionSessionId ?? "",
        error: error instanceof Error ? error.message : "Unable to start Browser Action session."
      });
    }
    return true;
  }

  if (message.type === "browserAction.adapters") {
    try {
      const adapters = await browserActions.getAdapterStatuses(message.actionSessionId);
      send(socket, {
        type: "browserAction.adapters",
        actionSessionId: message.actionSessionId,
        adapters
      });
    } catch (error) {
      send(socket, {
        type: "browserAction.error",
        actionSessionId: message.actionSessionId ?? "",
        error: error instanceof Error ? error.message : "Unable to read Browser Action adapter status."
      });
    }
    return true;
  }

  if (message.type === "browserAction.cancel") {
    try {
      const session = browserActions.cancel(message.actionSessionId);
      recordRuntimeActivity(storage, resolveClientSessionId(storage, session.sessionId), "warn", "browser-action", "Browser Action session cancelled", summarizeBrowserActionSession(session));
      broadcast(clients, {
        type: "browserAction.progress",
        actionSessionId: message.actionSessionId,
        status: "cancelled",
        detail: summarizeBrowserActionSession(session)
      });
      broadcastLedgerSnapshot(clients, storage, resolveClientSessionId(storage, session.sessionId));
    } catch (error) {
      send(socket, {
        type: "browserAction.error",
        actionSessionId: message.actionSessionId,
        error: error instanceof Error ? error.message : "Unable to cancel Browser Action session."
      });
    }
    return true;
  }

  return false;
}
