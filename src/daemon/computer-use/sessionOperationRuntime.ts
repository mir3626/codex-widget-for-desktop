import { randomUUID } from "node:crypto";
import type {
  AutonomyPermissionDecision,
  AutonomyPermissionRequirement,
  CapabilityJobKind,
  CapabilityJobSummary,
  ComputerSessionState,
  ComputerSessionSummary,
  ComputerStructuredOperation
} from "../../shared/protocol.js";
import type { CapabilityRuntime } from "../capability-runtime/index.js";
import type { StorageService } from "../storage/storage.js";
import { verifyComputerSessionEffect, type ComputerSessionEffectVerification } from "./effectVerifier.js";
import {
  bridgeOperationToCapability,
  routeComputerOperation
} from "./operationRouting.js";
import { applyScreenTileCacheToInput } from "./screenObservationRuntime.js";
import {
  evaluateOperationFreshnessRequirement,
  readOperationTimeoutMs,
  waitForCapabilityJobIfRunning
} from "./sessionRuntimeHelpers.js";
import type {
  ComputerSessionOperationResult,
  RuntimeSessionState,
  TerminalOutputRootSnapshot
} from "./sessionRuntimeTypes.js";
import type { BoundedReversibleRegistryMutation } from "./terminalSafetyPolicy.js";

export type TerminalOperationPermissionResult = {
  status: "not_applicable" | "preapproved" | "blocked";
  command: string;
  requirements: AutonomyPermissionRequirement[];
  decision?: AutonomyPermissionDecision;
  reason?: string;
  reversibleRegistryMutation?: BoundedReversibleRegistryMutation;
};

export type ComputerSessionOperationRuntimeHost = {
  storage: StorageService;
  capabilityRuntime: CapabilityRuntime;
  hasBrowserActionExecutor: boolean;
  requireSession: (sessionId: string) => RuntimeSessionState;
  transition: (
    sessionId: string,
    state: ComputerSessionState,
    patch?: Partial<ComputerSessionSummary>
  ) => ComputerSessionSummary;
  block: (sessionId: string, reason: string) => ComputerSessionSummary;
  executeBrowserActionOperation: (
    sessionId: string,
    operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>,
    waitMs?: number
  ) => Promise<ComputerSessionOperationResult>;
  executeToolsmithOperation: (
    sessionId: string,
    operation: Extract<ComputerStructuredOperation, { kind: "toolsmith" }>
  ) => Promise<ComputerSessionOperationResult>;
  executeVisualDesktopWatchOperation: (
    sessionId: string,
    operation: Extract<ComputerStructuredOperation, { kind: "visual_desktop_action" }>
  ) => ComputerSessionOperationResult;
  executeBrowserPermissionBubbleBoundaryOperation: (
    sessionId: string,
    operation: Extract<ComputerStructuredOperation, { kind: "browser_permission_bubble_action" }>
  ) => ComputerSessionOperationResult;
  executeNativeFilePickerBoundaryOperation: (
    sessionId: string,
    operation: Extract<ComputerStructuredOperation, { kind: "native_file_picker_action" }>
  ) => ComputerSessionOperationResult;
  evaluateTerminalOperationPermission: (sessionId: string, input: Record<string, unknown>) => TerminalOperationPermissionResult;
  consumeOneTimePermissionProfile: (state: RuntimeSessionState, phase: string) => unknown;
  captureTerminalOutputRootSnapshots: (sessionId: string, input: Record<string, unknown>) => TerminalOutputRootSnapshot[];
  setTerminalOutputRootSnapshots: (dagNodeId: string, snapshots: TerminalOutputRootSnapshot[]) => void;
  recordCapabilityOperationObservation: (input: {
    sessionId: string;
    operation?: ComputerStructuredOperation;
    job: CapabilityJobSummary;
    dagNodeId: string;
    capabilityKind: CapabilityJobKind;
  }) => unknown;
  recordEffectVerificationStep: (input: {
    sessionId: string;
    dagNodeId: string;
    job: CapabilityJobSummary;
    verification: ComputerSessionEffectVerification;
  }) => void;
  recordVerifierResult: (sessionId: string, result: unknown) => void;
  recordRecoveryAttempt: (input: {
    sessionId: string;
    dagNodeId: string;
    job: CapabilityJobSummary;
    verification: ComputerSessionEffectVerification;
  }) => void;
};

