import { randomUUID } from "node:crypto";
import { buildBrowserObservation } from "../browserObservation.js";
import { createBrowserQueuedCommand } from "../actionExecutor.js";
import { createTimelineEvent } from "../actionTimeline.js";
import { buildElementGraph } from "../elementGraph.js";
import { auditActionResult } from "../auditLog.js";
import { BrowserActionAdapterRegistry } from "../adapterRegistry.js";
import { applyBrowserActionPolicyToSafety, matchBrowserActionPolicy } from "../permissionPolicy.js";
import { decideBrowserActionSafety } from "../safetyPolicy.js";
import { resolveTarget } from "../targetResolver.js";
import type { SemanticMemoryStore } from "../../semantic-interface/memory/types.js";
import {
  buildIntentFrameFromAction,
  decideCandidatePlanningGate,
  generateCandidateSteps,
  isBrowserViewContextLeaseUsableForAction,
  publishBrowserInteractionFeedback,
  summarizeBrowserViewContextLease
} from "../interaction/index.js";
import type {
  BrowserInteractionTransaction,
  BrowserViewContextLease
} from "../interaction/types.js";
import type {
  BrowserAction,
  BrowserActionApproval,
  BrowserActionAuditEntry,
  BrowserActionPolicy,
  BrowserActionPolicyMatch,
  BrowserActionResult,
  BrowserActionSession,
  BrowserExpectedState,
  BrowserQueuedCommand,
  TargetResolution
} from "../types.js";
import { cloneResult, cloneSession } from "./cloning.js";
import { executeViaAdapter } from "./adapterExecution.js";
import {
  readActionTarget,
  readActionTimeoutMs,
  readExpectedSourceForCommand,
  readExtensionCommandPickupTimeoutMs,
  shouldResolveTarget
} from "./helpers.js";
import {
  readSemanticMemoryForAction,
  recordUnresolvedTargetCase
} from "./semanticMemory.js";
import {
  createBrowserActionApproval,
  createPendingBrowserActionResult
} from "./resultFactory.js";

