import {
  buildBrowserActionPlanFromCommand,
  buildIntentFrameFromAction,
  classifyBrowserActionRisk,
  createBrowserViewContextLease,
  summarizeBrowserActionResult,
  summarizeBrowserActionSession,
  summarizeBrowserObservation
} from "../../../browser-action/index.js";
import type { ClientMessage } from "../../../../shared/protocol.js";
import { broadcastLedgerSnapshot } from "../../clientEvents.js";
import { broadcast, send } from "../../events.js";
import { recordRuntimeActivity } from "../../runtimeActivity.js";
import { resolveClientSessionId } from "../../runtime/sessionIds.js";
import {
  buildBrowserActionApprovalBody,
  recordBrowserActionAudit
} from "../helpers.js";
import {
  readBrowserSourceFromSnapshot,
  summarizeBrowserActionPlan
} from "../presentation.js";
import type { BrowserActionMessageContext } from "./context.js";

export async function handleBrowserActionDirectCommandMessage(
  message: ClientMessage,
  context: BrowserActionMessageContext
): Promise<boolean> {
  const { socket, clients, storage, providers, browserPerception, browserActions, browserExtensionBridge } = context;
  if (message.type !== "browserAction.command") {
    return false;
  }

  try {
    const command = message.command;
    const requestId = message.requestId ?? command.id ?? `browser-action-command-${Date.now()}`;
    if (command.kind === "adapter_status") {
      const adapters = await browserActions.getAdapterStatuses(command.actionSessionId);
      send(socket, {
        type: "browserAction.adapters",
        actionSessionId: command.actionSessionId,
        adapters
      });
      return true;
    }

    const sessionId = resolveClientSessionId(storage, command.sessionId);
    const existingSession = command.actionSessionId ? browserActions.get(command.actionSessionId) : undefined;
    const perception = command.adapterId && command.adapterId !== "extension"
      ? undefined
      : await browserPerception.ensureFreshContext({
          providers,
          bridgeStatus: browserExtensionBridge?.snapshot() ?? { connected: false, mode: "disconnected", updatedAt: new Date().toISOString() },
          request: {
            requestId,
            reason: command.kind === "observe" || command.kind === "read" ? "direct_action" : "before_step",
            requiredFreshness: command.kind === "read" || command.kind === "observe" ? "any_visible" : "stable",
            actionRisk: command.kind === "read" || command.kind === "observe" || command.kind === "scroll" ? "read" : "side_effect",
            allowSettlingForRead: command.kind === "read" || command.kind === "observe" || command.kind === "scroll",
            timeoutMs: 35_000,
            settleQuietMs: 500
          },
          onProgress: (detail) => broadcast(clients, {
            type: "browserAction.progress",
            actionSessionId: command.actionSessionId ?? `browser-action-direct-${requestId}`,
            status: "browser_perception_waiting",
            detail
          })
        });
    if (perception && !perception.context) {
      throw new Error(perception.userRecovery ?? `Browser Perception could not prepare active-tab context (${perception.status}).`);
    }
    const session = existingSession ?? browserActions.start({
      id: command.actionSessionId,
      sessionId,
      mode: command.mode,
      source: command.source ?? readBrowserSourceFromSnapshot(perception?.context?.snapshot ?? providers.getDomSnapshot())
    });
    if (!existingSession) {
      recordRuntimeActivity(storage, sessionId, "info", "browser-action", "Direct Browser Action session started", summarizeBrowserActionSession(session));
      broadcast(clients, { type: "browserAction.started", actionSessionId: session.id, summary: summarizeBrowserActionSession(session) });
    }

    const plan = command.kind === "observe"
      ? undefined
      : buildBrowserActionPlanFromCommand({ actionSessionId: session.id, command });
    const firstAction = plan?.steps[0]?.action;
    const transaction = firstAction
      ? browserActions.beginInteraction({
          requestId,
          actionSessionId: session.id,
          sessionId,
          utterance: plan?.goal ?? command.kind,
          source: "direct_ui",
          mode: command.mode ?? session.mode,
          browserSource: command.source
        })
      : undefined;
    const contextLease = perception?.context && firstAction
      ? createBrowserViewContextLease({
          context: perception.context,
          leaseReason: command.kind === "read" ? "direct_action" : "before_step",
          requiredRiskClass: classifyBrowserActionRisk(firstAction)
        })
      : undefined;
    if (transaction && contextLease && firstAction) {
      browserActions.attachInteractionLease(transaction.transactionId, contextLease);
      browserActions.recordInteractionIntent(transaction.transactionId, buildIntentFrameFromAction({
        utterance: plan?.goal ?? command.kind,
        action: firstAction,
        targetPhrase: plan?.steps[0]?.targetSummary,
        confidence: plan?.confidence
      }));
    }

    const observed = command.adapterId && command.adapterId !== "extension"
      ? await browserActions.observeViaAdapter({ actionSessionId: session.id, adapterId: command.adapterId })
      : browserActions.observe({ actionSessionId: session.id, snapshot: perception?.context?.snapshot ?? providers.getDomSnapshot() });
    recordBrowserActionAudit(storage, observed.audit);
    broadcast(clients, {
      type: "browserAction.observation",
      actionSessionId: session.id,
      observationSummary: summarizeBrowserObservation(observed.observation)
    });

    if (command.kind === "observe") {
      recordRuntimeActivity(storage, sessionId, "info", "browser-action", "Direct Browser Action observe completed", summarizeBrowserObservation(observed.observation));
      broadcastLedgerSnapshot(clients, storage, sessionId);
      return true;
    }

    if (!plan) {
      throw new Error(`Browser Action command cannot be planned: ${command.kind}`);
    }
    const execution = await browserActions.executePlan({
      plan,
      snapshot: perception?.context?.snapshot ?? providers.getDomSnapshot(),
      contextLease,
      transaction,
      adapterId: command.adapterId,
      policies: storage.readBrowserActionPolicies()
    });
    for (const audit of execution.audits) {
      recordBrowserActionAudit(storage, audit);
    }
    broadcast(clients, { type: "browserAction.plan", actionSessionId: execution.session.id, plan: summarizeBrowserActionPlan(execution.plan) });
    if (execution.approval) {
      const latestResult = execution.results.at(-1);
      broadcast(clients, {
        type: "interaction.required",
        interaction: {
          id: execution.approval.id,
          requestId,
          kind: "approval",
          title: "Browser action approval",
          body: latestResult ? buildBrowserActionApprovalBody(latestResult) : "Browser Action requires approval.",
          action: `Browser action: ${execution.approval.safety.actionLabel}`
        }
      });
      broadcast(clients, {
        type: "browserAction.progress",
        actionSessionId: execution.session.id,
        status: "direct_approval_required",
        detail: summarizeBrowserActionPlan(execution.plan)
      });
    } else if (execution.command) {
      broadcast(clients, {
        type: "browserAction.progress",
        actionSessionId: execution.session.id,
        status: "direct_paused_for_extension",
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
    recordRuntimeActivity(storage, sessionId, "info", "browser-action", `Direct Browser Action ${execution.plan.status}`, summarizeBrowserActionPlan(execution.plan));
    broadcastLedgerSnapshot(clients, storage, sessionId);
  } catch (error) {
    send(socket, {
      type: "browserAction.error",
      actionSessionId: message.command.actionSessionId ?? "",
      error: error instanceof Error ? error.message : "Unable to execute direct Browser Action command."
    });
  }
  return true;
}