export async function executeOperation(
  host: ComputerSessionOperationRuntimeHost,
  input: {
    sessionId: string;
    operation: ComputerStructuredOperation;
    waitMs?: number;
  }
): Promise<ComputerSessionOperationResult> {
  const state = host.requireSession(input.sessionId);
  if (!state.summary.evalRunId || !state.summary.dagRunId) {
    throw new Error("Computer session must be started before executing operations.");
  }
  if (input.operation.kind === "browser_action" && host.hasBrowserActionExecutor) {
    return await host.executeBrowserActionOperation(input.sessionId, input.operation, input.waitMs);
  }
  if (input.operation.kind === "toolsmith") {
    return await host.executeToolsmithOperation(input.sessionId, input.operation);
  }
  if (input.operation.kind === "visual_desktop_action") {
    return host.executeVisualDesktopWatchOperation(input.sessionId, input.operation);
  }
  if (input.operation.kind === "browser_permission_bubble_action") {
    return host.executeBrowserPermissionBubbleBoundaryOperation(input.sessionId, input.operation);
  }
  if (input.operation.kind === "native_file_picker_action") {
    return host.executeNativeFilePickerBoundaryOperation(input.sessionId, input.operation);
  }
  const bridge = bridgeOperationToCapability(input.operation);
  if (!bridge) {
    const actionRoute = routeComputerOperation(input.operation, state.summary);
    const node = host.storage.upsertCapabilityDagNode({
      id: `${input.sessionId}:operation:${randomUUID()}`,
      dagRunId: state.summary.dagRunId,
      kind: "action",
      status: "failed",
      input: { operation: input.operation, actionRoute },
      output: { ok: false, reason: "operation_not_capability_backed", actionRoute },
      lastError: "operation_not_capability_backed"
    });
    host.block(input.sessionId, "operation_not_capability_backed");
    return { session: state.summary, dagNode: node };
  }
  if (bridge.kind === "screen_observe") {
    bridge.input = applyScreenTileCacheToInput(state, bridge.input);
  }
  host.transition(input.sessionId, "executing");
  const actionRoute = routeComputerOperation(input.operation, state.summary);
  const dagNode = host.storage.upsertCapabilityDagNode({
    id: `${input.sessionId}:operation:${randomUUID()}`,
    dagRunId: state.summary.dagRunId,
    kind: bridge.kind === "screen_observe" || bridge.kind === "ocr" ? "observe" : "action",
    status: "running",
    capabilityKind: bridge.kind,
    input: { capabilityInput: bridge.input, actionRoute },
    startedAt: new Date().toISOString()
  });
  const freshnessRequirement = evaluateOperationFreshnessRequirement(state.observations, input.operation);
  if (freshnessRequirement.status === "blocked") {
    const now = new Date().toISOString();
    const reason = freshnessRequirement.reason ?? "fresh_observation_required";
    state.safetyDecisions.push({
      decision: "blocked",
      phase: "evidence_freshness_check",
      reason,
      latestObservationId: freshnessRequirement.latestObservation?.id,
      freshness: freshnessRequirement.latestObservation?.freshness ?? "unknown",
      requiredMaxAgeMs: freshnessRequirement.maxAgeMs
    });
    const failedNode = host.storage.upsertCapabilityDagNode({
      id: dagNode.id,
      dagRunId: state.summary.dagRunId,
      kind: dagNode.kind,
      status: "failed",
      capabilityKind: bridge.kind,
      input: { capabilityInput: bridge.input, actionRoute },
      output: {
        ok: false,
        reason,
        latestObservationId: freshnessRequirement.latestObservation?.id,
        freshness: freshnessRequirement.latestObservation?.freshness ?? "unknown",
        requiredMaxAgeMs: freshnessRequirement.maxAgeMs
      },
      startedAt: dagNode.startedAt,
      completedAt: now,
      elapsedMs: 0,
      lastError: reason
    });
    host.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "evidence_freshness_check",
      phase: "observe",
      status: "blocked",
      capabilityDagNodeId: failedNode.id,
      input: {
        operationKind: input.operation.kind,
        maxAgeMs: freshnessRequirement.maxAgeMs
      },
      output: {
        reason,
        latestObservation: freshnessRequirement.latestObservation
      },
      failureClass: "perception_miss",
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
    host.block(input.sessionId, reason);
    return {
      session: host.requireSession(input.sessionId).summary,
      dagNode: failedNode
    };
  }
  const terminalPermission = bridge.kind === "terminal"
    ? host.evaluateTerminalOperationPermission(input.sessionId, bridge.input)
    : { status: "not_applicable" as const };
  if (terminalPermission.status === "blocked") {
    const now = new Date().toISOString();
    const reason = terminalPermission.reason ?? "terminal_permission_profile_blocked";
    state.safetyDecisions.push({
      decision: "blocked",
      phase: "terminal_permission_profile",
      profileId: state.summary.profileId,
      reason,
      missingRequirements: terminalPermission.decision?.missingRequirements ?? terminalPermission.requirements,
      usedRequirements: terminalPermission.decision?.usedRequirements ?? [],
      credentialPolicy: terminalPermission.decision?.credentialPolicy,
      command: terminalPermission.command
    });
    const failedNode = host.storage.upsertCapabilityDagNode({
      id: dagNode.id,
      dagRunId: state.summary.dagRunId,
      kind: dagNode.kind,
      status: "failed",
      capabilityKind: bridge.kind,
      input: bridge.input,
      output: {
        ok: false,
        reason: terminalPermission.reason,
        command: terminalPermission.command,
        missingRequirements: terminalPermission.decision?.missingRequirements ?? terminalPermission.requirements,
        safetyBoundaries: terminalPermission.decision?.safetyBoundaries ?? [],
        credentialPolicy: terminalPermission.decision?.credentialPolicy
      },
      startedAt: dagNode.startedAt,
      completedAt: now,
      elapsedMs: 0,
      lastError: reason
    });
    host.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "terminal_permission_profile",
      phase: "approval",
      status: "blocked",
      capabilityDagNodeId: failedNode.id,
      input: {
        command: terminalPermission.command,
        profileId: state.summary.profileId,
        requirements: terminalPermission.requirements
      },
      output: {
        reason,
        missingRequirements: terminalPermission.decision?.missingRequirements ?? terminalPermission.requirements,
        credentialPolicy: terminalPermission.decision?.credentialPolicy
      },
      failureClass: "approval_denied",
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
    host.block(input.sessionId, reason);
    return {
      session: host.requireSession(input.sessionId).summary,
      dagNode: failedNode
    };
  }
  if (terminalPermission.status === "preapproved" && terminalPermission.decision) {
    const reversibleEvidence = terminalPermission.reversibleRegistryMutation
      ? { reversibleRegistryMutation: terminalPermission.reversibleRegistryMutation }
      : {};
    state.safetyDecisions.push({
      decision: "allow",
      phase: "terminal_permission_profile",
      profileId: state.summary.profileId,
      reason: terminalPermission.decision.reason,
      usedRequirements: terminalPermission.decision.usedRequirements,
      credentialPolicy: terminalPermission.decision.credentialPolicy,
      command: terminalPermission.command,
      ...reversibleEvidence
    });
    host.consumeOneTimePermissionProfile(state, "terminal_permission_profile");
  }
  if (bridge.kind === "terminal") {
    const snapshots = host.captureTerminalOutputRootSnapshots(input.sessionId, bridge.input);
    if (snapshots.length) {
      host.setTerminalOutputRootSnapshots(dagNode.id, snapshots);
    }
  }
  const job = await host.capabilityRuntime.enqueue({
    kind: bridge.kind,
    sessionId: input.sessionId,
    priority: "interactive",
    requestedBy: "direct_ui",
    requireApproval: terminalPermission.status === "preapproved" ? false : undefined,
    input: {
      ...bridge.input,
      dagRunId: state.summary.dagRunId,
      dagNodeId: dagNode.id,
      evalRunId: state.summary.evalRunId,
      ...(terminalPermission.status === "preapproved" ? {
        permissionProfileId: state.summary.profileId,
        permissionDecision: terminalPermission.decision
      } : {})
    },
    timeoutMs: readOperationTimeoutMs(bridge.input)
  });
  const finalJob = await waitForCapabilityJobIfRunning(host.capabilityRuntime, job.id, input.waitMs ?? 5000);
  const latestNode = host.storage.readCapabilityDagNode(dagNode.id) ?? dagNode;
  if (finalJob.status === "awaiting_approval") {
    host.transition(input.sessionId, "awaiting_action_confirmation", {
      requiresUserAction: finalJob.approvalId ?? "approval_required"
    });
    return { session: host.requireSession(input.sessionId).summary, dagNode: latestNode, job: finalJob };
  }
  if (finalJob.status === "completed") {
    host.recordCapabilityOperationObservation({
      sessionId: input.sessionId,
      operation: input.operation,
      job: finalJob,
      dagNodeId: dagNode.id,
      capabilityKind: bridge.kind
    });
    host.transition(input.sessionId, "verifying");
    const verification = verifyComputerSessionEffect({
      operation: input.operation,
      capabilityKind: bridge.kind,
      job: finalJob,
      recoveryBudgetRemaining: Math.max(0, 1 - state.recoveryAttempts)
    });
    host.recordEffectVerificationStep({
      sessionId: input.sessionId,
      dagNodeId: dagNode.id,
      job: finalJob,
      verification
    });
    host.recordVerifierResult(input.sessionId, {
      id: `verifier:${finalJob.id}`,
      ...verification
    });
    if (verification.status === "passed") {
      host.transition(input.sessionId, "completed");
    } else {
      host.recordRecoveryAttempt({
        sessionId: input.sessionId,
        dagNodeId: dagNode.id,
        job: finalJob,
        verification
      });
      host.transition(input.sessionId, "failed", {
        blockedReason: verification.reason
      });
    }
  } else if (finalJob.status === "running" || finalJob.status === "scheduled" || finalJob.status === "queued") {
    host.transition(input.sessionId, "executing");
  } else {
    host.transition(input.sessionId, "failed", { blockedReason: finalJob.lastError ?? `Capability job ${finalJob.status}` });
  }
  return {
    session: host.requireSession(input.sessionId).summary,
    dagNode: host.storage.readCapabilityDagNode(dagNode.id) ?? latestNode,
    job: finalJob
  };
}
