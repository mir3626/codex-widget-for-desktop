import type { WebSocket } from "ws";
import {
  BrowserActionSessionManager,
  classifyBrowserActionRisk,
  createBrowserViewContextLease,
  summarizeBrowserActionResult,
  summarizeBrowserElement,
  type BrowserAction,
  type BrowserActionPlan,
  type BrowserActionResult,
  type BrowserQueuedCommand
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
import {
  waitForBrowserActionCommandResult,
  type BrowserActionCommandWaiter
} from "./commandWaiters.js";
import {
  continuePromptBrowserActionPlan,
  readBrowserActionPromptCommandWaitMs
} from "./promptPlan.js";
import { renderBrowserPromptResponse, summarizeBrowserActionPlan } from "./presentation.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import { recordSemanticClarificationFeedback } from "./clarificationFeedback.js";
import {
  buildSemanticTargetClarificationInteraction,
  formatSemanticTargetClarificationCandidate,
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
  formatSemanticTargetClarificationCandidate,
  renderSemanticTargetClarificationResponse,
  selectSemanticClarificationCandidate
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
  browserActionCommandWaiters: Map<string, BrowserActionCommandWaiter>;
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
  if (!execution.approval && await continueClarifiedPromptPlanIfPossible({
    ...input,
    pending,
    selected,
    action,
    initialResult: execution.result,
    command: execution.command
  })) {
    return true;
  }
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

async function continueClarifiedPromptPlanIfPossible(input: {
  clients: Set<WebSocket>;
  storage: StorageService;
  providers: ProviderRegistry;
  browserExtensionBridge: BrowserExtensionBridgeStore;
  browserActions: BrowserActionSessionManager;
  browserActionCommandWaiters: Map<string, BrowserActionCommandWaiter>;
  pending: PendingSemanticClarification;
  selected: NonNullable<PendingSemanticClarification["candidates"][number]>;
  action: BrowserAction;
  initialResult: BrowserActionResult;
  command?: BrowserQueuedCommand;
}): Promise<boolean> {
  if (!input.pending.plan || !input.pending.results || !input.pending.requestId) {
    return false;
  }
  const plan = prepareClarifiedPlan({
    plan: cloneJson(input.pending.plan),
    pending: input.pending,
    action: input.action,
    result: input.initialResult,
    selected: input.selected
  });
  if (!plan) {
    return false;
  }

  const initialResults = [
    ...input.pending.results.slice(0, -1),
    input.initialResult
  ];
  let completedResult = input.initialResult;
  if (input.command) {
    broadcast(input.clients, {
      type: "browserAction.progress",
      actionSessionId: input.pending.actionSessionId,
      status: "clarification_selected_queued",
      detail: { requestId: input.command.requestId, action: input.command.action.type, target: summarizeBrowserElement(input.selected) }
    });
    const commandResult = await waitForBrowserActionCommandResult({
      requestId: input.command.requestId,
      waiters: input.browserActionCommandWaiters,
      timeoutMs: readBrowserActionPromptCommandWaitMs(input.command.action)
    });
    completedResult = commandResult ?? input.browserActions.failExtensionCommand(
      input.command.requestId,
      `Browser Bridge did not complete the clarified action within ${Math.round(readBrowserActionPromptCommandWaitMs(input.command.action) / 1000)} seconds.`
    ) ?? input.initialResult;
  }

  const continued = await continuePromptBrowserActionPlan({
    plan,
    initialResults,
    completedCommandResult: completedResult,
    providers: input.providers,
    browserActions: input.browserActions,
    browserExtensionBridge: input.browserExtensionBridge,
    storage: input.storage,
    clients: input.clients,
    sessionId: input.pending.sessionId,
    waiters: input.browserActionCommandWaiters
  });

  if (continued.approval) {
    const latestResult = continued.results.at(-1);
    broadcast(input.clients, {
      type: "interaction.required",
      interaction: {
        id: continued.approval.id,
        requestId: input.pending.requestId,
        kind: "approval",
        title: "Browser action approval",
        body: latestResult ? buildBrowserActionApprovalBody(latestResult) : "Browser Action requires approval.",
        action: `Browser action: ${continued.approval.safety.actionLabel}`
      }
    });
    completeClarifiedPromptWithResult({
      ...input,
      plan: continued.plan,
      results: continued.results,
      status: "approval_required"
    });
    return true;
  }

  completeClarifiedPromptWithResult({
    ...input,
    plan: continued.plan,
    results: continued.results,
    status: continued.plan.status
  });
  recordRuntimeActivity(input.storage, input.pending.sessionId, "info", "browser-action", `Prompt Browser Action ${continued.plan.status} after target clarification`, summarizeBrowserActionPlan(continued.plan));
  return true;
}

function prepareClarifiedPlan(input: {
  plan: BrowserActionPlan;
  pending: PendingSemanticClarification;
  action: BrowserAction;
  result: BrowserActionResult;
  selected: NonNullable<PendingSemanticClarification["candidates"][number]>;
}): BrowserActionPlan | undefined {
  const step = input.plan.steps.find((candidate) => candidate.id === input.pending.stepId) ??
    input.plan.steps.find((candidate) => candidate.resultId === input.pending.results?.at(-1)?.id) ??
    input.plan.steps.find((candidate) => candidate.status === "failed" || candidate.status === "running" || candidate.status === "awaiting_extension");
  if (!step) {
    return undefined;
  }
  step.action = input.action;
  step.targetSummary = summarizeBrowserElement(input.selected);
  step.resultId = input.result.id;
  step.status = input.result.status === "pending" ? "awaiting_extension" : "running";
  step.error = undefined;
  step.safety = input.result.safety;
  step.completedAt = input.result.completedAt;
  input.plan.status = "running";
  input.plan.summary = `Continuing Browser Action plan after target clarification at ${step.id}.`;
  return input.plan;
}

function completeClarifiedPromptWithResult(input: {
  clients: Set<WebSocket>;
  storage: StorageService;
  pending: PendingSemanticClarification;
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
  status: BrowserActionPlan["status"] | "approval_required";
}): void {
  broadcast(input.clients, {
    type: "browserAction.result",
    actionSessionId: input.pending.actionSessionId,
    result: {
      plan: summarizeBrowserActionPlan(input.plan),
      results: input.results.map(summarizeBrowserActionResult)
    }
  });
  const text = renderBrowserPromptResponse(input.plan, input.results, input.status, input.pending.utterance);
  input.storage.updateAssistantMessage({
    sessionId: input.pending.sessionId,
    messageId: input.pending.requestId ?? input.pending.id,
    text,
    status: input.status === "approval_required" ? "tooling" : "done"
  });
  if (input.pending.requestId) {
    broadcast(input.clients, {
      type: "message.completed",
      id: input.pending.requestId,
      text
    });
    broadcast(input.clients, {
      type: "session.state",
      state: input.status === "approval_required" ? "tooling" : "idle",
      id: input.pending.requestId
    });
  }
  broadcastLedgerSnapshot(input.clients, input.storage, input.pending.sessionId);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
