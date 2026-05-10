import {
  normalizeBrowserActionPolicy
} from "../../../browser-action/index.js";
import type { ClientMessage } from "../../../../shared/protocol.js";
import {
  broadcastBrowserActionPolicies,
  broadcastLedgerSnapshot,
  sendBrowserActionPolicies
} from "../../clientEvents.js";
import { send } from "../../events.js";
import { recordRuntimeActivity } from "../../runtimeActivity.js";
import type { BrowserActionMessageContext } from "./context.js";

export async function handleBrowserActionPolicyMessage(
  message: ClientMessage,
  context: BrowserActionMessageContext
): Promise<boolean> {
  const { socket, clients, storage } = context;

  if (message.type === "browserAction.policy.list") {
    sendBrowserActionPolicies(socket, storage);
    return true;
  }

  if (message.type === "browserAction.policy.set") {
    try {
      const policy = normalizeBrowserActionPolicy(message.policy);
      const policies = storage.setBrowserActionPolicy(policy);
      broadcastBrowserActionPolicies(clients, policies);
      recordRuntimeActivity(storage, storage.ensureSessionSnapshot().activeSessionId, "info", "browser-action-policy", `Browser Action policy ${policy.decision}: ${policy.actionFamily}`, policy);
      broadcastLedgerSnapshot(clients, storage);
    } catch (error) {
      send(socket, { type: "error", message: error instanceof Error ? error.message : "Unable to save Browser Action policy." });
    }
    return true;
  }

  if (message.type === "browserAction.policy.revoke") {
    try {
      const policies = storage.revokeBrowserActionPolicy(message.policyId);
      broadcastBrowserActionPolicies(clients, policies);
      recordRuntimeActivity(storage, storage.ensureSessionSnapshot().activeSessionId, "info", "browser-action-policy", `Browser Action policy revoked: ${message.policyId}`, { policyId: message.policyId });
      broadcastLedgerSnapshot(clients, storage);
    } catch (error) {
      send(socket, { type: "error", message: error instanceof Error ? error.message : "Unable to revoke Browser Action policy." });
    }
    return true;
  }

  return false;
}
