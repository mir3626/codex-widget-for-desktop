import {
  buildBrowserActionPlanFromCommand,
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
  const { socket, clients, storage, providers, browserActions } = context;
  if (message.type !== "browserAction.command") {
    return false;
  }

  try {
    const command = message.command;
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
    const session = existingSession ?? browserActions.start({
      id: command.actionSessionId,
      sessionId,
      mode: command.mode,
      source: command.source ?? readBrowserSourceFromSnapshot(providers.getDomSnapshot())
    });
    if (!existingSession) {
      recordRuntimeActivity(storage, sessionId, "info", "browser-action", "Direct Browser Action session started", summarizeBrowserActionSession(session));
      broadcast(clients, { type: "browserAction.started", actionSessionId: session.id, summary: summarizeBrowserActionSession(session) });
    }

    const observed = command.adapterId && command.adapterId !== "extension"
      ? await browserActions.observeViaAdapter({ actionSessionId: session.id, adapterId: command.adapterId })
      : browserActions.observe({ actionSessionId: session.id, snapshot: providers.getDomSnapshot() });
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

    const plan = buildBrowserActionPlanFromCommand({ actionSessionId: session.id, command });
    const execution = await browserActions.executePlan({
      plan,
      snapshot: providers.getDomSnapshot(),
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
          requestId: message.requestId,
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
