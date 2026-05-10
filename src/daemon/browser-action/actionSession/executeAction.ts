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
import type {
  BrowserAction,
  BrowserActionApproval,
  BrowserActionAuditEntry,
  BrowserActionPolicy,
  BrowserActionPolicyMatch,
  BrowserActionResult,
  BrowserActionSession,
  BrowserQueuedCommand
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
  adapterId?: string;
  approved?: boolean;
  targetHint?: string;
  policyMatch?: BrowserActionPolicyMatch;
  policies?: BrowserActionPolicy[];
}): Promise<{ session: BrowserActionSession; result: BrowserActionResult; command?: BrowserQueuedCommand; approval?: BrowserActionApproval; audit: BrowserActionAuditEntry }> {
  const observation = input.session.latestObservation ?? buildBrowserObservation({ source: input.session.source, snapshot: input.snapshot });
  input.session.latestObservation = observation;
  const graph = buildElementGraph({ observationId: observation.id, focusedElementId: observation.focusedElementId, elements: observation.elements });
  const target = readActionTarget(input.action);
  const memoryReadSet = readSemanticMemoryForAction({
    enabled: input.semanticMemoryEnabled,
    semanticMemory: input.semanticMemory,
    observation,
    action: input.action,
    target,
    hint: input.targetHint
  });
  const targetResolution = shouldResolveTarget(input.action, input.targetHint)
    ? resolveTarget({ graph, observation, action: input.action, target, hint: input.targetHint, memoryReadSet })
    : { alternatives: [], confidence: 1, reason: "This browser action does not require a page element target." };
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

  const result = createPendingBrowserActionResult(input, observation, targetResolution, safety);
  input.results.set(result.id, result);
  input.session.timeline.push(createTimelineEvent({
    startedAt: input.session.startedAt,
    type: "resolve",
    summary: targetResolution.reason,
    detail: {
      confidence: targetResolution.confidence,
      alternatives: targetResolution.alternatives.map((element) => element.id),
      semantic: targetResolution.semantic
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
