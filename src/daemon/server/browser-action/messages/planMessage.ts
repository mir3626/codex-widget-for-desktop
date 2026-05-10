import {
  summarizeBrowserActionResult
} from "../../../browser-action/index.js";
import type { ClientMessage } from "../../../../shared/protocol.js";
import { broadcastLedgerSnapshot } from "../../clientEvents.js";
import { broadcast, send } from "../../events.js";
import { recordRuntimeActivity } from "../../runtimeActivity.js";
import { resolveClientSessionId } from "../../runtime/sessionIds.js";
import {
  buildBrowserActionApprovalBody,
  normalizeBrowserActionPlan,
  recordBrowserActionAudit
} from "../helpers.js";
import { summarizeBrowserActionPlan } from "../presentation.js";
import type { BrowserActionMessageContext } from "./context.js";

export async function handleBrowserActionPlanMessage(
  message: ClientMessage,
  context: BrowserActionMessageContext
): Promise<boolean> {
  const { socket, clients, storage, providers, browserPerception, browserActions, browserExtensionBridge } = context;
  if (message.type !== "browserAction.plan") {
    return false;
  }

  try {
    const session = message.actionSessionId
      ? browserActions.get(message.actionSessionId) ?? browserActions.start({ id: message.actionSessionId, sessionId: message.sessionId, mode: message.plan.mode })
      : browserActions.start({ sessionId: message.sessionId, mode: message.plan.mode });
    const plan = normalizeBrowserActionPlan({
      actionSessionId: session.id,
      input: message.plan
    });
    const requestId = message.requestId ?? message.plan.id ?? `browser-action-plan-${Date.now()}`;
    const perception = message.plan.adapterId && message.plan.adapterId !== "extension"
      ? undefined
      : await browserPerception.ensureFreshContext({
          providers,
          bridgeStatus: browserExtensionBridge?.snapshot() ?? { connected: false, mode: "disconnected", updatedAt: new Date().toISOString() },
          request: {
            requestId,
            reason: "before_step",
            requiredFreshness: "stable",
            actionRisk: "side_effect",
            timeoutMs: 35_000,
            settleQuietMs: 500
          },
          onProgress: (detail) => broadcast(clients, {
            type: "browserAction.progress",
            actionSessionId: session.id,
            status: "browser_perception_waiting",
            detail
          })
        });
    if (perception && !perception.context) {
      throw new Error(perception.userRecovery ?? `Browser Perception could not prepare active-tab context (${perception.status}).`);
    }
    const execution = await browserActions.executePlan({
      plan,
      snapshot: perception?.context?.snapshot ?? providers.getDomSnapshot(),
      adapterId: message.plan.adapterId,
      policies: storage.readBrowserActionPolicies()
    });
    for (const audit of execution.audits) {
      recordBrowserActionAudit(storage, audit);
    }
    const sessionId = resolveClientSessionId(storage, execution.session.sessionId);
    broadcast(clients, { type: "browserAction.plan", actionSessionId: execution.session.id, plan: summarizeBrowserActionPlan(execution.plan) });
    if (execution.approval) {
      const latestResult = execution.results.at(-1);
      broadcast(clients, {
        type: "interaction.required",
        interaction: {
          id: execution.approval.id,
          requestId,
          kind: "approval",
          title: "Browser action plan approval",
          body: latestResult ? buildBrowserActionApprovalBody(latestResult) : "Browser Action plan requires approval.",
          action: `Browser action plan: ${execution.approval.safety.actionLabel}`
        }
      });
      broadcast(clients, {
        type: "browserAction.progress",
        actionSessionId: execution.session.id,
        status: "plan_approval_required",
        detail: summarizeBrowserActionPlan(execution.plan)
      });
    } else if (execution.command) {
      broadcast(clients, {
        type: "browserAction.progress",
        actionSessionId: execution.session.id,
        status: "plan_paused_for_extension",
        detail: { requestId: execution.command.requestId, action: execution.command.action.type, plan: summarizeBrowserActionPlan(execution.plan) }
      });
    } else {
      broadcast(clients, {
        type: "browserAction.result",
        actionSessionId: execution.session.id,
        result: {
          plan: summarizeBrowserActionPlan(execution.plan),
          results: execution.results.map(summarizeBrowserActionResult)
        }
      });
    }
    recordRuntimeActivity(storage, sessionId, "info", "browser-action", `Browser Action plan ${execution.plan.status}`, summarizeBrowserActionPlan(execution.plan));
    broadcastLedgerSnapshot(clients, storage, sessionId);
  } catch (error) {
    send(socket, {
      type: "browserAction.error",
      actionSessionId: message.actionSessionId ?? "",
      error: error instanceof Error ? error.message : "Unable to execute Browser Action plan."
    });
  }
  return true;
}
