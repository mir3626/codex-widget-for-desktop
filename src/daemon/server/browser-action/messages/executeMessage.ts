import {
  summarizeBrowserActionResult,
  type BrowserAction
} from "../../../browser-action/index.js";
import type { ClientMessage } from "../../../../shared/protocol.js";
import { broadcastLedgerSnapshot } from "../../clientEvents.js";
import { broadcast, send } from "../../events.js";
import { resolveClientSessionId } from "../../runtime/sessionIds.js";
import {
  buildBrowserActionApprovalBody,
  recordBrowserActionAudit
} from "../helpers.js";
import {
  recordBrowserActionCapabilityApproval,
  recordBrowserActionCapabilityCommandQueued,
  recordBrowserActionCapabilityResult
} from "../capabilityMirror.js";
import type { BrowserActionMessageContext } from "./context.js";

export async function handleBrowserActionExecuteMessage(
  message: ClientMessage,
  context: BrowserActionMessageContext
): Promise<boolean> {
  const { socket, clients, storage, providers, browserActions } = context;
  if (message.type !== "browserAction.execute") {
    return false;
  }

  try {
    const execution = await browserActions.execute({
      actionSessionId: message.actionSessionId,
      action: message.action as BrowserAction,
      snapshot: providers.getDomSnapshot(),
      adapterId: message.adapterId,
      approved: message.approved,
      targetHint: message.targetHint,
      policies: storage.readBrowserActionPolicies()
    });
    recordBrowserActionAudit(storage, execution.audit);
    const sessionId = resolveClientSessionId(storage, execution.session.sessionId);
    if (execution.approval) {
      recordBrowserActionCapabilityApproval({
        storage,
        clients,
        requestId: message.requestId ?? execution.approval.id,
        actionSessionId: message.actionSessionId,
        sessionId,
        action: execution.approval.action,
        result: execution.result,
        approvalId: execution.approval.id
      });
      broadcast(clients, {
        type: "interaction.required",
        interaction: {
          id: execution.approval.id,
          requestId: message.requestId,
          kind: "approval",
          title: "Browser action approval",
          body: buildBrowserActionApprovalBody(execution.result),
          action: `Browser action: ${execution.result.safety.actionLabel}`
        }
      });
      broadcast(clients, {
        type: "browserAction.progress",
        actionSessionId: message.actionSessionId,
        status: "approval_required",
        detail: summarizeBrowserActionResult(execution.result)
      });
    } else if (execution.command) {
      recordBrowserActionCapabilityCommandQueued({
        storage,
        clients,
        command: execution.command,
        sessionId,
        result: execution.result
      });
      broadcast(clients, {
        type: "browserAction.progress",
        actionSessionId: message.actionSessionId,
        status: "queued",
        detail: { requestId: execution.command.requestId, action: execution.command.action.type }
      });
    } else {
      recordBrowserActionCapabilityResult({
        storage,
        clients,
        result: execution.result,
        requestId: message.requestId,
        sessionId
      });
      broadcast(clients, {
        type: "browserAction.result",
        actionSessionId: message.actionSessionId,
        result: summarizeBrowserActionResult(execution.result)
      });
    }
    broadcastLedgerSnapshot(clients, storage, sessionId);
  } catch (error) {
    send(socket, {
      type: "browserAction.error",
      actionSessionId: message.actionSessionId,
      error: error instanceof Error ? error.message : "Unable to execute Browser Action."
    });
  }
  return true;
}
