import {
  summarizeBrowserObservation
} from "../../../browser-action/index.js";
import type { ClientMessage } from "../../../../shared/protocol.js";
import { broadcastLedgerSnapshot } from "../../clientEvents.js";
import { broadcast, send } from "../../events.js";
import { resolveClientSessionId } from "../../runtime/sessionIds.js";
import { recordBrowserActionAudit } from "../helpers.js";
import type { BrowserActionMessageContext } from "./context.js";

export async function handleBrowserActionObserveMessage(
  message: ClientMessage,
  context: BrowserActionMessageContext
): Promise<boolean> {
  const { socket, clients, storage, providers, browserPerception, browserActions } = context;
  if (message.type !== "browserAction.observe") {
    return false;
  }

  try {
    const requestId = `browser-action-observe-${message.actionSessionId}-${Date.now()}`;
    const perception = message.adapterId && message.adapterId !== "extension"
      ? undefined
      : await browserPerception.ensureFreshContext({
          providers,
          bridgeStatus: context.browserExtensionBridge?.snapshot?.() ?? { connected: false, mode: "disconnected", updatedAt: new Date().toISOString() },
          request: {
            requestId,
            reason: "direct_action",
            requiredFreshness: "stable",
            actionRisk: "read",
            allowSettlingForRead: true,
            timeoutMs: 35_000
          },
          onProgress: (detail) => broadcast(clients, {
            type: "browserAction.progress",
            actionSessionId: message.actionSessionId,
            status: "browser_perception_waiting",
            detail
          })
        });
    if (perception && !perception.context) {
      throw new Error(perception.userRecovery ?? `Browser Perception could not prepare active-tab context (${perception.status}).`);
    }
    const observed = message.adapterId && message.adapterId !== "extension"
      ? await browserActions.observeViaAdapter({ actionSessionId: message.actionSessionId, adapterId: message.adapterId })
      : browserActions.observe({ actionSessionId: message.actionSessionId, snapshot: perception?.context?.snapshot ?? providers.getDomSnapshot() });
    recordBrowserActionAudit(storage, observed.audit);
    broadcast(clients, {
      type: "browserAction.observation",
      actionSessionId: message.actionSessionId,
      observationSummary: summarizeBrowserObservation(observed.observation)
    });
    broadcastLedgerSnapshot(clients, storage, resolveClientSessionId(storage, observed.session.sessionId));
  } catch (error) {
    send(socket, {
      type: "browserAction.error",
      actionSessionId: message.actionSessionId,
      error: error instanceof Error ? error.message : "Unable to observe browser state."
    });
  }
  return true;
}
