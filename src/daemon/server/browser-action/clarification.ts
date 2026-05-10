import type { WebSocket } from "ws";
import {
  BrowserActionSessionManager,
  classifyBrowserActionRisk,
  createBrowserViewContextLease,
  summarizeBrowserActionResult,
  summarizeBrowserElement
} from "../../browser-action/index.js";
import type { BrowserPerceptionService } from "../../browser-perception/index.js";
import type { ProviderRegistry } from "../../providers/providerRegistry.js";
import type { SemanticMemoryStore } from "../../semantic-interface/index.js";
import type { StorageService } from "../../storage/storage.js";
import type { ClientMessage } from "../../../shared/protocol.js";
import type { BrowserExtensionBridgeStore } from "../browser-bridge/store.js";
import { broadcastLedgerSnapshot } from "../clientEvents.js";
import { broadcast, send } from "../events.js";
import {
  buildBrowserActionApprovalBody,
  recordBrowserActionAudit
} from "./helpers.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import { recordSemanticClarificationFeedback } from "./clarificationFeedback.js";
import {
  buildSemanticTargetClarificationInteraction,
  renderSemanticTargetClarificationResponse
} from "./clarificationInteraction.js";
import {
  retargetBrowserAction,
  selectSemanticClarificationCandidate
} from "./clarificationTarget.js";
import {
  createSemanticTargetClarification
} from "./clarificationFactory.js";
import type { PendingSemanticClarification } from "./clarificationTypes.js";

export type { PendingSemanticClarification } from "./clarificationTypes.js";
export {
  buildSemanticTargetClarificationInteraction,
  createSemanticTargetClarification,
  renderSemanticTargetClarificationResponse
};

export async function respondToSemanticTargetClarification(input: {
  message: Extract<ClientMessage, { type: "interaction.respond" }>;
  socket: WebSocket;
  clients: Set<WebSocket>;
  storage: StorageService;
  providers: ProviderRegistry;
  browserPerception: BrowserPerceptionService;
  browserExtensionBridge: BrowserExtensionBridgeStore;
  browserActions: BrowserActionSessionManager;
  semanticMemory: SemanticMemoryStore;
  semanticClarifications: Map<string, PendingSemanticClarification>;
}): Promise<boolean> {
  const pending = input.semanticClarifications.get(input.message.id);
  if (!pending) {
    return false;
  }
  if (input.message.decision === "decline") {
    input.semanticClarifications.delete(input.message.id);
    recordRuntimeActivity(input.storage, pending.sessionId, "info", "semantic-memory", "Browser Action target clarification declined", {
      interactionId: pending.id,
      actionSessionId: pending.actionSessionId
    });
    broadcast(input.clients, {
      type: "browserAction.progress",
      actionSessionId: pending.actionSessionId,
      status: "clarification_declined",
      detail: { interactionId: pending.id }
    });
    broadcastLedgerSnapshot(input.clients, input.storage, pending.sessionId);
    return true;
  }

  const selected = selectSemanticClarificationCandidate(pending, input.message.answers?.choice);
  if (!selected) {
    broadcast(input.clients, {
      type: "interaction.required",
      interaction: buildSemanticTargetClarificationInteraction(pending, "입력한 후보를 찾지 못했습니다. 번호 또는 보이는 이름으로 다시 선택해 주세요.")
    });
    send(input.socket, { type: "error", message: "Unable to match that target choice. Use a candidate number or label." });
    return true;
  }

  input.semanticClarifications.delete(input.message.id);
  recordSemanticClarificationFeedback({
    semanticMemory: input.semanticMemory,
    pending,
    selected
  });

  const action = retargetBrowserAction(pending.action, selected);
  const perception = await input.browserPerception.ensureFreshContext({
    providers: input.providers,
    bridgeStatus: input.browserExtensionBridge.snapshot(),
    request: {
      requestId: pending.requestId ?? pending.id,
      reason: "before_step",
      requiredFreshness: "stable",
      actionRisk: classifyBrowserActionRisk(action) === "read" ? "read" : "side_effect",
      allowSettlingForRead: classifyBrowserActionRisk(action) === "read",
      timeoutMs: 35_000,
      settleQuietMs: 500
    },
    onProgress: (detail) => broadcast(input.clients, {
      type: "browserAction.progress",
      actionSessionId: pending.actionSessionId,
      status: "browser_perception_waiting",
      detail: { ...detail, interactionId: pending.id, reason: "clarification_resume" }
    })
  });
  const contextLease = perception.context
    ? createBrowserViewContextLease({
        context: perception.context,
        leaseReason: "clarification_resume",
        requiredRiskClass: classifyBrowserActionRisk(action)
      })
    : undefined;
  if (pending.transactionId && contextLease) {
    input.browserActions.attachInteractionLease(pending.transactionId, contextLease);
  }
  const execution = await input.browserActions.execute({
    actionSessionId: pending.actionSessionId,
    action,
    snapshot: perception.context?.snapshot ?? input.providers.getDomSnapshot(),
    contextLease,
    transaction: input.browserActions.getInteraction(pending.transactionId),
    adapterId: pending.adapterId,
    targetHint: summarizeBrowserElement(selected),
    policies: input.storage.readBrowserActionPolicies()
  });
  recordBrowserActionAudit(input.storage, execution.audit);
  if (execution.approval) {
    broadcast(input.clients, {
      type: "interaction.required",
      interaction: {
        id: execution.approval.id,
        requestId: pending.requestId,
        kind: "approval",
        title: "Browser action approval",
        body: buildBrowserActionApprovalBody(execution.result),
        action: `Browser action: ${execution.result.safety.actionLabel}`
      }
    });
    broadcast(input.clients, {
      type: "browserAction.progress",
      actionSessionId: pending.actionSessionId,
      status: "clarification_selected_approval_required",
      detail: summarizeBrowserActionResult(execution.result)
    });
  } else if (execution.command) {
    broadcast(input.clients, {
      type: "browserAction.progress",
      actionSessionId: pending.actionSessionId,
      status: "clarification_selected_queued",
      detail: { requestId: execution.command.requestId, action: execution.command.action.type, target: summarizeBrowserElement(selected) }
    });
  } else {
    broadcast(input.clients, {
      type: "browserAction.result",
      actionSessionId: pending.actionSessionId,
      result: summarizeBrowserActionResult(execution.result)
    });
  }
  recordRuntimeActivity(input.storage, pending.sessionId, "info", "semantic-memory", "Browser Action target clarification resolved", {
    interactionId: pending.id,
    actionSessionId: pending.actionSessionId,
    selected: summarizeBrowserElement(selected),
    result: summarizeBrowserActionResult(execution.result)
  });
  broadcastLedgerSnapshot(input.clients, input.storage, pending.sessionId);
  return true;
}