export async function executeBrowserAction(input: {
  session: BrowserActionSession;
  adapters: BrowserActionAdapterRegistry;
  results: Map<string, BrowserActionResult>;
  pendingCommands: BrowserQueuedCommand[];
  pendingApprovals: Map<string, BrowserActionApproval>;
  commandResultIds: Map<string, string>;
  semanticMemoryEnabled: boolean;
  semanticMemory?: SemanticMemoryStore;
  action: BrowserAction;
  snapshot: unknown;
  contextLease?: BrowserViewContextLease;
  transaction?: BrowserInteractionTransaction;
  expected?: BrowserExpectedState[];
  adapterId?: string;
  approved?: boolean;
  targetHint?: string;
  policyMatch?: BrowserActionPolicyMatch;
  policies?: BrowserActionPolicy[];
}): Promise<{ session: BrowserActionSession; result: BrowserActionResult; command?: BrowserQueuedCommand; approval?: BrowserActionApproval; audit: BrowserActionAuditEntry }> {
  const observation = input.contextLease?.context.observation ?? input.session.latestObservation ?? buildBrowserObservation({ source: input.session.source, snapshot: input.snapshot });
  input.session.latestObservation = observation;
  const graph = buildElementGraph({ observationId: observation.id, focusedElementId: observation.focusedElementId, elements: observation.elements });
  const target = readActionTarget(input.action);
  const intentFrame = buildIntentFrameFromAction({
    utterance: input.transaction?.utterance ?? input.targetHint ?? input.action.type,
    action: input.action,
    targetPhrase: input.targetHint || (target?.kind === "text" ? target.text : undefined)
  });
  const memoryReadSet = readSemanticMemoryForAction({
    enabled: input.semanticMemoryEnabled,
    semanticMemory: input.semanticMemory,
    observation,
    action: input.action,
    target,
    hint: input.targetHint
  });
  const candidateSteps = generateCandidateSteps({
    action: input.action,
    graph,
    target,
    hint: input.targetHint,
    lease: input.contextLease,
    expected: input.expected,
    memoryEvidence: memoryReadSet ? {
      readSetId: memoryReadSet.id,
      edgeCount: memoryReadSet.edges.length,
      exclusionCount: memoryReadSet.exclusions.length
    } : undefined
  });
  const gate = decideCandidatePlanningGate({
    action: input.action,
    candidates: candidateSteps,
    locale: input.transaction?.locale,
    requireFreshLease: Boolean(input.contextLease)
  });
  const selectedCandidate = candidateSteps.find((candidate) => candidate.candidateId === gate.selectedCandidateId) ?? candidateSteps[0];
  if (input.contextLease && !isBrowserViewContextLeaseUsableForAction(input.contextLease, input.action) && selectedCandidate?.riskClass !== "read") {
    const reason = input.transaction?.locale === "ko"
      ? "페이지 이해가 최신 상태가 아니어서 실행 전에 다시 읽어야 합니다."
      : "The browser view lease is stale and must be refreshed before execution.";
    const result = createPendingBrowserActionResult({
      ...input,
      expected: input.expected,
      transaction: {
        transactionId: input.transaction?.transactionId,
        leaseId: input.contextLease.leaseId,
        contextId: input.contextLease.contextId,
        candidateId: selectedCandidate?.candidateId,
        viewRevision: input.contextLease.viewRevision,
        graphDigest: input.contextLease.graphDigest
      }
    }, observation, {
      primary: selectedCandidate?.element,
      alternatives: candidateSteps.slice(1, 5).map((candidate) => candidate.element).filter((element): element is NonNullable<typeof element> => Boolean(element)),
      confidence: selectedCandidate?.confidence ?? 0,
      reason
    }, {
      decision: "clarify",
      risk: "medium",
      reason,
      actionLabel: input.action.type,
      targetSummary: input.targetHint,
      destructive: false,
      metadata: {
        browserInteraction: {
          intentFrame,
          gate,
          lease: summarizeBrowserViewContextLease(input.contextLease)
        }
      }
    });
    result.safety.decision = "block";
    result.status = "failed";
    result.completedAt = new Date().toISOString();
    result.error = reason;
    result.verification = { status: "failed", reason };
    input.results.set(result.id, result);
    return { session: cloneSession(input.session), result: cloneResult(result), audit: auditActionResult(input.session, result) };
  }
  const candidateBoundResolution = createCandidateBoundTargetResolution({
    action: input.action,
    target,
    gateDecision: gate.decision,
    selectedCandidate,
    candidateSteps
  });
  const semanticResolution = shouldResolveTarget(input.action, input.targetHint)
    ? resolveTarget({ graph, observation, action: input.action, target, hint: input.targetHint, memoryReadSet })
    : undefined;
  const targetResolution = candidateBoundResolution
    ? {
        ...candidateBoundResolution,
        semantic: semanticResolution?.semantic,
        reason: semanticResolution?.semantic
          ? `${candidateBoundResolution.reason} Semantic trace retained for audit metadata.`
          : candidateBoundResolution.reason
      }
    : semanticResolution ?? { alternatives: [], confidence: 1, reason: "This browser action does not require a page element target." };
  if (gate.decision === "clarify" && candidateSteps.length > 1 && !isExactElementBinding(target) && !hasStrongSemanticTargetSelection(targetResolution)) {
    targetResolution.primary = candidateSteps[0]?.element ?? targetResolution.primary;
    targetResolution.alternatives = candidateSteps.slice(1, 5).map((candidate) => candidate.element).filter((element): element is NonNullable<typeof element> => Boolean(element));
    targetResolution.confidence = Math.min(targetResolution.confidence, gate.confidence, 0.57);
    targetResolution.reason = `${gate.userFacingMessage} ${targetResolution.reason}`;
  }
  const baseSafety = decideBrowserActionSafety({
    action: input.action,
    target: targetResolution.primary,
    targetConfidence: targetResolution.confidence,
    mode: input.session.mode
  });
  const policyMatch = input.policyMatch ?? (input.policies
    ? matchBrowserActionPolicy({
        policies: input.policies,
        action: input.action,
        target: targetResolution.primary,
        observation,
        mode: input.session.mode,
        safety: baseSafety
      })
    : undefined);
  const safety = applyBrowserActionPolicyToSafety({ safety: baseSafety, match: policyMatch });
  if (targetResolution.semantic) {
    safety.metadata = {
      ...(safety.metadata ?? {}),
      semanticInterface: {
        outcome: targetResolution.semantic.outcome,
        selectedElementId: targetResolution.semantic.selectedElementId,
        trace: targetResolution.semantic.trace
      }
    };
  }
  if (memoryReadSet) {
    safety.metadata = {
      ...(safety.metadata ?? {}),
      semanticMemory: {
        readSetId: memoryReadSet.id,
        resultHash: memoryReadSet.resultHash,
        edgeCount: memoryReadSet.edges.length,
        exclusionCount: memoryReadSet.exclusions.length
      }
    };
  }
  safety.metadata = {
    ...(safety.metadata ?? {}),
    browserInteraction: {
      transactionId: input.transaction?.transactionId,
      intentFrame,
      gate: {
        decision: gate.decision,
        selectedCandidateId: gate.selectedCandidateId,
        confidence: gate.confidence,
        margin: gate.margin,
        reasonCodes: gate.reasonCodes
      },
      candidates: candidateSteps.slice(0, 5).map((candidate) => ({
        candidateId: candidate.candidateId,
        label: candidate.label,
        role: candidate.role,
        region: candidate.region,
        confidence: candidate.confidence,
        reasonCodes: candidate.reasonCodes,
        elementId: candidate.element?.id
      })),
      lease: summarizeBrowserViewContextLease(input.contextLease)
    }
  };

  const result = createPendingBrowserActionResult({
    ...input,
    expected: input.expected,
    transaction: {
      transactionId: input.transaction?.transactionId,
      leaseId: input.contextLease?.leaseId,
      contextId: input.contextLease?.contextId,
      candidateId: gate.selectedCandidateId ?? selectedCandidate?.candidateId,
      viewRevision: input.contextLease?.viewRevision,
      graphDigest: input.contextLease?.graphDigest
    }
  }, observation, targetResolution, safety);
  input.results.set(result.id, result);
  input.session.timeline.push(createTimelineEvent({
    startedAt: input.session.startedAt,
    type: "resolve",
    summary: targetResolution.reason,
    detail: {
      confidence: targetResolution.confidence,
      alternatives: targetResolution.alternatives.map((element) => element.id),
      semantic: targetResolution.semantic,
      browserInteraction: safety.metadata?.browserInteraction
    }
  }));

  if (safety.decision === "block" || safety.decision === "clarify") {
    if (safety.decision === "clarify") {
      recordUnresolvedTargetCase({
        enabled: input.semanticMemoryEnabled,
        semanticMemory: input.semanticMemory,
        observation,
        action: input.action,
        target,
        hint: input.targetHint,
        resolution: targetResolution
      });
    }
    result.status = safety.decision === "block" ? "failed" : "needs_clarification";
    result.completedAt = new Date().toISOString();
    result.error = safety.reason;
    result.verification = { status: "failed", reason: safety.reason };
    input.session.timeline.push(createTimelineEvent({ startedAt: input.session.startedAt, type: "result", summary: `Browser action ${result.status}`, detail: { safety } }));
    publishBrowserInteractionFeedback({
      enabled: input.semanticMemoryEnabled,
      semanticMemory: input.semanticMemory,
      transaction: input.transaction,
      intentFrame,
      candidates: candidateSteps,
      result,
      utterance: input.transaction?.utterance
    });
    return { session: cloneSession(input.session), result: cloneResult(result), audit: auditActionResult(input.session, result) };
  }

  if (safety.decision === "confirm" && !input.approved) {
    const approval = createBrowserActionApproval(input, result, targetResolution.primary, safety);
    input.session.approvals.push(approval);
    input.pendingApprovals.set(approval.id, approval);
    input.session.timeline.push(createTimelineEvent({ startedAt: input.session.startedAt, type: "approval", summary: safety.reason, detail: { approvalId: approval.id } }));
    return { session: cloneSession(input.session), result: cloneResult(result), approval, audit: auditActionResult(input.session, result) };
  }

  if (input.action.type === "read") {
    result.status = "succeeded";
    result.completedAt = new Date().toISOString();
    result.after = observation;
    result.verification = { status: "passed", reason: "Read action returned the current browser observation." };
    input.session.timeline.push(createTimelineEvent({ startedAt: input.session.startedAt, type: "result", summary: "Browser read completed", detail: { resultId: result.id } }));
    publishBrowserInteractionFeedback({
      enabled: input.semanticMemoryEnabled,
      semanticMemory: input.semanticMemory,
      transaction: input.transaction,
      intentFrame,
      candidates: candidateSteps,
      result,
      utterance: input.transaction?.utterance
    });
    return { session: cloneSession(input.session), result: cloneResult(result), audit: auditActionResult(input.session, result) };
  }

  if (input.adapterId && input.adapterId !== "extension") {
    return executeViaAdapter({ adapters: input.adapters, adapterId: input.adapterId, session: input.session, result, observation });
  }

  const command = createBrowserQueuedCommand({
    requestId: `browser-command-${randomUUID()}`,
    actionSessionId: input.session.id,
    resultId: result.id,
    adapterId: input.adapterId ?? "extension",
    action: input.action,
    target: targetResolution.primary,
    expectedSource: readExpectedSourceForCommand(input.session, observation),
    timeoutMs: readActionTimeoutMs(input.action),
    expiresInMs: readExtensionCommandPickupTimeoutMs()
  });
  input.commandResultIds.set(command.requestId, result.id);
  input.pendingCommands.push(command);
  input.session.timeline.push(createTimelineEvent({ startedAt: input.session.startedAt, type: "execute", summary: `Queued browser action: ${input.action.type}`, detail: { requestId: command.requestId, resultId: result.id } }));
  return { session: cloneSession(input.session), result: cloneResult(result), command, audit: auditActionResult(input.session, result) };
}

function isExactElementBinding(target: ReturnType<typeof readActionTarget>): boolean {
  return target?.kind === "element_id" || target?.kind === "focused" || target?.kind === "bbox";
}

function createCandidateBoundTargetResolution(input: {
  action: BrowserAction;
  target: ReturnType<typeof readActionTarget>;
  gateDecision: string;
  selectedCandidate: ReturnType<typeof generateCandidateSteps>[number] | undefined;
  candidateSteps: ReturnType<typeof generateCandidateSteps>;
}): TargetResolution | undefined {
  if (input.gateDecision !== "proceed" || isExactElementBinding(input.target) || !input.selectedCandidate?.element) {
    return undefined;
  }
  if (!("target" in input.action)) {
    return undefined;
  }
  return {
    primary: input.selectedCandidate.element,
    alternatives: input.candidateSteps
      .filter((candidate) => candidate.candidateId !== input.selectedCandidate?.candidateId)
      .map((candidate) => candidate.element)
      .filter((element): element is NonNullable<typeof element> => Boolean(element))
      .slice(0, 4),
    confidence: input.selectedCandidate.confidence,
    reason: `Using transaction-selected browser candidate ${input.selectedCandidate.candidateId} (${input.selectedCandidate.label}).`
  };
}

function hasStrongSemanticTargetSelection(resolution: TargetResolution): boolean {
  return resolution.semantic?.outcome === "act" &&
    Boolean(resolution.primary) &&
    resolution.semantic.selectedElementId === resolution.primary?.id &&
    resolution.confidence >= 0.75;
}
