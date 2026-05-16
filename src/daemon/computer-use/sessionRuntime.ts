import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { WidgetMode } from "../../shared/protocol.js";
import type {
  CapabilityDagNodeSummary,
  CapabilityJobKind,
  CapabilityJobSummary,
  AutonomyPermissionProfile,
  AutonomyPermissionDecision,
  AutonomyPermissionRequirement,
  AutonomyRiskClass,
  ComputerSessionCreateInput,
  ComputerSessionActionFeedbackSummary,
  ComputerSessionDebugBundle,
  ComputerSessionFreshnessSummary,
  ComputerSessionEvent,
  ComputerSessionObservationKind,
  ComputerSessionObservationResourceSummary,
  ComputerSessionObservationSummary,
  ComputerSessionPromptRunSummary,
  ComputerSessionPromptStepSummary,
  ComputerSessionPromptStepStatus,
  ComputerSessionRollbackActionSummary,
  ComputerSessionStartResult,
  ComputerSessionState,
  ComputerSessionSummary,
  ComputerStructuredOperation,
  ComputerUseEvalModality,
  ExecutionSurfaceDecision,
  ForegroundWatchExecutorState,
  ForegroundWatchPreflightState,
  NormalizedComputerActionBatch,
  PerceptionActionRisk,
  PerceptionGraphSummary,
  RiskClass
} from "../../shared/protocol.js";
import { normalizeComputerActionBatch } from "../../shared/protocol.js";
import {
  planBrowserActionFromPrompt,
  type BrowserActionResult,
  type BrowserObservation,
  type BrowserActionPromptPlan,
  type BrowserActionSource
} from "../browser-action/index.js";
import { closePlaywrightBrowserSession } from "../browser-action/adapters/playwright/runtime.js";
import type { CapabilityRuntime } from "../capability-runtime/index.js";
import { CapabilityDagRuntime } from "../capability-dag/index.js";
import { auditComputerUseVerifier, finalizeEvalRunFromSteps } from "../computer-use-eval/index.js";
import { recordStructuredFailure } from "../failure-memory/index.js";
import { arbitratePerceptionTarget, buildPerceptionGraphFromBrowserObservation, buildPerceptionGraphFromNativeObservation, buildPerceptionGraphFromOcr, buildPerceptionGraphFromScreenObservation } from "../perception-graph/index.js";
import { ScopedAutonomyRuntime, type ScopedAutonomyDagResult } from "../scoped-autonomy/index.js";
import { evaluateAutonomyPermission } from "../scoped-autonomy/permissionProfile.js";
import type { StorageService } from "../storage/storage.js";
import { verifyComputerSessionEffect, type ComputerSessionEffectVerification } from "./effectVerifier.js";
import { ExecutionSurfaceManager } from "./surfaceManager.js";

export type ComputerSessionRuntimeOptions = {
  storage: StorageService;
  capabilityRuntime: CapabilityRuntime;
  dagRuntime?: CapabilityDagRuntime;
  surfaceManager?: ExecutionSurfaceManager;
  executors?: {
    browserAction?: ComputerSessionOperationExecutor;
  };
  emit?: (event: ComputerSessionEvent) => void;
};

export type ComputerSessionOperationExecutor = (input: {
  session: ComputerSessionSummary;
  operation: ComputerStructuredOperation;
  dagRunId: string;
  dagNodeId: string;
  evalRunId: string;
}) => Promise<{
  status: "completed" | "running" | "awaiting_approval" | "failed" | "cancelled";
  capabilityJob?: CapabilityJobSummary;
  output?: unknown;
  summary?: string;
  error?: string;
}>;

export type ComputerSessionOperationResult = {
  session: ComputerSessionSummary;
  dagNode: CapabilityDagNodeSummary;
  job?: CapabilityJobSummary;
};

type BrowserActionExecutorResult = Awaited<ReturnType<ComputerSessionOperationExecutor>>;

type BrowserActionAdapterFallbackPlan = {
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>;
  actionRoute: Record<string, unknown>;
  reason: string;
  fromAdapter?: string;
  toAdapter: string;
};

type TerminalOutputRootSnapshot = {
  root: string;
  files: Map<string, { size: number; mtimeMs: number; sha256: string }>;
};

type TerminalOutputRootDeltaEntry = {
  path: string;
  root: string;
  change: "created" | "modified" | "deleted";
  basename: string;
  relativePathHash: string;
  depth: number;
  size?: number;
  mtimeMs?: number;
  sha256?: string;
  previousSize?: number;
  previousSha256?: string;
};

type TerminalOutputRootDeltaResult = {
  resources: ComputerSessionObservationResourceSummary[];
  manifestResource?: ComputerSessionObservationResourceSummary;
  summary: {
    outputRootCount: number;
    createdCount: number;
    modifiedCount: number;
    deletedCount: number;
    capturedArtifactCount: number;
    manifestEntryCount: number;
    omittedEntryCount: number;
    rollbackCandidateCount: number;
  };
  rollbackTargets: TerminalArtifactRollbackTarget[];
};

type TerminalArtifactRollbackTarget = {
  path: string;
  basename: string;
  sha256: string;
  size: number;
  change: "created";
  blobId?: string;
  evalResourceId?: string;
};

type ScreenTileCache = {
  tileHashes: unknown[];
  capturedAt: string;
  observationId?: string;
};

export type ComputerSessionPromptPlanResult = {
  session: ComputerSessionSummary;
  plan?: BrowserActionPromptPlan;
  promptRun?: ComputerSessionPromptRunSummary;
  operation?: ComputerSessionOperationResult;
  blockedReason?: string;
};

type RuntimeSessionState = {
  summary: ComputerSessionSummary;
  observations: ComputerSessionObservationSummary[];
  actionFeedbacks: ComputerSessionActionFeedbackSummary[];
  actionBatches: NormalizedComputerActionBatch[];
  promptRuns: ComputerSessionPromptRunSummary[];
  rollbackActions: ComputerSessionRollbackActionSummary[];
  safetyDecisions: unknown[];
  verifierResults: unknown[];
  recoveryAttempts: number;
  screenTileCache?: ScreenTileCache;
};

export class ComputerSessionRuntime {
  private readonly dagRuntime: CapabilityDagRuntime;
  private readonly surfaceManager: ExecutionSurfaceManager;
  private readonly sessions = new Map<string, RuntimeSessionState>();
  private readonly promptPlans = new Map<string, BrowserActionPromptPlan>();
  private readonly terminalOutputRootSnapshots = new Map<string, TerminalOutputRootSnapshot[]>();

  constructor(private readonly options: ComputerSessionRuntimeOptions) {
    this.dagRuntime = options.dagRuntime ?? new CapabilityDagRuntime(options.storage, options.capabilityRuntime);
    this.surfaceManager = options.surfaceManager ?? new ExecutionSurfaceManager();
    this.hydratePersistedSessions();
  }

  create(input: ComputerSessionCreateInput): ComputerSessionSummary {
    const now = new Date().toISOString();
    const sessionId = input.sessionId?.trim() || this.options.storage.createSession({
      title: `Computer Use: ${input.userRequest.slice(0, 80)}`
    }).activeSessionId;
    const summary: ComputerSessionSummary = {
      sessionId,
      userRequest: input.userRequest,
      profileId: input.profileId,
      riskClass: input.riskClass ?? inferRiskClass(input.userRequest),
      state: "created",
      createdAt: now,
      updatedAt: now
    };
    const runtimeState: RuntimeSessionState = {
      summary,
      observations: [],
      actionFeedbacks: [],
      actionBatches: [],
      promptRuns: [],
      rollbackActions: [],
      safetyDecisions: [],
      verifierResults: [],
      recoveryAttempts: 0,
      screenTileCache: undefined
    };
    this.sessions.set(sessionId, runtimeState);
    this.persistSessionState(runtimeState);
    this.emit({ type: "computer.session.created", session: summary });
    return summary;
  }

  async start(input: ComputerSessionCreateInput): Promise<ComputerSessionStartResult> {
    const session = this.create(input);
    const state = this.requireSession(session.sessionId);
    this.transition(session.sessionId, "permission_check");
    const surfaceDecision = this.selectSurface(input);
    state.safetyDecisions.push({
      decision: "allow",
      phase: "permission_check",
      requiredGrants: surfaceDecision.requiredGrants,
      reason: surfaceDecision.reason,
      warnings: surfaceDecision.warnings
    });
    this.transition(session.sessionId, "surface_selecting", {
      selectedSurface: surfaceDecision.surface,
      riskClass: input.riskClass ?? surfaceDecision.surface.defaultRiskClass
    });

    const evalRun = this.options.storage.createComputerUseEvalRun({
      sessionId: session.sessionId,
      modalities: inferModalitiesForSurface(surfaceDecision.surface.kind),
      prompt: input.userRequest,
      status: "running",
      scenario: {
        id: `computer-session:${session.sessionId}`,
        title: input.userRequest.slice(0, 160) || "Computer Use Session",
        modalities: inferModalitiesForSurface(surfaceDecision.surface.kind),
        source: "computer_session_runtime",
        prompt: input.userRequest,
        setup: {
          profileId: input.profileId,
          requestedSurface: input.requestedSurface,
          selectedSurface: surfaceDecision.surface.kind,
          requiredGrants: surfaceDecision.requiredGrants
        },
        tags: ["computer_session_runtime", surfaceDecision.surface.kind],
        safetyBoundaries: [
          "approval_required_for_high_risk_actions",
          "restricted_pages_are_not_bypassed",
          "credentials_are_not_automated",
          "foreground_desktop_requires_watch_mode"
        ]
      },
      metrics: {
        runtime: "computer_session_runtime.v1",
        selectedSurface: surfaceDecision.surface.kind
      }
    });
    const dagRun = this.dagRuntime.createRun({
      evalRunId: evalRun.id,
      sessionId: session.sessionId,
      goal: input.userRequest,
      metadata: {
        runtime: "computer_session_runtime.v1",
        surface: surfaceDecision.surface.kind,
        profileId: input.profileId,
        ...input.metadata
      },
      nodes: createSkeletonDagNodes({ sessionId: session.sessionId, evalRunId: evalRun.id, surfaceDecision })
    });
    this.transition(session.sessionId, "observing", {
      evalRunId: evalRun.id,
      dagRunId: dagRun.id
    });
    this.recordObservation(session.sessionId, {
      id: `observation:${randomUUID()}`,
      kind: "session_skeleton",
      source: "computer_session_runtime",
      surface: surfaceDecision.surface.kind,
      capturedAt: new Date().toISOString(),
      evalRunId: evalRun.id,
      freshness: "unknown",
      summary: "Computer Session runtime started and selected an execution surface.",
      metadata: {
        userRequest: input.userRequest,
        selectedSurface: surfaceDecision.surface.kind
      }
    });
    if (surfaceDecision.surface.kind === "future_vm_session") {
      return this.blockFutureVmSessionBoundary({
        sessionId: session.sessionId,
        evalRunId: evalRun.id,
        dagRunId: dagRun.id,
        surfaceDecision,
        input
      });
    }
    const surfacePermissionDecision = this.evaluateSurfacePermissionProfile(state, surfaceDecision);
    if (!surfacePermissionDecision.allowed) {
      const now = new Date().toISOString();
      const reason = surfacePermissionDecision.reason;
      state.safetyDecisions.push({
        decision: "blocked",
        phase: "surface_permission_profile",
        profileId: state.summary.profileId,
        surface: surfaceDecision.surface.kind,
        reason,
        missingRequirements: surfacePermissionDecision.missingRequirements,
        usedRequirements: surfacePermissionDecision.usedRequirements,
        safetyBoundaries: surfacePermissionDecision.safetyBoundaries
      });
      this.options.storage.upsertCapabilityDagNode({
        id: `${session.sessionId}:permission_check`,
        dagRunId: dagRun.id,
        kind: "permission_check",
        status: "failed",
        input: {
          evalRunId: evalRun.id,
          requiredGrants: surfaceDecision.requiredGrants,
          surface: surfaceDecision.surface.kind
        },
        output: {
          ok: false,
          reason,
          missingRequirements: surfacePermissionDecision.missingRequirements,
          usedRequirements: surfacePermissionDecision.usedRequirements
        },
        startedAt: now,
        completedAt: now,
        elapsedMs: 0,
        lastError: reason
      });
      this.options.storage.appendComputerUseEvalStep({
        runId: evalRun.id,
        kind: "surface_permission_profile",
        phase: "approval",
        status: "blocked",
        capabilityDagNodeId: `${session.sessionId}:permission_check`,
        input: {
          selectedSurface: surfaceDecision.surface.kind,
          profileId: state.summary.profileId,
          requiredGrants: surfaceDecision.requiredGrants
        },
        output: {
          reason,
          missingRequirements: surfacePermissionDecision.missingRequirements,
          usedRequirements: surfacePermissionDecision.usedRequirements
        },
        failureClass: "approval_denied",
        startedAt: now,
        completedAt: now,
        elapsedMs: 0
      });
      this.options.storage.updateComputerUseEvalRun({
        id: evalRun.id,
        status: "failed",
        taskSuccess: "failed",
        failureClass: "approval_denied",
        completedAt: now,
        metrics: {
          proofRecorded: true,
          blockedSurface: surfaceDecision.surface.kind
        }
      });
      this.options.storage.updateCapabilityDagRun({
        id: dagRun.id,
        status: "failed",
        completedAt: now
      });
      this.block(session.sessionId, reason);
      return {
        session: this.requireSession(session.sessionId).summary,
        evalRun: this.options.storage.readComputerUseEvalRun(evalRun.id) ?? evalRun,
        dagRun: this.options.storage.readCapabilityDagRun(dagRun.id) ?? dagRun,
        dagNodes: this.options.storage.listCapabilityDagNodes(dagRun.id)
      };
    }
    this.transition(session.sessionId, "planning");
    this.options.storage.appendComputerUseEvalStep({
      runId: evalRun.id,
      kind: "computer_session_start",
      phase: "planning",
      status: "completed",
      input: {
        userRequest: input.userRequest,
        profileId: input.profileId,
        requestedSurface: input.requestedSurface
      },
      output: {
        selectedSurface: surfaceDecision.surface.kind,
        requiredGrants: surfaceDecision.requiredGrants,
        dagRunId: dagRun.id
      },
      failureClass: "none"
    });
    await this.runLocalDagToIdle(dagRun.id);
    this.transition(session.sessionId, "completed");
    finalizeEvalRunFromSteps({
      storage: this.options.storage,
      runId: evalRun.id,
      status: "completed",
      taskSuccess: "partial",
      failureClass: "none"
    });
    return {
      session: this.requireSession(session.sessionId).summary,
      evalRun,
      dagRun,
      dagNodes: this.options.storage.listCapabilityDagNodes(dagRun.id)
    };
  }

  normalizeActionBatch(input: unknown): NormalizedComputerActionBatch {
    const batch = normalizeComputerActionBatch(input);
    return batch;
  }

  listSurfaces() {
    return this.surfaceManager.list();
  }

  listSessions(): ComputerSessionSummary[] {
    return [...this.sessions.values()].map((session) => session.summary);
  }

  recordActionBatch(sessionId: string, input: unknown): NormalizedComputerActionBatch {
    const batch = normalizeComputerActionBatch(input);
    const state = this.requireSession(sessionId);
    state.actionBatches.push(batch);
    state.summary.latestActionBatchId = `action-batch:${state.actionBatches.length - 1}`;
    state.summary.updatedAt = new Date().toISOString();
    if (batch.blockedReason) {
      this.block(sessionId, batch.blockedReason);
    } else {
      this.emit({ type: "computer.session.action_started", sessionId, actionBatch: batch });
    }
    this.persistSessionState(state);
    return batch;
  }

  recordObservation(sessionId: string, observation: ComputerSessionObservationSummary): void {
    const state = this.requireSession(sessionId);
    state.observations.push(observation);
    state.summary.latestObservationId = readRecordId(observation) ?? `observation:${state.observations.length - 1}`;
    state.summary.updatedAt = new Date().toISOString();
    this.persistSessionState(state);
    this.emit({ type: "computer.session.observation", sessionId, observation });
  }

  recordBrowserActionResultObservation(input: {
    result: BrowserActionResult;
    capabilityJobId?: string;
    dagNodeId?: string;
  }): ComputerSessionObservationSummary | null {
    const sessionId = readComputerSessionIdFromBrowserAction(input.result.actionSessionId);
    if (!sessionId || !this.sessions.has(sessionId)) {
      return null;
    }
    const records = [
      input.result.before ? this.recordBrowserActionDomObservation({
        sessionId,
        result: input.result,
        observation: input.result.before,
        phase: "pre_action",
        capabilityJobId: input.capabilityJobId,
        dagNodeId: input.dagNodeId
      }) : null,
      input.result.after ? this.recordBrowserActionDomObservation({
        sessionId,
        result: input.result,
        observation: input.result.after,
        phase: "post_action",
        capabilityJobId: input.capabilityJobId,
        dagNodeId: input.dagNodeId
      }) : null
    ].filter((record): record is ComputerSessionObservationSummary => Boolean(record));
    this.recordBrowserActionFeedback({
      sessionId,
      result: input.result,
      capabilityJobId: input.capabilityJobId,
      dagNodeId: input.dagNodeId,
      records
    });
    return records.at(-1) ?? null;
  }

  private recordBrowserActionFeedback(input: {
    sessionId: string;
    result: BrowserActionResult;
    capabilityJobId?: string;
    dagNodeId?: string;
    records: ComputerSessionObservationSummary[];
  }): ComputerSessionActionFeedbackSummary {
    const state = this.requireSession(input.sessionId);
    const before = input.records.find((record) => record.metadata?.observationPhase === "pre_action");
    const after = input.records.find((record) => record.metadata?.observationPhase === "post_action");
    const metadata = {
      resultId: input.result.id,
      actionSessionId: input.result.actionSessionId,
      targetEvidence: before?.metadata?.targetEvidence,
      before: before ? summarizeObservationFeedbackReference(before) : undefined,
      after: after ? summarizeObservationFeedbackReference(after) : undefined,
      verification: input.result.verification
    };
    const feedback: ComputerSessionActionFeedbackSummary = {
      id: `action-feedback:${randomUUID()}`,
      sessionId: input.sessionId,
      operationKind: "browser_action",
      actionType: input.result.action.type,
      status: mapBrowserActionStatusToFeedbackStatus(input.result.status),
      capturedAt: input.result.completedAt ?? after?.capturedAt ?? before?.capturedAt ?? new Date().toISOString(),
      capabilityJobId: input.capabilityJobId,
      dagNodeId: input.dagNodeId,
      beforeObservationId: before?.id,
      afterObservationId: after?.id,
      perceptionGraphId: after?.perceptionGraphId ?? before?.perceptionGraphId,
      verifierStatus: input.result.verification.status,
      summary: `Browser Action ${input.result.action.type} feedback: ${input.result.verification.status}.`,
      metadata,
      redaction: {
        screenshots: "not_stored",
        credentials: "redacted_by_browser_action_policy",
        rawDom: "not_stored"
      }
    };
    if (state.summary.evalRunId) {
      const step = this.options.storage.appendComputerUseEvalStep({
        runId: state.summary.evalRunId,
        kind: "browser_action_feedback",
        phase: "observe",
        status: feedback.status === "completed" ? "completed" : feedback.status === "blocked" ? "blocked" : "failed",
        capabilityJobId: input.capabilityJobId,
        capabilityDagNodeId: input.dagNodeId,
        perceptionGraphId: feedback.perceptionGraphId,
        input: {
          resultId: input.result.id,
          actionSessionId: input.result.actionSessionId,
          action: input.result.action.type
        },
        output: {
          feedbackId: feedback.id,
          beforeObservationId: feedback.beforeObservationId,
          afterObservationId: feedback.afterObservationId,
          verifierStatus: feedback.verifierStatus,
          targetEvidence: before?.metadata?.targetEvidence
        },
        failureClass: feedback.status === "completed" ? "none" : "action_failed"
      });
      feedback.evalStepId = step.id;
      feedback.metadata = {
        ...metadata,
        evalStepId: step.id
      };
    }
    state.actionFeedbacks.push(feedback);
    state.summary.updatedAt = new Date().toISOString();
    this.persistSessionState(state);
    this.emit({ type: "computer.session.action_completed", sessionId: input.sessionId, result: feedback });
    return feedback;
  }

  private recordBrowserActionDomObservation(input: {
    sessionId: string;
    result: BrowserActionResult;
    observation: BrowserObservation;
    phase: "pre_action" | "post_action";
    capabilityJobId?: string;
    dagNodeId?: string;
  }): ComputerSessionObservationSummary | null {
    const state = this.requireSession(input.sessionId);
    if (!input.observation) {
      return null;
    }
    const graph = input.observation.elements.length > 0
      ? this.options.storage.recordPerceptionGraph({
          graph: buildPerceptionGraphFromBrowserObservation({
            observation: input.observation,
            sessionId: input.sessionId
          }),
          sessionId: input.sessionId,
          source: `computer_session_browser_action_${input.phase}`
        })
      : undefined;
    const targetGraphs = graph ? collectSessionTargetGraphs({
      currentGraph: graph,
      sessionId: input.sessionId,
      storage: this.options.storage,
      observations: state.observations
    }) : [];
    const targetEvidence = graph
      ? summarizeBrowserActionTargetEvidence(input.result, targetGraphs, graph.id)
      : undefined;
    const step = state.summary.evalRunId ? this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: `browser_action_${input.phase}_observation`,
      phase: "observe",
      status: "completed",
      capabilityJobId: input.capabilityJobId,
      capabilityDagNodeId: input.dagNodeId,
      perceptionGraphId: graph?.id,
      input: {
        actionSessionId: input.result.actionSessionId,
        action: input.result.action.type,
        resultId: input.result.id,
        observationPhase: input.phase
      },
      output: {
        ...summarizeBrowserObservationForSession(input.observation),
        targetEvidence
      },
      failureClass: "none"
    }) : undefined;
    const resources = graph && state.summary.evalRunId
      ? [this.options.storage.createComputerUseEvalResource({
          runId: state.summary.evalRunId,
          stepId: step?.id,
          role: "perception_graph",
          retention: "evidence",
          redaction: {
            screenshots: "not_stored",
            source: "structured_dom_metadata"
          }
        })]
      : [];
    const record: ComputerSessionObservationSummary = {
      id: `observation:${randomUUID()}`,
      kind: "browser_dom",
      source: `browser_action_${input.phase}`,
      surface: state.summary.selectedSurface?.kind,
      capturedAt: input.observation.capturedAt,
      capabilityJobId: input.capabilityJobId,
      dagNodeId: input.dagNodeId,
      evalRunId: state.summary.evalRunId,
      perceptionGraphId: graph?.id,
      resourceIds: resources.map((resource) => ({
        evalResourceId: resource.id,
        role: resource.role,
        retention: resource.retention
      })),
      summary: `Browser Action ${input.result.action.type} ${input.phase}; observed ${input.observation.elements.length} DOM elements.`,
      freshness: "fresh",
      metadata: {
        action: input.result.action.type,
        observationPhase: input.phase,
        status: input.result.status,
        verification: input.result.verification.status,
        url: input.observation.url,
        title: input.observation.title,
        elementCount: input.observation.elements.length,
        perceptionGraphNodeCount: graph?.nodes.length,
        targetEvidence
      },
      redaction: {
        screenshots: "not_stored",
        credentials: "redacted_by_browser_action_policy"
      }
    };
    this.recordObservation(input.sessionId, record);
    return record;
  }

  recordVerifierResult(sessionId: string, result: unknown): void {
    const state = this.requireSession(sessionId);
    state.verifierResults.push(result);
    state.summary.latestVerifierResultId = readRecordId(result) ?? `verifier:${state.verifierResults.length - 1}`;
    state.summary.updatedAt = new Date().toISOString();
    this.persistSessionState(state);
    this.emit({ type: "computer.session.verifier_result", sessionId, result });
  }

  recordRollbackAction(
    sessionId: string,
    input: Omit<ComputerSessionRollbackActionSummary, "id" | "createdAt">
  ): ComputerSessionRollbackActionSummary {
    const state = this.requireSession(sessionId);
    const action: ComputerSessionRollbackActionSummary = {
      id: `rollback:${randomUUID()}`,
      createdAt: new Date().toISOString(),
      ...input
    };
    state.rollbackActions.push(action);
    state.summary.updatedAt = action.createdAt;
    this.persistSessionState(state);
    return action;
  }

  completeRollbackAction(
    sessionId: string,
    rollbackActionId: string,
    status: ComputerSessionRollbackActionSummary["status"],
    reason?: string
  ): ComputerSessionRollbackActionSummary | null {
    const state = this.requireSession(sessionId);
    const action = state.rollbackActions.find((candidate) => candidate.id === rollbackActionId);
    if (!action) {
      return null;
    }
    action.status = status;
    action.reason = reason ?? action.reason;
    action.completedAt = new Date().toISOString();
    state.summary.updatedAt = action.completedAt;
    this.persistSessionState(state);
    return action;
  }

  async executeRollbackAction(input: {
    sessionId: string;
    rollbackActionId: string;
    includeUserArtifacts?: boolean;
    confirmUserArtifacts?: boolean;
  }): Promise<{ session: ComputerSessionSummary; rollbackAction: ComputerSessionRollbackActionSummary; toolRun?: unknown }> {
    const state = this.requireSession(input.sessionId);
    const action = state.rollbackActions.find((candidate) => candidate.id === input.rollbackActionId);
    if (!action) {
      throw new Error(`Rollback action not found: ${input.rollbackActionId}`);
    }
    state.safetyDecisions.push({
      phase: "rollback_action",
      rollbackActionId: action.id,
      kind: action.kind,
      includeUserArtifacts: input.includeUserArtifacts === true,
      confirmUserArtifacts: input.confirmUserArtifacts === true,
      requestedAt: new Date().toISOString()
    });
    if (action.kind === "delete_artifact") {
      const metadata = readUnknownRecord(action.metadata);
      const terminalArtifactTargets = readTerminalArtifactRollbackTargets(metadata.terminalArtifactTargets);
      if (terminalArtifactTargets.length) {
        if (!input.includeUserArtifacts || !input.confirmUserArtifacts) {
          const blocked = this.completeRollbackAction(input.sessionId, action.id, "blocked", "terminal_artifact_deletion_requires_explicit_delete_confirmation") ?? action;
          this.recordRollbackEvalStep(state, blocked, "blocked", {
            reason: "terminal_artifact_deletion_requires_explicit_delete_confirmation",
            terminalArtifactTargetCount: terminalArtifactTargets.length
          });
          return { session: this.requireSession(input.sessionId).summary, rollbackAction: blocked };
        }
        const profile = state.summary.profileId
          ? this.options.storage.readAutonomyPermissionProfile(state.summary.profileId)
          : null;
        const writeRoots = profile?.grants.filesystem.writeRoots ?? [];
        let deletedCount = 0;
        let skippedCount = 0;
        const skippedReasons: Record<string, number> = {};
        for (const target of terminalArtifactTargets.slice(0, 25)) {
          const absolutePath = resolve(target.path);
          const skip = (reason: string) => {
            skippedCount += 1;
            skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
          };
          if (!writeRoots.length || !isPathWithinAnyRoot(absolutePath, writeRoots)) {
            skip("outside_approved_write_root");
            continue;
          }
          if (!existsSync(absolutePath)) {
            skip("already_missing");
            continue;
          }
          try {
            const stat = statSync(absolutePath);
            if (!stat.isFile()) {
              skip("not_a_file");
              continue;
            }
            const bytes = readFileSync(absolutePath);
            const currentSha256 = createHash("sha256").update(bytes).digest("hex");
            if (currentSha256 !== target.sha256) {
              skip("hash_changed_after_terminal_run");
              continue;
            }
            unlinkSync(absolutePath);
            deletedCount += 1;
          } catch {
            skip("delete_failed");
          }
        }
        const status: ComputerSessionRollbackActionSummary["status"] = deletedCount > 0
          ? "completed"
          : skippedCount > 0
            ? "skipped"
            : "completed";
        const completed = this.completeRollbackAction(input.sessionId, action.id, status, "terminal_artifact_rollback_finished") ?? action;
        completed.metadata = {
          ...metadata,
          terminalArtifactTargetCount: terminalArtifactTargets.length,
          deletedCount,
          skippedCount,
          skippedReasons
        };
        state.summary.updatedAt = new Date().toISOString();
        this.persistSessionState(state);
        this.recordRollbackEvalStep(state, completed, status, {
          source: "terminal_output_root_diff",
          terminalArtifactTargetCount: terminalArtifactTargets.length,
          deletedCount,
          skippedCount,
          skippedReasons
        });
        return { session: this.requireSession(input.sessionId).summary, rollbackAction: completed };
      }
      const autonomyRunId = typeof metadata.autonomyRunId === "string" ? metadata.autonomyRunId : "";
      if (!autonomyRunId) {
        const failed = this.completeRollbackAction(input.sessionId, action.id, "failed", "missing_autonomy_run_id") ?? action;
        this.recordRollbackEvalStep(state, failed, "failed", { reason: "missing_autonomy_run_id" });
        return { session: this.requireSession(input.sessionId).summary, rollbackAction: failed };
      }
      if (input.includeUserArtifacts && !input.confirmUserArtifacts) {
        const blocked = this.completeRollbackAction(input.sessionId, action.id, "blocked", "user_artifact_deletion_requires_explicit_confirmation") ?? action;
        this.recordRollbackEvalStep(state, blocked, "blocked", { reason: "user_artifact_deletion_requires_explicit_confirmation" });
        return { session: this.requireSession(input.sessionId).summary, rollbackAction: blocked };
      }
      const runtime = new ScopedAutonomyRuntime(this.options.storage);
      const toolRun = runtime.rollbackRun({
        autonomyRunId,
        includeUserArtifacts: input.includeUserArtifacts === true
      });
      const output = readUnknownRecord(toolRun.output);
      const deleted = Array.isArray(output.deleted) ? output.deleted.length : 0;
      const skipped = Array.isArray(output.skipped) ? output.skipped.length : 0;
      const status: ComputerSessionRollbackActionSummary["status"] = deleted > 0
        ? "completed"
        : skipped > 0
          ? "skipped"
          : "completed";
      const reason = input.includeUserArtifacts
        ? "toolsmith_rollback_completed_with_user_artifacts"
        : "toolsmith_rollback_completed_without_user_artifacts";
      const completed = this.completeRollbackAction(input.sessionId, action.id, status, reason) ?? action;
      completed.metadata = {
        ...readUnknownRecord(completed.metadata),
        rollbackToolRunId: toolRun.id,
        includeUserArtifacts: input.includeUserArtifacts === true,
        deletedCount: deleted,
        skippedCount: skipped
      };
      state.summary.updatedAt = new Date().toISOString();
      this.persistSessionState(state);
      this.recordRollbackEvalStep(state, completed, status, {
        autonomyRunId,
        rollbackToolRunId: toolRun.id,
        includeUserArtifacts: input.includeUserArtifacts === true,
        deletedCount: deleted,
        skippedCount: skipped
      });
      return { session: this.requireSession(input.sessionId).summary, rollbackAction: completed, toolRun };
    }
    if (action.kind === "cancel_capability_job" && action.capabilityJobId) {
      await this.options.capabilityRuntime.cancel(action.capabilityJobId, "computer_session_rollback_action");
      const completed = this.completeRollbackAction(input.sessionId, action.id, "completed", "capability_job_cancelled") ?? action;
      this.recordRollbackEvalStep(state, completed, "completed", { capabilityJobId: action.capabilityJobId });
      return { session: this.requireSession(input.sessionId).summary, rollbackAction: completed };
    }
    const skipped = this.completeRollbackAction(input.sessionId, action.id, "skipped", "rollback_action_has_no_executable_handler") ?? action;
    this.recordRollbackEvalStep(state, skipped, "skipped", { reason: "rollback_action_has_no_executable_handler" });
    return { session: this.requireSession(input.sessionId).summary, rollbackAction: skipped };
  }

  async executeOperation(input: {
    sessionId: string;
    operation: ComputerStructuredOperation;
    waitMs?: number;
  }): Promise<ComputerSessionOperationResult> {
    const state = this.requireSession(input.sessionId);
    if (!state.summary.evalRunId || !state.summary.dagRunId) {
      throw new Error("Computer session must be started before executing operations.");
    }
    if (input.operation.kind === "browser_action" && this.options.executors?.browserAction) {
      return await this.executeBrowserActionOperation(input.sessionId, input.operation, input.waitMs);
    }
    if (input.operation.kind === "toolsmith") {
      return await this.executeToolsmithOperation(input.sessionId, input.operation);
    }
    if (input.operation.kind === "visual_desktop_action") {
      return this.executeVisualDesktopWatchOperation(input.sessionId, input.operation);
    }
    if (input.operation.kind === "browser_permission_bubble_action") {
      return this.executeBrowserPermissionBubbleBoundaryOperation(input.sessionId, input.operation);
    }
    if (input.operation.kind === "native_file_picker_action") {
      return this.executeNativeFilePickerBoundaryOperation(input.sessionId, input.operation);
    }
    const bridge = bridgeOperationToCapability(input.operation);
    if (!bridge) {
      const actionRoute = routeComputerOperation(input.operation, state.summary);
      const node = this.options.storage.upsertCapabilityDagNode({
        id: `${input.sessionId}:operation:${randomUUID()}`,
        dagRunId: state.summary.dagRunId,
        kind: "action",
        status: "failed",
        input: { operation: input.operation, actionRoute },
        output: { ok: false, reason: "operation_not_capability_backed", actionRoute },
        lastError: "operation_not_capability_backed"
      });
      this.block(input.sessionId, "operation_not_capability_backed");
      return { session: state.summary, dagNode: node };
    }
    if (bridge.kind === "screen_observe") {
      bridge.input = applyScreenTileCacheToInput(state, bridge.input);
    }
    this.transition(input.sessionId, "executing");
    const actionRoute = routeComputerOperation(input.operation, state.summary);
    const dagNode = this.options.storage.upsertCapabilityDagNode({
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
      const failedNode = this.options.storage.upsertCapabilityDagNode({
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
      this.options.storage.appendComputerUseEvalStep({
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
      this.block(input.sessionId, reason);
      return {
        session: this.requireSession(input.sessionId).summary,
        dagNode: failedNode
      };
    }
    const terminalPermission = bridge.kind === "terminal"
      ? this.evaluateTerminalOperationPermission(input.sessionId, bridge.input)
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
        command: terminalPermission.command
      });
      const failedNode = this.options.storage.upsertCapabilityDagNode({
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
          safetyBoundaries: terminalPermission.decision?.safetyBoundaries ?? []
        },
        startedAt: dagNode.startedAt,
        completedAt: now,
        elapsedMs: 0,
        lastError: reason
      });
      this.options.storage.appendComputerUseEvalStep({
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
          missingRequirements: terminalPermission.decision?.missingRequirements ?? terminalPermission.requirements
        },
        failureClass: "approval_denied",
        startedAt: now,
        completedAt: now,
        elapsedMs: 0
      });
      this.block(input.sessionId, reason);
      return {
        session: this.requireSession(input.sessionId).summary,
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
        command: terminalPermission.command,
        ...reversibleEvidence
      });
    }
    if (bridge.kind === "terminal") {
      const snapshots = this.captureTerminalOutputRootSnapshots(input.sessionId, bridge.input);
      if (snapshots.length) {
        this.terminalOutputRootSnapshots.set(dagNode.id, snapshots);
      }
    }
    const job = await this.options.capabilityRuntime.enqueue({
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
    const finalJob = await waitForCapabilityJobIfRunning(this.options.capabilityRuntime, job.id, input.waitMs ?? 5000);
    const latestNode = this.options.storage.readCapabilityDagNode(dagNode.id) ?? dagNode;
    if (finalJob.status === "awaiting_approval") {
      this.transition(input.sessionId, "awaiting_action_confirmation", {
        requiresUserAction: finalJob.approvalId ?? "approval_required"
      });
      return { session: this.requireSession(input.sessionId).summary, dagNode: latestNode, job: finalJob };
    }
    if (finalJob.status === "completed") {
      this.recordCapabilityOperationObservation({
        sessionId: input.sessionId,
        operation: input.operation,
        job: finalJob,
        dagNodeId: dagNode.id,
        capabilityKind: bridge.kind
      });
      this.transition(input.sessionId, "verifying");
      const verification = verifyComputerSessionEffect({
        operation: input.operation,
        capabilityKind: bridge.kind,
        job: finalJob,
        recoveryBudgetRemaining: Math.max(0, 1 - state.recoveryAttempts)
      });
      this.recordEffectVerificationStep({
        sessionId: input.sessionId,
        dagNodeId: dagNode.id,
        job: finalJob,
        verification
      });
      this.recordVerifierResult(input.sessionId, {
        id: `verifier:${finalJob.id}`,
        ...verification
      });
      if (verification.status === "passed") {
        this.transition(input.sessionId, "completed");
      } else {
        this.recordRecoveryAttempt({
          sessionId: input.sessionId,
          dagNodeId: dagNode.id,
          job: finalJob,
          verification
        });
        this.transition(input.sessionId, "failed", {
          blockedReason: verification.reason
        });
      }
    } else if (finalJob.status === "running" || finalJob.status === "scheduled" || finalJob.status === "queued") {
      this.transition(input.sessionId, "executing");
    } else {
      this.transition(input.sessionId, "failed", { blockedReason: finalJob.lastError ?? `Capability job ${finalJob.status}` });
    }
    return {
      session: this.requireSession(input.sessionId).summary,
      dagNode: this.options.storage.readCapabilityDagNode(dagNode.id) ?? latestNode,
      job: finalJob
    };
  }

  async executeBrowserActionPrompt(input: {
    sessionId: string;
    text: string;
    mode?: WidgetMode;
    source?: Partial<BrowserActionSource>;
  }): Promise<ComputerSessionPromptPlanResult> {
    const state = this.requireSession(input.sessionId);
    if (!state.summary.evalRunId) {
      throw new Error("Computer session must be started before planning Browser Action prompts.");
    }
    this.transition(input.sessionId, "planning");
    const promptSource = resolvePromptBrowserSource(state.summary, input.source);
    const defaultAdapterId = state.summary.selectedSurface?.kind === "isolated_browser" ? "playwright" : undefined;
    const plan = planBrowserActionFromPrompt({
      text: input.text,
      mode: input.mode ?? "browser",
      defaultAdapterId,
      source: promptSource
    });
    if (!plan || !plan.steps[0]) {
      const blockedReason = "browser_action_prompt_not_plannable";
      this.options.storage.appendComputerUseEvalStep({
        runId: state.summary.evalRunId,
        kind: "browser_action_prompt_plan",
        phase: "planning",
        status: "failed",
        input: { text: input.text, mode: input.mode ?? "browser", source: promptSource, defaultAdapterId },
        output: { blockedReason },
        failureClass: "ambiguous_target"
      });
      this.block(input.sessionId, blockedReason);
      return {
        session: this.requireSession(input.sessionId).summary,
        blockedReason
      };
    }
    this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "browser_action_prompt_plan",
      phase: "planning",
      status: "completed",
      input: { text: input.text, mode: input.mode ?? "browser", source: promptSource, defaultAdapterId },
      output: {
        planId: plan.id,
        confidence: plan.confidence,
        reason: plan.reason,
        steps: plan.steps.map((step) => ({
          id: step.id,
          action: step.action.type,
          targetSummary: step.targetSummary
        }))
      },
      failureClass: "none"
    });
    this.emit({
      type: "computer.session.plan",
      sessionId: input.sessionId,
      plan
    });
    const promptRun = this.createPromptRun(input.sessionId, input.text, plan);
    const operation = await this.startBrowserActionPromptStep(input.sessionId, promptRun.id, 0);
    return {
      session: this.requireSession(input.sessionId).summary,
      plan,
      promptRun: this.readPromptRun(input.sessionId, promptRun.id),
      operation
    };
  }

  async continueBrowserActionPrompt(input: {
    sessionId: string;
    promptRunId?: string;
  }): Promise<ComputerSessionPromptPlanResult> {
    const state = this.requireSession(input.sessionId);
    const promptRun = input.promptRunId
      ? this.requirePromptRun(state, input.promptRunId)
      : this.findContinuablePromptRun(state);
    if (!promptRun) {
      return {
        session: state.summary,
        blockedReason: "browser_action_prompt_run_not_found"
      };
    }
    this.refreshPromptRunFromStorage(input.sessionId, promptRun.id);
    const latestRun = this.requirePromptRun(state, promptRun.id);
    const plan = this.promptPlans.get(latestRun.id);
    if (!plan) {
      latestRun.status = "failed";
      latestRun.lastError = "browser_action_prompt_plan_missing";
      latestRun.updatedAt = new Date().toISOString();
      this.emitPromptRun(input.sessionId, latestRun);
      return {
        session: this.requireSession(input.sessionId).summary,
        promptRun: latestRun,
        blockedReason: latestRun.lastError
      };
    }
    if (latestRun.status === "completed" || latestRun.status === "failed" || latestRun.status === "cancelled") {
      return {
        session: this.requireSession(input.sessionId).summary,
        plan,
        promptRun: latestRun
      };
    }
    const current = latestRun.steps[latestRun.currentStepIndex];
    if (current && current.status !== "completed") {
      return {
        session: this.requireSession(input.sessionId).summary,
        plan,
        promptRun: latestRun
      };
    }
    const nextIndex = latestRun.steps.findIndex((step) => step.status === "pending");
    if (nextIndex < 0) {
      this.completePromptRun(input.sessionId, latestRun.id);
      return {
        session: this.requireSession(input.sessionId).summary,
        plan,
        promptRun: this.requirePromptRun(state, latestRun.id)
      };
    }
    const operation = await this.startBrowserActionPromptStep(input.sessionId, latestRun.id, nextIndex);
    return {
      session: this.requireSession(input.sessionId).summary,
      plan,
      promptRun: this.requirePromptRun(state, latestRun.id),
      operation
    };
  }

  async continueBrowserActionPromptByCapabilityJob(capabilityJobId: string): Promise<ComputerSessionPromptPlanResult | null> {
    for (const [sessionId, state] of this.sessions.entries()) {
      for (const promptRun of state.promptRuns) {
        const step = promptRun.steps.find((candidate) => candidate.capabilityJobId === capabilityJobId);
        if (!step || isPromptStepFinal(step.status)) {
          continue;
        }
        return await this.continueBrowserActionPrompt({ sessionId, promptRunId: promptRun.id });
      }
    }
    return null;
  }

  private async executeBrowserActionOperation(
    sessionId: string,
    operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>,
    _waitMs?: number
  ): Promise<ComputerSessionOperationResult> {
    const state = this.requireSession(sessionId);
    if (!state.summary.evalRunId || !state.summary.dagRunId) {
      throw new Error("Computer session must be started before executing Browser Action operations.");
    }
    const freshnessRecovery = await this.recoverBrowserActionFreshObservationIfNeeded({
      sessionId,
      operation: operation as Extract<ComputerStructuredOperation, { kind: "browser_action" }>
    });
    if (freshnessRecovery.status === "blocked" || freshnessRecovery.status === "failed") {
      if (!freshnessRecovery.dagNode) {
        throw new Error("Browser Action freshness recovery failed without a DAG node.");
      }
      return {
        session: this.requireSession(sessionId).summary,
        dagNode: freshnessRecovery.dagNode
      };
    }
    this.transition(sessionId, "executing");
    const primaryActionRoute = routeComputerOperation(operation, state.summary);
    const dagNode = this.options.storage.upsertCapabilityDagNode({
      id: `${sessionId}:browser-action:${randomUUID()}`,
      dagRunId: state.summary.dagRunId,
      kind: "action",
      status: "running",
      capabilityKind: "browser_action",
      input: { operation, actionRoute: primaryActionRoute },
      startedAt: new Date().toISOString()
    });
    const primaryResult = await this.options.executors?.browserAction?.({
      session: state.summary,
      operation,
      dagRunId: state.summary.dagRunId,
      dagNodeId: dagNode.id,
      evalRunId: state.summary.evalRunId
    });
    if (!primaryResult) {
      throw new Error("Browser Action executor was not available.");
    }
    let result = primaryResult;
    let finalActionRoute = primaryActionRoute;
    const routeAttempts: Array<Record<string, unknown>> = [{
      role: "primary",
      actionRoute: primaryActionRoute,
      status: primaryResult.status,
      error: primaryResult.error
    }];
    let adapterFallback: Record<string, unknown> | undefined;
    const fallbackPlan = createBrowserActionAdapterFallbackPlan({
      operation,
      session: state.summary,
      result: primaryResult,
      actionRoute: primaryActionRoute
    });
    if (fallbackPlan) {
      const fallbackStartedAt = new Date().toISOString();
      const fallbackNode = this.options.storage.upsertCapabilityDagNode({
        id: `${sessionId}:browser-action-fallback:${randomUUID()}`,
        dagRunId: state.summary.dagRunId,
        kind: "fallback",
        status: "running",
        capabilityKind: "browser_action",
        input: {
          fromActionRoute: primaryActionRoute,
          toActionRoute: fallbackPlan.actionRoute,
          reason: fallbackPlan.reason,
          operation: fallbackPlan.operation
        },
        startedAt: fallbackStartedAt
      });
      state.safetyDecisions.push({
        decision: "allow",
        phase: "browser_action_adapter_fallback",
        reason: fallbackPlan.reason,
        fromAdapter: fallbackPlan.fromAdapter,
        toAdapter: fallbackPlan.toAdapter,
        originalStatus: primaryResult.status,
        originalError: primaryResult.error,
        fallbackDagNodeId: fallbackNode.id
      });
      const fallbackResult = await this.options.executors?.browserAction?.({
        session: state.summary,
        operation: fallbackPlan.operation,
        dagRunId: state.summary.dagRunId,
        dagNodeId: fallbackNode.id,
        evalRunId: state.summary.evalRunId
      });
      if (!fallbackResult) {
        throw new Error("Browser Action executor was not available for fallback.");
      }
      const fallbackCompletedAt = new Date().toISOString();
      const fallbackStatus = mapBrowserActionExecutorResultToDagStatus(fallbackResult);
      this.options.storage.upsertCapabilityDagNode({
        ...fallbackNode,
        status: fallbackStatus,
        capabilityJobId: fallbackResult.capabilityJob?.id,
        output: {
          ...(fallbackResult.output && typeof fallbackResult.output === "object" ? fallbackResult.output as Record<string, unknown> : { value: fallbackResult.output }),
          actionRoute: fallbackPlan.actionRoute,
          fallbackFrom: primaryActionRoute,
          fallbackReason: fallbackPlan.reason
        },
        completedAt: fallbackStatus === "completed" || fallbackStatus === "failed" || fallbackStatus === "cancelled" ? fallbackCompletedAt : undefined,
        elapsedMs: Math.max(0, Date.parse(fallbackCompletedAt) - Date.parse(fallbackStartedAt)),
        lastError: fallbackResult.error
      });
      this.options.storage.appendComputerUseEvalStep({
        runId: state.summary.evalRunId,
        kind: "browser_action_adapter_fallback",
        phase: "fallback",
        status: fallbackStatus,
        capabilityJobId: fallbackResult.capabilityJob?.id,
        capabilityDagNodeId: fallbackNode.id,
        input: {
          fromActionRoute: primaryActionRoute,
          toActionRoute: fallbackPlan.actionRoute,
          reason: fallbackPlan.reason,
          primaryStatus: primaryResult.status,
          primaryError: primaryResult.error
        },
        output: {
          fallbackStatus: fallbackResult.status,
          fallbackError: fallbackResult.error,
          fallbackSummary: fallbackResult.summary
        },
        failureClass: fallbackStatus === "completed" ? "none" : "action_failed",
        startedAt: fallbackStartedAt,
        completedAt: fallbackCompletedAt,
        elapsedMs: Math.max(0, Date.parse(fallbackCompletedAt) - Date.parse(fallbackStartedAt))
      });
      routeAttempts.push({
        role: "fallback",
        actionRoute: fallbackPlan.actionRoute,
        status: fallbackResult.status,
        error: fallbackResult.error,
        dagNodeId: fallbackNode.id
      });
      adapterFallback = {
        schemaVersion: "computer-session-browser-action-adapter-fallback.v1",
        attempted: true,
        used: fallbackResult.status === "completed",
        reason: fallbackPlan.reason,
        fromAdapter: fallbackPlan.fromAdapter,
        toAdapter: fallbackPlan.toAdapter,
        fallbackDagNodeId: fallbackNode.id,
        primaryStatus: primaryResult.status,
        fallbackStatus: fallbackResult.status
      };
      if (fallbackResult.status === "completed") {
        result = fallbackResult;
        finalActionRoute = fallbackPlan.actionRoute;
      }
      this.persistSessionState(state);
    }
    const now = new Date().toISOString();
    const status = mapBrowserActionExecutorResultToDagStatus(result);
    const persistedCapabilityJobId = result.capabilityJob?.id && this.options.storage.readCapabilityJob(result.capabilityJob.id)
      ? result.capabilityJob.id
      : undefined;
    const updatedNode = this.options.storage.upsertCapabilityDagNode({
      ...dagNode,
      status,
      capabilityJobId: persistedCapabilityJobId,
      output: {
        ...(result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : { value: result.output }),
        actionRoute: finalActionRoute,
        routeAttempts,
        adapterFallback
      },
      completedAt: status === "completed" || status === "failed" || status === "cancelled" ? now : undefined,
      elapsedMs: Math.max(0, Date.parse(now) - Date.parse(dagNode.startedAt ?? now)),
      lastError: result.error
    });
    if (status === "completed" || status === "failed" || status === "cancelled") {
      this.upsertSessionOperationFollowupDagNodes({
        dagRunId: state.summary.dagRunId,
        dagNodeId: dagNode.id,
        capabilityJobId: persistedCapabilityJobId,
        status,
        completedAt: now,
        output: updatedNode.output,
        lastError: result.error
      });
    }
    if (result.status === "awaiting_approval") {
      this.transition(sessionId, "awaiting_action_confirmation", {
        requiresUserAction: result.capabilityJob?.approvalId ?? result.summary ?? "approval_required"
      });
    } else if (result.status === "completed") {
      this.transition(sessionId, "verifying");
      this.recordVerifierResult(sessionId, {
        id: `verifier:${result.capabilityJob?.id ?? dagNode.id}`,
        status: "passed",
        capabilityJobId: result.capabilityJob?.id,
        reason: adapterFallback?.used === true
          ? `Browser Action operation completed through adapter fallback to ${String(adapterFallback.toAdapter)}.`
          : result.summary ?? "Browser Action operation completed through Computer Session executor.",
        adapterFallback
      });
      this.transition(sessionId, "completed");
    } else if (result.status === "running") {
      this.transition(sessionId, "executing");
    } else if (result.status === "cancelled") {
      this.transition(sessionId, "cancelled", { blockedReason: result.error ?? "browser_action_cancelled" });
    } else {
      this.transition(sessionId, "failed", { blockedReason: result.error ?? "browser_action_failed" });
    }
    return {
      session: this.requireSession(sessionId).summary,
      dagNode: updatedNode,
      job: result.capabilityJob
    };
  }

  private async recoverBrowserActionFreshObservationIfNeeded(input: {
    sessionId: string;
    operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>;
  }): Promise<{
    status: "not_required" | "ok" | "recovered" | "blocked" | "failed";
    dagNode?: CapabilityDagNodeSummary;
  }> {
    const state = this.requireSession(input.sessionId);
    if (!state.summary.evalRunId || !state.summary.dagRunId) {
      return { status: "ok" };
    }
    const freshnessRequirement = evaluateOperationFreshnessRequirement(state.observations, input.operation);
    if (freshnessRequirement.status === "not_required" || freshnessRequirement.status === "ok") {
      return { status: freshnessRequirement.status };
    }
    const now = new Date().toISOString();
    const actionRoute = routeComputerOperation(input.operation, state.summary);
    const target = summarizeBrowserActionTargetForRecovery(input.operation);
    const recoveryNodeId = `${input.sessionId}:browser-action-reobserve:${randomUUID()}`;
    const recoveryInput = {
      reason: freshnessRequirement.reason ?? "fresh_observation_required",
      latestObservationId: freshnessRequirement.latestObservation?.id,
      latestObservationFreshness: freshnessRequirement.latestObservation?.freshness ?? "unknown",
      requiredMaxAgeMs: freshnessRequirement.maxAgeMs,
      actionType: readBrowserActionTypeFromOperation(input.operation),
      target,
      actionRoute
    };
    state.safetyDecisions.push({
      decision: "allow",
      phase: "browser_action_stale_observation_recovery",
      ...recoveryInput
    });
    if (state.recoveryAttempts >= 1) {
      const node = this.options.storage.upsertCapabilityDagNode({
        id: recoveryNodeId,
        dagRunId: state.summary.dagRunId,
        kind: "fallback",
        status: "failed",
        input: recoveryInput,
        output: {
          attempted: false,
          reason: "recovery_budget_exhausted",
          nextSafeAction: "request_target_clarification_or_manual_reobserve"
        },
        startedAt: now,
        completedAt: now,
        elapsedMs: 0,
        lastError: "recovery_budget_exhausted"
      });
      this.options.storage.appendComputerUseEvalStep({
        runId: state.summary.evalRunId,
        kind: "browser_action_reobserve_recovery",
        phase: "recovering",
        status: "failed",
        capabilityDagNodeId: node.id,
        input: recoveryInput,
        output: node.output,
        failureClass: "recovery_failed",
        startedAt: now,
        completedAt: now,
        elapsedMs: 0
      });
      this.transition(input.sessionId, "failed", { blockedReason: "recovery_budget_exhausted" });
      return { status: "failed", dagNode: node };
    }
    if (!this.options.executors?.browserAction) {
      const node = this.options.storage.upsertCapabilityDagNode({
        id: recoveryNodeId,
        dagRunId: state.summary.dagRunId,
        kind: "fallback",
        status: "failed",
        input: recoveryInput,
        output: {
          attempted: false,
          reason: "browser_action_reobserve_executor_unavailable",
          nextSafeAction: "request_target_clarification_or_manual_reobserve"
        },
        startedAt: now,
        completedAt: now,
        elapsedMs: 0,
        lastError: "browser_action_reobserve_executor_unavailable"
      });
      this.options.storage.appendComputerUseEvalStep({
        runId: state.summary.evalRunId,
        kind: "browser_action_reobserve_recovery",
        phase: "recovering",
        status: "failed",
        capabilityDagNodeId: node.id,
        input: recoveryInput,
        output: node.output,
        failureClass: "recovery_failed",
        startedAt: now,
        completedAt: now,
        elapsedMs: 0
      });
      this.transition(input.sessionId, "failed", { blockedReason: "browser_action_reobserve_executor_unavailable" });
      return { status: "failed", dagNode: node };
    }

    state.recoveryAttempts += 1;
    this.transition(input.sessionId, "recovering");
    const node = this.options.storage.upsertCapabilityDagNode({
      id: recoveryNodeId,
      dagRunId: state.summary.dagRunId,
      kind: "observe",
      status: "running",
      capabilityKind: "browser_action",
      input: recoveryInput,
      startedAt: now
    });
    const reobserveOperation = createBrowserActionReobserveOperation(input.operation);
    const result = await this.options.executors.browserAction({
      session: state.summary,
      operation: reobserveOperation,
      dagRunId: state.summary.dagRunId,
      dagNodeId: node.id,
      evalRunId: state.summary.evalRunId
    });
    const completedAt = new Date().toISOString();
    const status = result.status === "completed"
      ? "completed"
      : result.status === "awaiting_approval" || result.status === "running"
        ? "failed"
        : result.status === "cancelled"
          ? "cancelled"
          : "failed";
    const persistedCapabilityJobId = result.capabilityJob?.id && this.options.storage.readCapabilityJob(result.capabilityJob.id)
      ? result.capabilityJob.id
      : undefined;
    const postRecoveryFreshness = evaluateOperationFreshnessRequirement(state.observations, input.operation);
    const recovered = status === "completed" && postRecoveryFreshness.status === "ok";
    const output = {
      attempted: true,
      recoveryAction: "browser_action_read_reobserve",
      recoveryStatus: result.status,
      capabilityJobId: persistedCapabilityJobId,
      postRecoveryFreshness: {
        status: postRecoveryFreshness.status,
        reason: postRecoveryFreshness.reason,
        latestObservationId: postRecoveryFreshness.latestObservation?.id,
        freshness: postRecoveryFreshness.latestObservation?.freshness ?? "unknown"
      },
      summary: result.summary,
      error: result.error
    };
    const updatedNode = this.options.storage.upsertCapabilityDagNode({
      ...node,
      status: recovered ? "completed" : status === "cancelled" ? "cancelled" : "failed",
      capabilityJobId: persistedCapabilityJobId,
      output,
      completedAt,
      elapsedMs: Math.max(0, Date.parse(completedAt) - Date.parse(node.startedAt ?? completedAt)),
      lastError: recovered ? undefined : result.error ?? postRecoveryFreshness.reason ?? "fresh_observation_reobserve_failed"
    });
    this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "browser_action_reobserve_recovery",
      phase: "recovering",
      status: recovered ? "completed" : updatedNode.status === "cancelled" ? "cancelled" : "failed",
      capabilityJobId: persistedCapabilityJobId,
      capabilityDagNodeId: updatedNode.id,
      input: recoveryInput,
      output,
      failureClass: recovered ? "none" : "recovery_failed",
      startedAt: node.startedAt,
      completedAt,
      elapsedMs: updatedNode.elapsedMs
    });
    if (!recovered) {
      recordStructuredFailure({
        storage: this.options.storage,
        failureClass: "recovery_failed",
        surface: "browser",
        source: "computer_session_browser_action_reobserve_recovery",
        scenarioId: `computer-session:${input.sessionId}`,
        evalRunId: state.summary.evalRunId,
        capabilityJobId: persistedCapabilityJobId,
        recoveryHints: ["request_target_clarification_or_manual_reobserve", "do_not_use_stale_dom_evidence"],
        abstentionTriggers: ["fresh_observation_reobserve_failed"],
        rankingDelta: -0.4,
        ttlMs: 7 * 24 * 60 * 60 * 1000
      });
      this.transition(input.sessionId, "failed", {
        blockedReason: updatedNode.lastError ?? "fresh_observation_reobserve_failed"
      });
      return { status: "failed", dagNode: updatedNode };
    }
    return { status: "recovered", dagNode: updatedNode };
  }

  private async executeToolsmithOperation(
    sessionId: string,
    operation: Extract<ComputerStructuredOperation, { kind: "toolsmith" }>
  ): Promise<ComputerSessionOperationResult> {
    const state = this.requireSession(sessionId);
    if (!state.summary.evalRunId || !state.summary.dagRunId) {
      throw new Error("Computer session must be started before executing Toolsmith operations.");
    }
    this.transition(sessionId, "executing");
    const startedAt = new Date().toISOString();
    const dagNode = this.options.storage.upsertCapabilityDagNode({
      id: `${sessionId}:toolsmith:${randomUUID()}`,
      dagRunId: state.summary.dagRunId,
      kind: "action",
      status: "running",
      capabilityKind: "agent_tool",
      input: { ...operation.input, actionRoute: routeComputerOperation(operation, state.summary) },
      startedAt
    });
    const runtime = new ScopedAutonomyRuntime(this.options.storage);
    try {
      const result = await runtime.runGoalDag({
        goal: readStringField(operation.input, "goal") ?? state.summary.userRequest,
        sessionId,
        permissionProfileId: readStringField(operation.input, "permissionProfileId") ?? state.summary.profileId,
        outputRoot: readStringField(operation.input, "outputRoot"),
        title: readStringField(operation.input, "title"),
        urls: readStringArrayField(operation.input, "urls"),
        sourceDocuments: readSourceDocuments(operation.input.sourceDocuments),
        browserFallbackDocuments: readBrowserFallbackDocuments(operation.input.browserFallbackDocuments),
        forceFirstSmokeFailure: operation.input.forceFirstSmokeFailure === true
      });
      const completedAt = new Date().toISOString();
      const completed = result.run.status === "completed";
      const status = completed ? "completed" : result.run.status === "cancelled" ? "cancelled" : "failed";
      const output = summarizeToolsmithDagResult(result);
      const updatedNode = this.options.storage.upsertCapabilityDagNode({
        ...dagNode,
        status,
        output,
        completedAt,
        elapsedMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        lastError: completed ? undefined : result.run.failureClass ?? "toolsmith_run_failed"
      });
      this.upsertSessionOperationFollowupDagNodes({
        dagRunId: state.summary.dagRunId,
        dagNodeId: dagNode.id,
        status,
        completedAt,
        output,
        lastError: updatedNode.lastError
      });
      this.recordToolsmithSessionArtifacts({
        sessionId,
        dagNodeId: dagNode.id,
        result
      });
      if (completed) {
        this.transition(sessionId, "verifying");
        this.recordVerifierResult(sessionId, {
          id: `verifier:${dagNode.id}`,
          status: "passed",
          reason: "Scoped autonomy Toolsmith DAG completed through Computer Session runtime.",
          autonomyRunId: result.run.id,
          toolRunCount: result.toolRuns.length
        });
        this.transition(sessionId, "completed");
      } else {
        this.transition(sessionId, "failed", { blockedReason: result.run.failureClass ?? "toolsmith_run_failed" });
      }
      return {
        session: this.requireSession(sessionId).summary,
        dagNode: updatedNode
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      const failedNode = this.options.storage.upsertCapabilityDagNode({
        ...dagNode,
        status: "failed",
        output: { ok: false, error: message },
        completedAt,
        elapsedMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        lastError: message
      });
      this.upsertSessionOperationFollowupDagNodes({
        dagRunId: state.summary.dagRunId,
        dagNodeId: dagNode.id,
        status: "failed",
        completedAt,
        output: { ok: false, error: message },
        lastError: message
      });
      this.transition(sessionId, "failed", { blockedReason: message });
      return {
        session: this.requireSession(sessionId).summary,
        dagNode: failedNode
      };
    }
  }

  private executeVisualDesktopWatchOperation(
    sessionId: string,
    operation: Extract<ComputerStructuredOperation, { kind: "visual_desktop_action" }>
  ): ComputerSessionOperationResult {
    const state = this.requireSession(sessionId);
    if (!state.summary.evalRunId || !state.summary.dagRunId) {
      throw new Error("Computer session must be started before executing visual desktop operations.");
    }
    const now = new Date().toISOString();
    const baseNodeId = `${sessionId}:foreground-watch:${randomUUID()}`;
    const surfaceKind = state.summary.selectedSurface?.kind;
    const watchPreflight = readForegroundWatchPreflight(operation.watchPreflight);
    const foregroundWatchExecutor = buildDisabledForegroundWatchExecutorState();
    const preconditions = buildForegroundWatchPreconditions({ surfaceKind, action: operation.action, preflight: watchPreflight });
    const blockingPreconditions = preconditions.filter((precondition) => precondition.status !== "satisfied");
    const reason = readForegroundWatchBlockReason(surfaceKind, watchPreflight);
    const output = {
      ok: false,
      status: "blocked",
      reason,
      action: operation.action,
      actualInputSent: false,
      watchPreflight,
      foregroundWatchExecutor,
      selectedSurface: surfaceKind,
      requiredSurface: "foreground_desktop_watch",
      missingPreconditions: blockingPreconditions,
      requiredGrants: [
        "desktop.foreground_watch.one_time_approval",
        "desktop.active_window_assertion",
        "desktop.target_identity_assertion",
        "desktop.process_allowlist",
        "desktop.surface_lock",
        "desktop.user_idle_guard",
        "desktop.abort_on_user_input",
        "desktop.timeout_guard",
        "desktop.pre_action_screenshot",
        "desktop.post_action_screenshot",
        "desktop.effect_verifier",
        "helper.signed_watch_mode_v2"
      ],
      safetyBoundaries: [
        "no_unattended_foreground_input",
        "abort_on_user_input_required",
        "active_window_drift_must_abort",
        "unsigned_helper_is_development_only",
        "high_risk_windows_mutation_requires_rollback_proof"
      ],
      rollback: {
        available: false,
        reason: "no_action_was_executed"
      }
    };
    const approvalNode = this.options.storage.upsertCapabilityDagNode({
      id: `${baseNodeId}:approval`,
      dagRunId: state.summary.dagRunId,
      kind: "approval",
      status: "failed",
      input: {
        action: operation.action,
        selectedSurface: surfaceKind,
        requiredSurface: "foreground_desktop_watch"
      },
      output,
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: reason
    });
    const actionNode = this.options.storage.upsertCapabilityDagNode({
      id: `${baseNodeId}:action`,
      dagRunId: state.summary.dagRunId,
      kind: "action",
      status: "failed",
      capabilityKind: "desktop_action",
      dependsOn: [approvalNode.id],
      input: operation,
      output,
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: reason
    });
    this.upsertSessionOperationFollowupDagNodes({
      dagRunId: state.summary.dagRunId,
      dagNodeId: actionNode.id,
      status: "failed",
      completedAt: now,
      output,
      lastError: reason
    });
    state.safetyDecisions.push({
      decision: "blocked",
      phase: watchPreflight.abortReason ? "foreground_watch_preflight" : "foreground_watch_preconditions",
      reason,
      action: operation.action.type,
      selectedSurface: surfaceKind,
      missingPreconditions: blockingPreconditions.map((precondition) => precondition.id),
      watchPreflight,
      foregroundWatchExecutor,
      actualInputSent: false
    });
    const evalStep = this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "visual_desktop_action_blocked",
      phase: "approval",
      status: "blocked",
      capabilityDagNodeId: actionNode.id,
      input: {
        action: operation.action,
        selectedSurface: surfaceKind
      },
      output,
      failureClass: isReadOnlyComputerAction(operation.action) ? "external_blocker" : "unsafe_action_rejected",
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
    recordStructuredFailure({
      storage: this.options.storage,
      failureClass: isReadOnlyComputerAction(operation.action) ? "external_blocker" : "unsafe_action_rejected",
      surface: "windows",
      source: "computer_session_visual_desktop_watch_boundary",
      scenarioId: `computer-session:${sessionId}`,
      evalRunId: state.summary.evalRunId,
      evalStepId: evalStep.id,
      badTargetPatterns: [
        "foreground_visual_action_without_watch_mode",
        `visual_desktop_action:${operation.action.type}`
      ],
      recoveryHints: [
        "route_public_web_tasks_to_isolated_browser",
        "route_research_or_artifact_tasks_to_tool_workspace",
        "retry_after_user_stops_interacting_if_the_preflight_abort_was_intentional",
        "require_signed_watch_mode_helper_v2_before_foreground_input"
      ],
      abstentionTriggers: [
        "missing_foreground_watch_preconditions",
        "signed_helper_v2_unavailable",
        "abort_on_user_input_guard_unavailable",
        reason
      ],
      rankingDelta: -1,
      ttlMs: 7 * 24 * 60 * 60 * 1000
    });
    this.recordObservation(sessionId, {
      id: `observation:${randomUUID()}`,
      kind: "unknown",
      source: "foreground_desktop_watch_boundary",
      surface: surfaceKind,
      capturedAt: now,
      dagNodeId: actionNode.id,
      evalRunId: state.summary.evalRunId,
      summary: "Visual desktop action was blocked before native input because watch-mode preconditions are not yet satisfied.",
      freshness: "unknown",
      metadata: {
        evalStepId: evalStep.id,
        reason,
        actionType: operation.action.type,
        actualInputSent: false,
        watchPreflight,
        foregroundWatchExecutor,
        missingPreconditions: blockingPreconditions
      },
      redaction: {
        screenshots: "not_stored",
        credentials: "redacted",
        foregroundWindow: "metadata_only"
      }
    });
    this.recordRollbackAction(sessionId, {
      kind: "none_available",
      label: "No rollback needed because no foreground input was sent",
      status: "skipped",
      riskClass: state.summary.riskClass,
      target: "foreground_desktop_watch",
      reason: "no_action_was_executed",
      metadata: {
        actionType: operation.action.type,
        watchPreflight,
        foregroundWatchExecutor,
        blockedReason: reason
      }
    });
    this.recordVerifierResult(sessionId, {
      id: `verifier:${actionNode.id}`,
      status: "failed",
      reason: readForegroundWatchVerifierReason(reason),
      actionType: operation.action.type,
      actualInputSent: false,
      watchPreflight,
      foregroundWatchExecutor,
      missingPreconditions: blockingPreconditions.map((precondition) => precondition.id)
    });
    this.block(sessionId, reason);
    return {
      session: this.requireSession(sessionId).summary,
      dagNode: this.options.storage.readCapabilityDagNode(actionNode.id) ?? actionNode
    };
  }

  private executeNativeFilePickerBoundaryOperation(
    sessionId: string,
    operation: Extract<ComputerStructuredOperation, { kind: "native_file_picker_action" }>
  ): ComputerSessionOperationResult {
    const state = this.requireSession(sessionId);
    if (!state.summary.evalRunId || !state.summary.dagRunId) {
      throw new Error("Computer session must be started before executing native file picker operations.");
    }
    const now = new Date().toISOString();
    const baseNodeId = `${sessionId}:native-file-picker:${randomUUID()}`;
    const surfaceKind = state.summary.selectedSurface?.kind;
    const preconditions = buildNativeFilePickerPreconditions({ surfaceKind, input: operation.input });
    const blockingPreconditions = preconditions.filter((precondition) => precondition.status !== "satisfied");
    const reason = "native_file_picker_helper_v2_not_available";
    const requestedMode = readStringField(operation.input, "mode") ?? "select_file";
    const output = {
      ok: false,
      status: "blocked",
      reason,
      requestedMode,
      actualInputSent: false,
      localFilePathDisclosed: false,
      selectedFileCount: 0,
      selectedSurface: surfaceKind,
      requiredSurface: "foreground_desktop_watch",
      missingPreconditions: blockingPreconditions,
      requiredGrants: [
        "desktop.foreground_watch.one_time_approval",
        "desktop.active_window_assertion",
        "desktop.process_allowlist",
        "desktop.abort_on_user_input",
        "local_file.explicit_selection_approval",
        "local_file.allowed_root_or_exact_path",
        "helper.signed_file_picker_v2"
      ],
      safetyBoundaries: [
        "no_unattended_file_selection",
        "no_raw_path_persistence_without_redaction",
        "file_picker_window_must_be_proven_active",
        "unsigned_helper_is_development_only",
        "credentials_and_sensitive_paths_are_never_auto_selected"
      ],
      rollback: {
        available: false,
        reason: "no_file_was_selected"
      }
    };
    const approvalNode = this.options.storage.upsertCapabilityDagNode({
      id: `${baseNodeId}:approval`,
      dagRunId: state.summary.dagRunId,
      kind: "approval",
      status: "failed",
      input: {
        operation,
        selectedSurface: surfaceKind,
        requiredSurface: "foreground_desktop_watch"
      },
      output,
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: reason
    });
    const actionNode = this.options.storage.upsertCapabilityDagNode({
      id: `${baseNodeId}:action`,
      dagRunId: state.summary.dagRunId,
      kind: "action",
      status: "failed",
      capabilityKind: "desktop_action",
      dependsOn: [approvalNode.id],
      input: { operation, actionRoute: routeComputerOperation(operation, state.summary) },
      output,
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: reason
    });
    this.upsertSessionOperationFollowupDagNodes({
      dagRunId: state.summary.dagRunId,
      dagNodeId: actionNode.id,
      status: "failed",
      completedAt: now,
      output,
      lastError: reason
    });
    state.safetyDecisions.push({
      decision: "blocked",
      phase: "native_file_picker_preconditions",
      reason,
      requestedMode,
      selectedSurface: surfaceKind,
      missingPreconditions: blockingPreconditions.map((precondition) => precondition.id),
      actualInputSent: false,
      localFilePathDisclosed: false,
      missingRequirements: [
        { type: "risk_class", value: "local_file_disclosure", reason: "Native file picker selection discloses local file paths and contents." },
        { type: "risk_class", value: "security_boundary", reason: "Native file picker control requires a signed helper v2 and foreground guards." },
        { type: "file_path", value: "explicit_user_selected_path", reason: "File picker automation needs an explicit selected path/root grant." }
      ]
    });
    const evalStep = this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "native_file_picker_blocked",
      phase: "approval",
      status: "blocked",
      capabilityDagNodeId: actionNode.id,
      input: {
        requestedMode,
        selectedSurface: surfaceKind
      },
      output,
      failureClass: "external_blocker",
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
    recordStructuredFailure({
      storage: this.options.storage,
      failureClass: "external_blocker",
      surface: "windows",
      source: "computer_session_native_file_picker_boundary",
      scenarioId: `computer-session:${sessionId}`,
      evalRunId: state.summary.evalRunId,
      evalStepId: evalStep.id,
      recoveryHints: [
        "prefer_browser_chrome_file_upload_set_files_when_explicit_path_is_already_approved",
        "ask_user_to_select_file_manually_until_signed_file_picker_helper_v2_exists",
        "route_generated_artifact_uploads_through_isolated_browser_when_possible"
      ],
      abstentionTriggers: [
        "native_file_picker_helper_v2_unavailable",
        "file_picker_window_not_proven_active",
        "explicit_file_selection_grant_missing"
      ],
      rankingDelta: -0.8,
      ttlMs: 7 * 24 * 60 * 60 * 1000
    });
    this.recordObservation(sessionId, {
      id: `observation:${randomUUID()}`,
      kind: "file",
      source: "native_file_picker_boundary",
      surface: surfaceKind,
      capturedAt: now,
      dagNodeId: actionNode.id,
      evalRunId: state.summary.evalRunId,
      summary: "Native file picker automation was blocked before local path disclosure or native input because helper v2 preconditions are not satisfied.",
      freshness: "unknown",
      metadata: {
        evalStepId: evalStep.id,
        reason,
        requestedMode,
        actualInputSent: false,
        localFilePathDisclosed: false,
        selectedFileCount: 0,
        missingPreconditions: blockingPreconditions
      },
      redaction: {
        localPaths: "not_stored",
        fileContents: "not_read",
        screenshots: "not_stored",
        credentials: "redacted"
      }
    });
    this.recordRollbackAction(sessionId, {
      kind: "none_available",
      label: "No rollback needed because no file picker input was sent",
      status: "skipped",
      riskClass: "local_file_disclosure",
      target: "native_file_picker",
      reason: "no_file_was_selected",
      metadata: {
        requestedMode,
        blockedReason: reason
      }
    });
    this.recordVerifierResult(sessionId, {
      id: `verifier:${actionNode.id}`,
      status: "failed",
      reason: "Native file picker automation did not run because signed helper v2 and foreground file-selection guards are unavailable.",
      requestedMode,
      actualInputSent: false,
      localFilePathDisclosed: false,
      missingPreconditions: blockingPreconditions.map((precondition) => precondition.id)
    });
    this.block(sessionId, reason);
    return {
      session: this.requireSession(sessionId).summary,
      dagNode: this.options.storage.readCapabilityDagNode(actionNode.id) ?? actionNode
    };
  }

  private executeBrowserPermissionBubbleBoundaryOperation(
    sessionId: string,
    operation: Extract<ComputerStructuredOperation, { kind: "browser_permission_bubble_action" }>
  ): ComputerSessionOperationResult {
    const state = this.requireSession(sessionId);
    if (!state.summary.evalRunId || !state.summary.dagRunId) {
      throw new Error("Computer session must be started before executing browser permission bubble operations.");
    }
    const now = new Date().toISOString();
    const baseNodeId = `${sessionId}:browser-permission-bubble:${randomUUID()}`;
    const surfaceKind = state.summary.selectedSurface?.kind;
    const preconditions = buildBrowserPermissionBubblePreconditions({ surfaceKind, input: operation.input });
    const blockingPreconditions = preconditions.filter((precondition) => precondition.status !== "satisfied");
    const reason = "browser_permission_bubble_helper_v2_not_available";
    const permissionType = readStringField(operation.input, "permissionType") ?? "unknown";
    const targetButton = readStringField(operation.input, "targetButton") ?? "unknown";
    const output = {
      ok: false,
      status: "blocked",
      reason,
      permissionType,
      targetButton,
      actualInputSent: false,
      nativePopupClick: false,
      permissionChanged: false,
      selectedSurface: surfaceKind,
      requiredSurface: "foreground_desktop_watch",
      missingPreconditions: blockingPreconditions,
      requiredGrants: [
        "browser.permission_bubble.one_time_approval",
        "browser.origin_permission_scope",
        "desktop.foreground_watch.one_time_approval",
        "desktop.active_window_assertion",
        "desktop.process_allowlist",
        "desktop.abort_on_user_input",
        "desktop.pre_action_screenshot",
        "desktop.post_action_screenshot",
        "browser.permission_effect_verifier",
        "helper.signed_watch_mode_v2"
      ],
      safetyBoundaries: [
        "no_unattended_browser_chrome_popup_click",
        "permission_prompt_must_belong_to_expected_origin",
        "credential_security_admin_prompts_never_clicked",
        "content_settings_api_preferred_when_safe",
        "unsigned_helper_is_development_only"
      ],
      fallbackPlan: [
        "use_browser_chrome_permission_get_set_when_content_settings_api_covers_the_permission",
        "ask_user_to_handle_native_permission_prompt_manually_until_signed_helper_v2_exists"
      ],
      rollback: {
        available: false,
        reason: "no_permission_popup_input_was_sent"
      }
    };
    const approvalNode = this.options.storage.upsertCapabilityDagNode({
      id: `${baseNodeId}:approval`,
      dagRunId: state.summary.dagRunId,
      kind: "approval",
      status: "failed",
      input: {
        operation,
        selectedSurface: surfaceKind,
        requiredSurface: "foreground_desktop_watch"
      },
      output,
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: reason
    });
    const actionNode = this.options.storage.upsertCapabilityDagNode({
      id: `${baseNodeId}:action`,
      dagRunId: state.summary.dagRunId,
      kind: "action",
      status: "failed",
      capabilityKind: "desktop_action",
      dependsOn: [approvalNode.id],
      input: { operation, actionRoute: routeComputerOperation(operation, state.summary) },
      output,
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: reason
    });
    this.upsertSessionOperationFollowupDagNodes({
      dagRunId: state.summary.dagRunId,
      dagNodeId: actionNode.id,
      status: "failed",
      completedAt: now,
      output,
      lastError: reason
    });
    state.safetyDecisions.push({
      decision: "blocked",
      phase: "browser_permission_bubble_preconditions",
      reason,
      permissionType,
      targetButton,
      selectedSurface: surfaceKind,
      missingPreconditions: blockingPreconditions.map((precondition) => precondition.id),
      actualInputSent: false,
      nativePopupClick: false,
      permissionChanged: false,
      missingRequirements: [
        { type: "risk_class", value: "browser_state_mutation", reason: "Browser permission prompts can grant or revoke site-level capabilities." },
        { type: "risk_class", value: "security_boundary", reason: "Native browser chrome popup clicks require signed watch-mode helper v2." },
        { type: "browser_automation", value: "permission_bubble", reason: "The prompt must be proven to belong to the expected browser/origin before clicking." }
      ]
    });
    const evalStep = this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "browser_permission_bubble_blocked",
      phase: "approval",
      status: "blocked",
      capabilityDagNodeId: actionNode.id,
      input: {
        permissionType,
        targetButton,
        selectedSurface: surfaceKind
      },
      output,
      failureClass: "external_blocker",
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
    recordStructuredFailure({
      storage: this.options.storage,
      failureClass: "external_blocker",
      surface: "browser",
      source: "computer_session_browser_permission_bubble_boundary",
      scenarioId: `computer-session:${sessionId}`,
      evalRunId: state.summary.evalRunId,
      evalStepId: evalStep.id,
      recoveryHints: [
        "prefer_browser_chrome_permission_get_set_content_settings_api_when_supported",
        "ask_user_to_handle_permission_popup_manually_until_signed_watch_mode_helper_v2_exists",
        "retry_with_public_http_origin_when_the_extension_or_browser_blocks_popup_observation"
      ],
      abstentionTriggers: [
        "browser_permission_bubble_helper_v2_unavailable",
        "permission_prompt_not_proven_current",
        "permission_prompt_origin_not_verified"
      ],
      rankingDelta: -0.8,
      ttlMs: 7 * 24 * 60 * 60 * 1000
    });
    this.recordObservation(sessionId, {
      id: `observation:${randomUUID()}`,
      kind: "screen",
      source: "browser_permission_bubble_boundary",
      surface: surfaceKind,
      capturedAt: now,
      dagNodeId: actionNode.id,
      evalRunId: state.summary.evalRunId,
      summary: "Browser permission bubble native-click automation was blocked before native input because signed watch-mode helper v2 preconditions are not satisfied.",
      freshness: "unknown",
      metadata: {
        evalStepId: evalStep.id,
        reason,
        permissionType,
        targetButton,
        actualInputSent: false,
        nativePopupClick: false,
        permissionChanged: false,
        missingPreconditions: blockingPreconditions
      },
      redaction: {
        screenshots: "not_stored",
        browserOrigin: "host_or_hash_only",
        credentials: "redacted",
        foregroundWindow: "metadata_only"
      }
    });
    this.recordRollbackAction(sessionId, {
      kind: "none_available",
      label: "No rollback needed because no browser permission popup input was sent",
      status: "skipped",
      riskClass: "browser_state_mutation",
      target: "browser_permission_bubble",
      reason: "no_permission_popup_input_was_sent",
      metadata: {
        permissionType,
        targetButton,
        blockedReason: reason
      }
    });
    this.recordVerifierResult(sessionId, {
      id: `verifier:${actionNode.id}`,
      status: "failed",
      reason: "Browser permission bubble native-click automation did not run because signed watch-mode helper v2 and popup verification guards are unavailable.",
      permissionType,
      targetButton,
      actualInputSent: false,
      nativePopupClick: false,
      permissionChanged: false,
      missingPreconditions: blockingPreconditions.map((precondition) => precondition.id)
    });
    this.block(sessionId, reason);
    return {
      session: this.requireSession(sessionId).summary,
      dagNode: this.options.storage.readCapabilityDagNode(actionNode.id) ?? actionNode
    };
  }

  private blockFutureVmSessionBoundary(input: {
    sessionId: string;
    evalRunId: string;
    dagRunId: string;
    surfaceDecision: ExecutionSurfaceDecision;
    input: ComputerSessionCreateInput;
  }): ComputerSessionStartResult {
    const state = this.requireSession(input.sessionId);
    const now = new Date().toISOString();
    const reason = "future_vm_session_backend_not_available";
    const preconditions = buildFutureVmSessionPreconditions(input.input);
    const output = {
      ok: false,
      status: "blocked",
      reason,
      selectedSurface: input.surfaceDecision.surface.kind,
      vmCreated: false,
      hostMutationAllowed: false,
      networkOpened: false,
      rawScreenshotRetained: false,
      missingPreconditions: preconditions,
      requiredGrants: input.surfaceDecision.requiredGrants,
      safetyBoundaries: [
        "no_host_mutation_without_vm_backend",
        "no_network_bridge_without_isolation_policy",
        "no_clipboard_or_file_sync_without_redaction_policy",
        "vm_lifecycle_cleanup_required",
        "raw_screenshot_retention_policy_required"
      ],
      nextSafeAction: "Use isolated_browser, tool_workspace, or pty_workspace for bounded tasks until a VM backend exists."
    };
    const surfaceNode = this.options.storage.upsertCapabilityDagNode({
      id: `${input.sessionId}:surface_select`,
      dagRunId: input.dagRunId,
      kind: "setup",
      status: "failed",
      input: {
        surface: input.surfaceDecision.surface.kind,
        reason: input.surfaceDecision.reason,
        requestedSurface: input.input.requestedSurface
      },
      output,
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: reason
    });
    this.options.storage.upsertCapabilityDagNode({
      id: `${input.sessionId}:observe`,
      dagRunId: input.dagRunId,
      kind: "observe",
      status: "skipped",
      dependsOn: [`${input.sessionId}:surface_select`],
      input: { mode: "skeleton_observe" },
      output: {
        skipped: true,
        reason
      },
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
    this.options.storage.upsertCapabilityDagNode({
      id: `${input.sessionId}:plan`,
      dagRunId: input.dagRunId,
      kind: "plan",
      status: "skipped",
      dependsOn: [`${input.sessionId}:observe`],
      input: { mode: "skeleton_plan" },
      output: {
        skipped: true,
        reason
      },
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
    this.options.storage.upsertCapabilityDagNode({
      id: `${input.sessionId}:eval_ledger`,
      dagRunId: input.dagRunId,
      kind: "eval_ledger",
      status: "failed",
      dependsOn: [`${input.sessionId}:plan`],
      input: { evalRunId: input.evalRunId },
      output: {
        recorded: true,
        reason
      },
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: reason
    });
    state.safetyDecisions.push({
      decision: "blocked",
      phase: "future_vm_session_preconditions",
      reason,
      selectedSurface: input.surfaceDecision.surface.kind,
      requiredGrants: input.surfaceDecision.requiredGrants,
      missingPreconditions: preconditions.map((precondition) => precondition.id),
      vmCreated: false,
      hostMutationAllowed: false
    });
    const evalStep = this.options.storage.appendComputerUseEvalStep({
      runId: input.evalRunId,
      kind: "future_vm_session_blocked",
      phase: "setup",
      status: "blocked",
      capabilityDagNodeId: surfaceNode.id,
      input: {
        userRequest: input.input.userRequest,
        requestedSurface: input.input.requestedSurface,
        selectedSurface: input.surfaceDecision.surface.kind,
        requiredGrants: input.surfaceDecision.requiredGrants
      },
      output,
      failureClass: "external_blocker",
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
    recordStructuredFailure({
      storage: this.options.storage,
      failureClass: "external_blocker",
      surface: "windows",
      source: "computer_session_future_vm_session_boundary",
      scenarioId: `computer-session:${input.sessionId}`,
      evalRunId: input.evalRunId,
      evalStepId: evalStep.id,
      recoveryHints: [
        "route_public_web_tasks_to_isolated_browser",
        "route_research_or_artifact_tasks_to_tool_workspace",
        "route_safe_local_commands_to_pty_workspace",
        "do_not_use_foreground_host_mutation_as_vm_substitute"
      ],
      abstentionTriggers: [
        "future_vm_session_backend_not_available",
        "vm_lifecycle_cleanup_unavailable",
        "vm_network_isolation_unavailable"
      ],
      rankingDelta: -0.7,
      ttlMs: 7 * 24 * 60 * 60 * 1000
    });
    this.recordObservation(input.sessionId, {
      id: `observation:${randomUUID()}`,
      kind: "unknown",
      source: "future_vm_session_boundary",
      surface: "future_vm_session",
      capturedAt: now,
      dagNodeId: surfaceNode.id,
      evalRunId: input.evalRunId,
      summary: "Future VM session was blocked because no local VM/sandbox backend, isolation policy, or lifecycle cleanup proof is available.",
      freshness: "unknown",
      metadata: {
        evalStepId: evalStep.id,
        reason,
        vmCreated: false,
        hostMutationAllowed: false,
        networkOpened: false,
        missingPreconditions: preconditions
      },
      redaction: {
        screenshots: "not_stored",
        localPaths: "not_stored",
        credentials: "redacted"
      }
    });
    this.recordRollbackAction(input.sessionId, {
      kind: "none_available",
      label: "No rollback needed because no VM session was created",
      status: "skipped",
      riskClass: "security_boundary",
      target: "future_vm_session",
      reason: "no_vm_session_was_created",
      metadata: {
        blockedReason: reason,
        vmCreated: false
      }
    });
    this.recordVerifierResult(input.sessionId, {
      id: `verifier:${surfaceNode.id}`,
      status: "failed",
      reason: "Future VM session did not start because VM backend isolation and lifecycle preconditions are unavailable.",
      vmCreated: false,
      hostMutationAllowed: false,
      missingPreconditions: preconditions.map((precondition) => precondition.id)
    });
    this.options.storage.updateComputerUseEvalRun({
      id: input.evalRunId,
      status: "failed",
      taskSuccess: "blocked",
      failureClass: "external_blocker",
      completedAt: now,
      metrics: {
        proofRecorded: true,
        blockedSurface: "future_vm_session",
        vmCreated: false,
        hostMutationAllowed: false
      }
    });
    this.options.storage.updateCapabilityDagRun({
      id: input.dagRunId,
      status: "failed",
      completedAt: now
    });
    this.block(input.sessionId, reason);
    const updatedEvalRun = this.options.storage.readComputerUseEvalRun(input.evalRunId);
    const updatedDagRun = this.options.storage.readCapabilityDagRun(input.dagRunId);
    if (!updatedEvalRun || !updatedDagRun) {
      throw new Error("Future VM session boundary failed to persist eval or DAG state.");
    }
    return {
      session: this.requireSession(input.sessionId).summary,
      evalRun: updatedEvalRun,
      dagRun: updatedDagRun,
      dagNodes: this.options.storage.listCapabilityDagNodes(input.dagRunId)
    };
  }

  async cancel(sessionId: string, reason = "cancelled"): Promise<ComputerSessionSummary> {
    const state = this.requireSession(sessionId);
    this.transition(sessionId, "cancelled", { blockedReason: reason });
    const jobs = this.options.storage.listCapabilityJobs({ sessionId, limit: 100 });
    const cancellableJobs = jobs.filter((job) => !["completed", "failed", "cancelled", "expired"].includes(job.status));
    await Promise.all(cancellableJobs.map(async (job) => {
      const rollback = this.recordRollbackAction(sessionId, {
        kind: "cancel_capability_job",
        label: `Cancel capability job ${job.kind}`,
        status: "running",
        riskClass: "read_only",
        capabilityJobId: job.id,
        reason
      });
      try {
        await this.options.capabilityRuntime.cancel(job.id, `computer_session_cancelled:${reason}`);
        this.completeRollbackAction(sessionId, rollback.id, "completed");
      } catch (error) {
        this.completeRollbackAction(sessionId, rollback.id, "failed", error instanceof Error ? error.message : "capability_cancel_failed");
      }
    }));
    if (state.summary.dagRunId) {
      this.options.storage.updateCapabilityDagRun({
        id: state.summary.dagRunId,
        status: "cancelled",
        completedAt: new Date().toISOString()
      });
    }
    await this.closeSurfaceResources(sessionId);
    return state.summary;
  }

  attachPermissionProfile(input: {
    sessionId: string;
    profileId: string;
    reason?: string;
    source?: string;
  }): {
    session: ComputerSessionSummary;
    profile: AutonomyPermissionProfile;
  } {
    const state = this.requireSession(input.sessionId);
    const profile = this.options.storage.readAutonomyPermissionProfile(input.profileId);
    if (!profile) {
      throw new Error(`Autonomy permission profile not found: ${input.profileId}`);
    }
    const now = new Date().toISOString();
    state.safetyDecisions.push({
      decision: "profile_attached",
      phase: "permission_profile",
      profileId: profile.id,
      profileName: profile.name,
      profileScope: profile.scope,
      profileMode: profile.mode,
      profileStatus: profile.status,
      maxUses: profile.maxUses,
      source: input.source ?? "computer_session_profile_attach",
      reason: input.reason ?? "Attach permission profile to blocked or approval-pending Computer Session."
    });
    if (state.summary.evalRunId) {
      this.options.storage.appendComputerUseEvalStep({
        runId: state.summary.evalRunId,
        kind: "permission_profile_attached",
        phase: "approval",
        status: profile.status === "active" ? "completed" : "blocked",
        input: {
          profileId: profile.id,
          source: input.source
        },
        output: {
          profileScope: profile.scope,
          profileMode: profile.mode,
          profileStatus: profile.status,
          maxUses: profile.maxUses,
          usedCount: profile.usedCount,
          safetyBoundaries: profile.safetyBoundaries
        },
        failureClass: profile.status === "active" ? "none" : "approval_denied",
        startedAt: now,
        completedAt: now,
        elapsedMs: 0
      });
    }
    const session = this.transition(input.sessionId, state.summary.state, {
      profileId: profile.id
    });
    return { session, profile };
  }

  block(sessionId: string, reason: string): ComputerSessionSummary {
    const summary = this.transition(sessionId, "blocked", { blockedReason: reason, requiresUserAction: reason });
    this.emit({ type: "computer.session.blocked", session: summary, reason });
    return summary;
  }

  read(sessionId: string): ComputerSessionSummary | null {
    return this.sessions.get(sessionId)?.summary ?? null;
  }

  exportDebugBundle(sessionId: string): ComputerSessionDebugBundle {
    const state = this.requireSession(sessionId);
    const evalRun = state.summary.evalRunId ? this.options.storage.readComputerUseEvalRun(state.summary.evalRunId) : null;
    const dagRun = state.summary.dagRunId ? this.options.storage.readCapabilityDagRun(state.summary.dagRunId) : null;
    const capabilityJobs = this.options.storage.listCapabilityJobs({ sessionId, limit: 200 });
    this.reconcileCompletedCapabilityDagNodes(capabilityJobs);
    this.reconcileCompletedCapabilityObservations(sessionId, capabilityJobs);
    const dagNodes: CapabilityDagNodeSummary[] = state.summary.dagRunId ? this.options.storage.listCapabilityDagNodes(state.summary.dagRunId) : [];
    const debugCapabilityJobs = capabilityJobs.map(sanitizeCapabilityJobForDebugBundle);
    const evalResources = state.summary.evalRunId ? this.options.storage.listComputerUseEvalResources(state.summary.evalRunId) : [];
    const perceptionGraphs = this.options.storage.listPerceptionGraphs({ sessionId, limit: 50 });
    const failureMemory = state.summary.evalRunId
      ? this.options.storage.listStructuredFailureMemory({ includeExpired: true, limit: 200 })
          .filter((record) => record.provenance.evalRunId === state.summary.evalRunId || record.scenarioId === evalRun?.scenarioId)
      : [];
    const verifierAudit = state.summary.evalRunId
      ? auditComputerUseVerifier({
          storage: this.options.storage,
          runId: state.summary.evalRunId,
          includePassing: true
        })
      : null;
    const observations = annotateObservationFreshness(state.observations);
    this.persistSessionState(state);
    return {
      schemaVersion: "computer-session-debug-bundle.v1",
      session: state.summary,
      evalRun,
      dagRun,
      dagNodes,
      capabilityJobs: debugCapabilityJobs,
      evalResources,
      perceptionGraphs,
      failureMemory,
      freshnessSummary: summarizeObservationFreshness(observations),
      observations,
      actionFeedbacks: state.actionFeedbacks,
      actionBatches: state.actionBatches,
      promptRuns: state.promptRuns,
      rollbackActions: state.rollbackActions.map(sanitizeRollbackActionForDebugBundle),
      safetyDecisions: state.safetyDecisions,
      verifierResults: state.verifierResults,
      verifierAudit,
      redaction: {
        credentials: "redacted",
        browserHistory: "redacted_by_default",
        localPaths: "minimized",
        screenshots: "blob_retention_policy"
      }
    };
  }

  private evaluateTerminalOperationPermission(
    sessionId: string,
    input: Record<string, unknown>
  ): {
    status: "not_applicable" | "preapproved" | "blocked";
    command: string;
    requirements: AutonomyPermissionRequirement[];
    decision?: AutonomyPermissionDecision;
    reason?: string;
    reversibleRegistryMutation?: BoundedReversibleRegistryMutation;
  } {
    const state = this.requireSession(sessionId);
    const command = readStringField(input, "command") ?? "";
    const requirements: AutonomyPermissionRequirement[] = [
      {
        type: "command",
        value: command,
        reason: "Terminal command execution requires an explicit command allowlist grant."
      },
      {
        type: "risk_class",
        value: mapRiskClassToAutonomyRisk(state.summary.riskClass),
        reason: `Computer Session risk class is ${state.summary.riskClass}.`
      }
    ];
    if (!command) {
      return {
        status: "blocked",
        command,
        requirements,
        reason: "terminal_command_missing"
      };
    }
    const reversibleRegistryMutation = readBoundedReversibleRegistryMutation(input, command);
    if (reversibleRegistryMutation) {
      requirements.push({
        type: "os_mutation",
        value: "bounded_hkcu_app_registry_reversible",
        reason: "Bounded reversible HKCU app-registry mutation requires an explicit OS mutation grant."
      });
    }
    const hardBlockReason = readTerminalHardBlockReason(command, {
      allowBoundedReversibleRegistryMutation: Boolean(reversibleRegistryMutation)
    });
    if (hardBlockReason) {
      return {
        status: "blocked",
        command,
        requirements,
        reason: hardBlockReason
      };
    }
    if (!state.summary.profileId) {
      return {
        status: "not_applicable",
        command,
        requirements
      };
    }
    const profile = this.options.storage.readAutonomyPermissionProfile(state.summary.profileId);
    if (!profile) {
      return {
        status: "not_applicable",
        command,
        requirements
      };
    }
    const decision = evaluateAutonomyPermission({ profile, requirements });
    return decision.allowed
      ? {
          status: "preapproved",
          command,
          requirements,
          decision,
          reversibleRegistryMutation
        }
      : {
          status: "blocked",
          command,
          requirements,
          decision,
          reason: decision.reason,
          reversibleRegistryMutation
        };
  }

  private recordCapabilityOperationObservation(input: {
    sessionId: string;
    operation?: ComputerStructuredOperation;
    job: CapabilityJobSummary;
    dagNodeId: string;
    capabilityKind: CapabilityJobKind;
  }): ComputerSessionObservationSummary | null {
    const state = this.requireSession(input.sessionId);
    const kind = mapCapabilityKindToObservationKind(input.capabilityKind);
    if (!kind) {
      return null;
    }
    const output = input.job.outputJson;
    const operation = input.operation ?? operationFromCapabilityJob(input.capabilityKind, input.job);
    const now = new Date().toISOString();
    let perceptionGraphId = readPerceptionGraphIdFromCapabilityOutput(output);
    if (!perceptionGraphId && kind === "ocr") {
      const text = readTextFromCapabilityOutput(output);
      if (text) {
        const graph = this.options.storage.recordPerceptionGraph({
          graph: buildPerceptionGraphFromOcr({
            sessionId: input.sessionId,
            text,
            source: "computer_session_ocr_observation",
            createdAt: now
          }),
          sessionId: input.sessionId,
          source: "computer_session_ocr_observation",
          createdAt: now
        });
        perceptionGraphId = graph.id;
      }
    }
    if (!perceptionGraphId && kind === "screen") {
      const text = readScreenTextFromCapabilityOutput(output);
      const boxes = readScreenTextBoxesFromCapabilityOutput(output);
      if (text || boxes.length) {
        const graph = this.options.storage.recordPerceptionGraph({
          graph: buildPerceptionGraphFromScreenObservation({
            sessionId: input.sessionId,
            text,
            boxes,
            dirtyRegions: readScreenDirtyRegionsFromCapabilityOutput(output),
            source: "computer_session_screen_observation",
            createdAt: now
          }),
          sessionId: input.sessionId,
          source: "computer_session_screen_observation",
          createdAt: now
        });
        perceptionGraphId = graph.id;
      }
    }
    if (!perceptionGraphId && input.capabilityKind === "desktop_action") {
      const snapshot = readNativeHelperSnapshotFromCapabilityOutput(output);
      if (snapshot) {
        const graph = this.options.storage.recordPerceptionGraph({
          graph: buildPerceptionGraphFromNativeObservation({
            snapshot,
            sessionId: input.sessionId,
            source: "computer_session_native_browser_observation",
            createdAt: now
          }),
          sessionId: input.sessionId,
          source: "computer_session_native_browser_observation",
          createdAt: now
        });
        perceptionGraphId = graph.id;
      }
    }
    const step = state.summary.evalRunId ? this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: `${input.capabilityKind}_observation`,
      phase: "observe",
      status: "completed",
      capabilityJobId: input.job.id,
      capabilityDagNodeId: input.dagNodeId,
      perceptionGraphId,
      input: {
        operation: operation?.kind ?? input.capabilityKind,
        capabilityKind: input.capabilityKind
      },
      output: summarizeCapabilityObservation(kind, output),
      failureClass: "none",
      startedAt: input.job.startedAt,
      completedAt: input.job.completedAt ?? now,
      elapsedMs: input.job.startedAt ? Math.max(0, Date.parse(input.job.completedAt ?? now) - Date.parse(input.job.startedAt)) : undefined
    }) : undefined;
    const resourceIds = state.summary.evalRunId
      ? this.createEvalResourcesForCapabilityJob({
          evalRunId: state.summary.evalRunId,
          stepId: step?.id,
          job: input.job,
          includePerceptionGraph: Boolean(perceptionGraphId)
        })
      : [];
    const artifactResourceIds = state.summary.evalRunId && input.capabilityKind === "terminal"
      ? this.createEvalResourcesForTerminalExpectedArtifacts({
          sessionId: input.sessionId,
          evalRunId: state.summary.evalRunId,
          stepId: step?.id,
          operation
        })
      : [];
    resourceIds.push(...artifactResourceIds);
    const terminalDiffResult = state.summary.evalRunId && input.capabilityKind === "terminal"
      ? this.createEvalResourcesForTerminalOutputRootDiff({
          sessionId: input.sessionId,
          evalRunId: state.summary.evalRunId,
          stepId: step?.id,
          dagNodeId: input.dagNodeId,
          operation
        })
      : emptyTerminalOutputRootDeltaResult();
    resourceIds.push(...terminalDiffResult.resources);
    const cascadeResourceIds = state.summary.evalRunId && input.capabilityKind === "screen_observe"
      ? this.createEvalResourcesForScreenCascade({
          evalRunId: state.summary.evalRunId,
          stepId: step?.id,
          output
        })
      : [];
    resourceIds.push(...cascadeResourceIds);
    const downloadResourceIds = state.summary.evalRunId && input.capabilityKind === "browser_chrome"
      ? this.createEvalResourcesForBrowserChromeDownload({
          sessionId: input.sessionId,
          evalRunId: state.summary.evalRunId,
          stepId: step?.id,
          operation,
          output
        })
      : [];
    resourceIds.push(...downloadResourceIds);
    const record: ComputerSessionObservationSummary = {
      id: `observation:${randomUUID()}`,
      kind,
      source: `${input.capabilityKind}_capability`,
      surface: state.summary.selectedSurface?.kind,
      capturedAt: input.job.completedAt ?? now,
      capabilityJobId: input.job.id,
      dagNodeId: input.dagNodeId,
      evalRunId: state.summary.evalRunId,
      perceptionGraphId,
      resourceIds,
      summary: summarizeObservationRecord(kind, output),
      freshness: "fresh",
      metadata: {
        capabilityKind: input.capabilityKind,
        jobStatus: input.job.status,
        artifactCount: artifactResourceIds.length,
        terminalDiffArtifactCount: terminalDiffResult.summary.capturedArtifactCount,
        terminalOutputRootDelta: terminalDiffResult.summary.manifestEntryCount > 0 ? terminalDiffResult.summary : undefined,
        cascadeEvidenceCount: cascadeResourceIds.length,
        downloadEvidenceCount: downloadResourceIds.length,
        ...(input.operation?.kind === "terminal" ? readTerminalObservationEvidence(input.operation.input) : {}),
        outputKeys: output && typeof output === "object" ? Object.keys(output as Record<string, unknown>).slice(0, 20) : []
      },
      redaction: {
        credentials: "redacted",
        localPaths: input.capabilityKind === "terminal" ? "minimized" : "metadata_only"
      }
    };
    if (input.capabilityKind === "screen_observe") {
      const tileHashes = readScreenTileHashesFromCapabilityOutput(output);
      if (tileHashes.length) {
        state.screenTileCache = {
          tileHashes,
          capturedAt: record.capturedAt,
          observationId: record.id
        };
        record.metadata = {
          ...record.metadata,
          screenTileCache: {
            tileHashCount: tileHashes.length,
            previousTileHashCount: readPreviousTileHashCount(input.job.inputJson),
            dirtyRegionCount: readScreenDirtyRegionsFromCapabilityOutput(output).length,
            cacheUpdated: true
          }
        };
      }
    }
    this.recordObservation(input.sessionId, record);
    if (artifactResourceIds.length) {
      this.recordObservation(input.sessionId, {
        id: `observation:${randomUUID()}`,
        kind: "file",
        source: "terminal_expected_artifact",
        surface: state.summary.selectedSurface?.kind,
        capturedAt: input.job.completedAt ?? now,
        capabilityJobId: input.job.id,
        dagNodeId: input.dagNodeId,
        evalRunId: state.summary.evalRunId,
        resourceIds: artifactResourceIds,
        summary: `Terminal command produced ${artifactResourceIds.length} expected artifact(s).`,
        freshness: "fresh",
        metadata: {
          capabilityKind: input.capabilityKind,
          jobStatus: input.job.status,
          artifactCount: artifactResourceIds.length
        },
        redaction: {
          credentials: "redacted",
          localPaths: "basename_only"
        }
      });
    }
    if (terminalDiffResult.resources.length) {
      this.recordObservation(input.sessionId, {
        id: `observation:${randomUUID()}`,
        kind: "file",
        source: "terminal_output_root_diff",
        surface: state.summary.selectedSurface?.kind,
        capturedAt: input.job.completedAt ?? now,
        capabilityJobId: input.job.id,
        dagNodeId: input.dagNodeId,
        evalRunId: state.summary.evalRunId,
        resourceIds: terminalDiffResult.resources,
        summary: `Terminal command changed ${terminalDiffResult.summary.manifestEntryCount} approved output-root path(s).`,
        freshness: "fresh",
        metadata: {
          capabilityKind: input.capabilityKind,
          jobStatus: input.job.status,
          artifactCount: terminalDiffResult.summary.capturedArtifactCount,
          ...terminalDiffResult.summary
        },
        redaction: {
          credentials: "redacted",
          localPaths: "basename_only"
        }
      });
    }
    if (terminalDiffResult.rollbackTargets.length) {
      this.recordRollbackAction(input.sessionId, {
        kind: "delete_artifact",
        label: "Terminal-created artifact deletion requires explicit confirmation",
        status: "blocked",
        riskClass: "destructive_local_change",
        reason: "terminal_artifact_delete_confirmation_required",
        metadata: {
          source: "terminal_output_root_diff",
          capabilityJobId: input.job.id,
          dagNodeId: input.dagNodeId,
          terminalArtifactTargetCount: terminalDiffResult.rollbackTargets.length,
          terminalArtifactTargets: terminalDiffResult.rollbackTargets
        }
      });
    }
    if (downloadResourceIds.length) {
      this.recordObservation(input.sessionId, {
        id: `observation:${randomUUID()}`,
        kind: "file",
        source: "browser_chrome_download_verify",
        surface: state.summary.selectedSurface?.kind,
        capturedAt: input.job.completedAt ?? now,
        capabilityJobId: input.job.id,
        dagNodeId: input.dagNodeId,
        evalRunId: state.summary.evalRunId,
        resourceIds: downloadResourceIds,
        summary: `Browser Chrome verified ${downloadResourceIds.length} approved download artifact(s).`,
        freshness: "fresh",
        metadata: {
          capabilityKind: input.capabilityKind,
          jobStatus: input.job.status,
          downloadEvidenceCount: downloadResourceIds.length
        },
        redaction: {
          credentials: "redacted",
          localPaths: "basename_only"
        }
      });
    }
    return record;
  }

  private reconcileCompletedCapabilityObservations(sessionId: string, jobs: CapabilityJobSummary[]): void {
    const state = this.requireSession(sessionId);
    const observedJobIds = new Set(state.observations.map((observation) => observation.capabilityJobId).filter(Boolean));
    for (const job of jobs) {
      if (job.status !== "completed" || observedJobIds.has(job.id) || !mapCapabilityKindToObservationKind(job.kind)) {
        continue;
      }
      const dagNodeId = readDagNodeIdFromCapabilityJob(job);
      if (!dagNodeId) {
        continue;
      }
      this.recordCapabilityOperationObservation({
        sessionId,
        job,
        dagNodeId,
        capabilityKind: job.kind
      });
      observedJobIds.add(job.id);
    }
  }

  private reconcileCompletedCapabilityDagNodes(jobs: CapabilityJobSummary[]): void {
    for (const job of jobs) {
      if (!["completed", "failed", "cancelled", "expired"].includes(job.status)) {
        continue;
      }
      const dagRunId = readDagRunIdFromCapabilityJob(job);
      const dagNodeId = readDagNodeIdFromCapabilityJob(job);
      if (!dagRunId || !dagNodeId) {
        continue;
      }
      const node = this.options.storage.readCapabilityDagNode(dagNodeId);
      if (!node || ["completed", "failed", "cancelled"].includes(node.status)) {
        continue;
      }
      const completedAt = job.completedAt ?? new Date().toISOString();
      const status = job.status === "completed"
        ? "completed"
        : job.status === "cancelled"
          ? "cancelled"
          : "failed";
      this.options.storage.upsertCapabilityDagNode({
        ...node,
        status,
        capabilityJobId: job.id,
        output: job.outputJson,
        completedAt,
        elapsedMs: node.startedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(node.startedAt)) : node.elapsedMs,
        lastError: job.lastError
      });
      this.upsertSessionOperationFollowupDagNodes({
        dagRunId,
        dagNodeId,
        capabilityJobId: job.id,
        status,
        completedAt,
        output: job.outputJson,
        lastError: job.lastError
      });
    }
  }

  private createEvalResourcesForCapabilityJob(input: {
    evalRunId: string;
    stepId?: string;
    job: CapabilityJobSummary;
    includePerceptionGraph?: boolean;
  }): ComputerSessionObservationResourceSummary[] {
    const resourceIds: ComputerSessionObservationResourceSummary[] = [];
    for (const resource of this.options.storage.listCapabilityResources(input.job.id)) {
      const evalResource = this.options.storage.createComputerUseEvalResource({
        runId: input.evalRunId,
        stepId: input.stepId,
        capabilityResourceId: resource.id,
        blobId: resource.blobId,
        role: resource.role,
        retention: resource.retention,
        redaction: resource.redaction ?? { mode: "metadata_only" }
      });
      resourceIds.push({
        evalResourceId: evalResource.id,
        capabilityResourceId: resource.id,
        blobId: resource.blobId,
        role: resource.role,
        retention: resource.retention
      });
    }
    if (input.includePerceptionGraph) {
      const evalResource = this.options.storage.createComputerUseEvalResource({
        runId: input.evalRunId,
        stepId: input.stepId,
        role: "perception_graph",
        retention: "evidence",
        redaction: {
          screenshots: "not_stored",
          source: "structured_observation"
        }
      });
      resourceIds.push({
        evalResourceId: evalResource.id,
        role: evalResource.role,
        retention: evalResource.retention
      });
    }
    return resourceIds;
  }

  private createEvalResourcesForTerminalExpectedArtifacts(input: {
    sessionId: string;
    evalRunId: string;
    stepId?: string;
    operation?: ComputerStructuredOperation;
  }): ComputerSessionObservationResourceSummary[] {
    if (input.operation?.kind !== "terminal") {
      return [];
    }
    const state = this.requireSession(input.sessionId);
    const profile = state.summary.profileId
      ? this.options.storage.readAutonomyPermissionProfile(state.summary.profileId)
      : null;
    const writeRoots = profile?.grants.filesystem.writeRoots ?? [];
    if (!writeRoots.length) {
      return [];
    }
    const expectedArtifacts = readExpectedTerminalArtifacts(input.operation.input.expectedArtifacts);
    if (!expectedArtifacts.length) {
      return [];
    }
    const resources: ComputerSessionObservationResourceSummary[] = [];
    for (const artifact of expectedArtifacts.slice(0, 10)) {
      const absolutePath = resolve(artifact.path);
      if (!isPathWithinAnyRoot(absolutePath, writeRoots)) {
        continue;
      }
      if (!existsSync(absolutePath)) {
        continue;
      }
      const stat = statSync(absolutePath);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
        continue;
      }
      const bytes = readFileSync(absolutePath);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const displayName = basename(absolutePath);
      const blob = this.options.storage.writeBlob({
        bytes,
        mime: artifact.mime ?? "application/octet-stream",
        displayName
      });
      const evalResource = this.options.storage.createComputerUseEvalResource({
        runId: input.evalRunId,
        stepId: input.stepId,
        blobId: blob.id,
        role: artifact.role ?? "terminal_artifact",
        retention: "evidence",
        redaction: {
          mode: "artifact_path_redacted",
          basename: displayName,
          sha256,
          source: "terminal_expected_artifact"
        }
      });
      resources.push({
        evalResourceId: evalResource.id,
        blobId: blob.id,
        role: evalResource.role,
        retention: evalResource.retention
      });
    }
    return resources;
  }

  private createEvalResourcesForTerminalOutputRootDiff(input: {
    sessionId: string;
    evalRunId: string;
    stepId?: string;
    dagNodeId: string;
    operation?: ComputerStructuredOperation;
  }): TerminalOutputRootDeltaResult {
    if (input.operation?.kind !== "terminal") {
      return emptyTerminalOutputRootDeltaResult();
    }
    const snapshots = this.terminalOutputRootSnapshots.get(input.dagNodeId) ?? [];
    if (!snapshots.length) {
      return emptyTerminalOutputRootDeltaResult();
    }
    const resources: ComputerSessionObservationResourceSummary[] = [];
    const entries: TerminalOutputRootDeltaEntry[] = [];
    let omittedEntryCount = 0;
    let outputRootCount = 0;
    const rollbackTargets: TerminalArtifactRollbackTarget[] = [];
    for (const snapshot of snapshots) {
      outputRootCount += 1;
      const diff = diffTerminalOutputRootSnapshot(snapshot);
      entries.push(...diff.entries);
      omittedEntryCount += diff.omittedEntryCount;
      for (const changed of diff.entries.filter((entry) => entry.change !== "deleted").slice(0, 10 - resources.length)) {
        if (resources.length >= 10) {
          break;
        }
        const stat = statSync(changed.path);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
          continue;
        }
        const bytes = readFileSync(changed.path);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const displayName = basename(changed.path);
        const blob = this.options.storage.writeBlob({
          bytes,
          mime: "application/octet-stream",
          displayName
        });
        const evalResource = this.options.storage.createComputerUseEvalResource({
          runId: input.evalRunId,
          stepId: input.stepId,
          blobId: blob.id,
          role: "terminal_diff_artifact",
          retention: "evidence",
          redaction: {
            mode: "artifact_path_redacted",
            basename: displayName,
            sha256,
            change: changed.change,
            relativePathHash: changed.relativePathHash,
            source: "terminal_output_root_diff"
          }
        });
        const resourceSummary = {
          evalResourceId: evalResource.id,
          blobId: blob.id,
          role: evalResource.role,
          retention: evalResource.retention
        };
        resources.push(resourceSummary);
        if (changed.change === "created") {
          rollbackTargets.push({
            path: changed.path,
            basename: displayName,
            sha256,
            size: stat.size,
            change: "created",
            blobId: blob.id,
            evalResourceId: evalResource.id
          });
        }
      }
    }
    const manifest = buildTerminalOutputRootDeltaManifest({
      sessionId: input.sessionId,
      dagNodeId: input.dagNodeId,
      entries,
      outputRootCount,
      omittedEntryCount,
      capturedArtifactCount: resources.length,
      rollbackCandidateCount: rollbackTargets.length
    });
    if (manifest.summary.manifestEntryCount > 0) {
      const bytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
      const blob = this.options.storage.writeBlob({
        bytes,
        mime: "application/json",
        displayName: `terminal-output-root-delta-${input.stepId ?? randomUUID()}.json`
      });
      const evalResource = this.options.storage.createComputerUseEvalResource({
        runId: input.evalRunId,
        stepId: input.stepId,
        blobId: blob.id,
        role: "terminal_output_root_delta_manifest",
        retention: "evidence",
        redaction: {
          mode: "terminal_artifact_delta_manifest_path_redacted",
          source: "terminal_output_root_diff",
          createdCount: manifest.summary.createdCount,
          modifiedCount: manifest.summary.modifiedCount,
          deletedCount: manifest.summary.deletedCount,
          omittedEntryCount: manifest.summary.omittedEntryCount
        }
      });
      const manifestResource = {
        evalResourceId: evalResource.id,
        blobId: blob.id,
        role: evalResource.role,
        retention: evalResource.retention
      };
      resources.push(manifestResource);
      this.terminalOutputRootSnapshots.delete(input.dagNodeId);
      return {
        resources,
        manifestResource,
        summary: manifest.summary,
        rollbackTargets
      };
    }
    this.terminalOutputRootSnapshots.delete(input.dagNodeId);
    return {
      resources,
      summary: manifest.summary,
      rollbackTargets
    };
  }

  private captureTerminalOutputRootSnapshots(sessionId: string, input: Record<string, unknown>): TerminalOutputRootSnapshot[] {
    const state = this.requireSession(sessionId);
    const profile = state.summary.profileId
      ? this.options.storage.readAutonomyPermissionProfile(state.summary.profileId)
      : null;
    const writeRoots = profile?.grants.filesystem.writeRoots ?? [];
    if (!writeRoots.length) {
      return [];
    }
    return readTerminalOutputRoots(input)
      .map((root) => resolve(root))
      .filter((root, index, roots) => roots.indexOf(root) === index)
      .filter((root) => isPathWithinAnyRoot(root, writeRoots))
      .slice(0, 4)
      .map((root) => ({
        root,
        files: snapshotTerminalOutputRoot(root)
      }));
  }

  private createEvalResourcesForScreenCascade(input: {
    evalRunId: string;
    stepId?: string;
    output: unknown;
  }): ComputerSessionObservationResourceSummary[] {
    const payload = readScreenCascadePayload(input.output);
    if (!payload) {
      return [];
    }
    const bytes = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
    const blob = this.options.storage.writeBlob({
      bytes,
      mime: "application/json",
      displayName: `roi-cascade-${input.stepId ?? randomUUID()}.json`
    });
    const evalResource = this.options.storage.createComputerUseEvalResource({
      runId: input.evalRunId,
      stepId: input.stepId,
      blobId: blob.id,
      role: "roi_cascade_evidence",
      retention: "evidence",
      redaction: {
        rawScreenshotStored: false,
        source: "screen_observe_tile_hashes",
        dirtyRegionCount: payload.dirtyRegions.length,
        cascadeStageCount: payload.cascadeStages.length
      }
    });
    return [{
      evalResourceId: evalResource.id,
      blobId: blob.id,
      role: evalResource.role,
      retention: evalResource.retention
    }];
  }

  private createEvalResourcesForBrowserChromeDownload(input: {
    sessionId: string;
    evalRunId: string;
    stepId?: string;
    operation?: ComputerStructuredOperation;
    output: unknown;
  }): ComputerSessionObservationResourceSummary[] {
    if (input.operation?.kind !== "browser_chrome") {
      return [];
    }
    const command = typeof input.operation.input.command === "string" ? input.operation.input.command : "";
    if (command !== "download.verify") {
      return [];
    }
    const outputRecord = input.output && typeof input.output === "object" ? input.output as Record<string, unknown> : {};
    const browserChromeOutput = outputRecord.output && typeof outputRecord.output === "object"
      ? outputRecord.output as Record<string, unknown>
      : outputRecord;
    if (browserChromeOutput.verified !== true) {
      return [];
    }
    const approvedPath = typeof input.operation.input.approvedDownloadPath === "string"
      ? input.operation.input.approvedDownloadPath.trim()
      : "";
    if (!approvedPath) {
      return [];
    }
    const state = this.requireSession(input.sessionId);
    const profile = state.summary.profileId
      ? this.options.storage.readAutonomyPermissionProfile(state.summary.profileId)
      : null;
    const allowedRoots = [
      ...(profile?.grants.filesystem.readRoots ?? []),
      ...(profile?.grants.filesystem.writeRoots ?? [])
    ];
    const absolutePath = resolve(approvedPath);
    if (!allowedRoots.length || !isPathWithinAnyRoot(absolutePath, allowedRoots) || !existsSync(absolutePath)) {
      return [];
    }
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size > 25 * 1024 * 1024) {
      return [];
    }
    const bytes = readFileSync(absolutePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const displayName = basename(absolutePath);
    const blob = this.options.storage.writeBlob({
      bytes,
      mime: "application/octet-stream",
      displayName
    });
    const evalResource = this.options.storage.createComputerUseEvalResource({
      runId: input.evalRunId,
      stepId: input.stepId,
      blobId: blob.id,
      role: "download_verified_file",
      retention: "evidence",
      redaction: {
        mode: "artifact_path_redacted",
        basename: displayName,
        sha256,
        size: bytes.byteLength,
        source: "browser_chrome_download_verify"
      }
    });
    return [{
      evalResourceId: evalResource.id,
      blobId: blob.id,
      role: evalResource.role,
      retention: evalResource.retention
    }];
  }

  private recordEffectVerificationStep(input: {
    sessionId: string;
    dagNodeId: string;
    job: CapabilityJobSummary;
    verification: ComputerSessionEffectVerification;
  }): void {
    const state = this.requireSession(input.sessionId);
    if (!state.summary.evalRunId || !state.summary.dagRunId) {
      return;
    }
    const status = input.verification.status === "passed" ? "completed" : input.verification.status;
    this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "effect_verification",
      phase: "verification",
      status,
      capabilityJobId: input.job.id,
      capabilityDagNodeId: input.dagNodeId,
      input: {
        capabilityKind: input.job.kind,
        verifierClass: input.verification.class
      },
      output: input.verification,
      failureClass: input.verification.failureClass ?? (input.verification.status === "passed" ? "none" : "verification_false_negative"),
      startedAt: input.job.completedAt ?? input.job.updatedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: 0
    });
    const currentRun = this.options.storage.readComputerUseEvalRun(state.summary.evalRunId);
    this.options.storage.updateComputerUseEvalRun({
      id: state.summary.evalRunId,
      status: input.verification.status === "passed" && currentRun?.taskSuccess !== "failed" ? "completed" : "failed",
      taskSuccess: input.verification.status === "passed" && currentRun?.taskSuccess !== "failed" ? "passed" : "failed",
      failureClass: input.verification.status === "passed" && currentRun?.taskSuccess !== "failed"
        ? "none"
        : input.verification.failureClass ?? "verification_false_negative",
      metrics: {
        ...(currentRun?.metrics ?? {}),
        proofRecorded: true,
        latestVerifierStatus: input.verification.status,
        latestVerifierClass: input.verification.class
      },
      completedAt: new Date().toISOString()
    });
    if (input.verification.status !== "passed") {
      this.upsertSessionOperationFollowupDagNodes({
        dagRunId: state.summary.dagRunId,
        dagNodeId: input.dagNodeId,
        status: "failed",
        completedAt: new Date().toISOString(),
        output: {
          verification: input.verification
        },
        lastError: input.verification.reason
      });
    }
  }

  private recordRecoveryAttempt(input: {
    sessionId: string;
    dagNodeId: string;
    job: CapabilityJobSummary;
    verification: ComputerSessionEffectVerification;
  }): void {
    const state = this.requireSession(input.sessionId);
    if (!state.summary.evalRunId || !state.summary.dagRunId) {
      return;
    }
    const hadBudget = state.recoveryAttempts < 1;
    const attemptIndex = state.recoveryAttempts + 1;
    if (hadBudget) {
      state.recoveryAttempts = attemptIndex;
      this.transition(input.sessionId, "recovering");
    }
    const now = new Date().toISOString();
    const recoveryNode = this.options.storage.upsertCapabilityDagNode({
      id: `${input.dagNodeId}:recovery:${attemptIndex}`,
      dagRunId: state.summary.dagRunId,
      kind: "fallback",
      status: hadBudget ? "skipped" : "failed",
      dependsOn: [`${input.dagNodeId}:verification`],
      input: {
        capabilityJobId: input.job.id,
        failedVerification: input.verification
      },
      output: {
        attempted: hadBudget,
        reason: hadBudget ? "automatic_recovery_action_not_available_for_this_operation" : "recovery_budget_exhausted",
        nextSafeAction: "surface_reobserve_or_user_clarification",
        hints: input.verification.recovery?.hints ?? []
      },
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: input.verification.reason
    });
    this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "recovery_attempt",
      phase: "recovering",
      status: recoveryNode.status,
      capabilityJobId: input.job.id,
      capabilityDagNodeId: recoveryNode.id,
      input: {
        failedDagNodeId: input.dagNodeId,
        verifierStatus: input.verification.status
      },
      output: recoveryNode.output,
      failureClass: input.verification.failureClass ?? "recovery_failed",
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
    recordStructuredFailure({
      storage: this.options.storage,
      failureClass: input.verification.failureClass ?? "verification_false_negative",
      surface: inferFailureMemorySurface(state.summary.selectedSurface?.kind, input.job.kind),
      source: "computer_session_effect_verifier",
      scenarioId: `computer-session:${input.sessionId}`,
      evalRunId: state.summary.evalRunId,
      capabilityJobId: input.job.id,
      recoveryHints: input.verification.recovery?.hints ?? ["surface_reobserve_or_user_clarification"],
      abstentionTriggers: ["effect_verification_not_passed"],
      rankingDelta: -0.5,
      ttlMs: 7 * 24 * 60 * 60 * 1000
    });
  }

  private recordToolsmithSessionArtifacts(input: {
    sessionId: string;
    dagNodeId: string;
    result: ScopedAutonomyDagResult;
  }): void {
    const state = this.requireSession(input.sessionId);
    if (!state.summary.evalRunId || !state.summary.dagRunId) {
      return;
    }
    const artifacts = collectToolsmithArtifacts(input.result);
    const sourceSummary = collectToolsmithSourceSummary(input.result);
    const step = this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "toolsmith_artifact_collection",
      phase: "store_artifact",
      status: input.result.run.status === "completed" ? "completed" : "failed",
      capabilityDagNodeId: input.dagNodeId,
      input: {
        autonomyRunId: input.result.run.id,
        autonomyEvalRunId: input.result.run.evalRunId,
        autonomyDagRunId: input.result.run.dagRunId
      },
      output: {
        artifactCount: artifacts.length,
        sourceSummary,
        toolRunIds: input.result.toolRuns.map((toolRun) => toolRun.id),
        roles: [...new Set(artifacts.map((artifact) => artifact.role))]
      },
      failureClass: input.result.run.status === "completed" ? "none" : input.result.run.failureClass ?? "action_failed"
    });
    const resourceIds: ComputerSessionObservationResourceSummary[] = [];
    for (const artifact of artifacts) {
      if (!artifact.blobId) {
        continue;
      }
      const resource = this.options.storage.createComputerUseEvalResource({
        runId: state.summary.evalRunId,
        stepId: step.id,
        blobId: artifact.blobId,
        role: `toolsmith_${artifact.role}`,
        retention: "evidence",
        redaction: {
          mode: "artifact_path_redacted",
          basename: artifact.basename,
          source: "scoped_autonomy"
        }
      });
      resourceIds.push({
        evalResourceId: resource.id,
        blobId: artifact.blobId,
        role: resource.role,
        retention: resource.retention
      });
    }
    const artifactRoles = [...new Set(artifacts.map((artifact) => artifact.role))];
    const artifactNodeStatus = input.result.run.status === "completed" ? "completed" : "failed";
    const now = new Date().toISOString();
    const storeNode = this.options.storage.upsertCapabilityDagNode({
      id: `${input.dagNodeId}:store_artifact`,
      dagRunId: state.summary.dagRunId,
      kind: "store_artifact",
      status: artifactNodeStatus,
      dependsOn: [input.dagNodeId],
      input: {
        autonomyRunId: input.result.run.id,
        artifactCount: artifacts.length
      },
      output: {
        artifactCount: artifacts.length,
        artifactRoles,
        sourceSummary,
        evalResourceIds: resourceIds.map((resource) => resource.evalResourceId).filter(Boolean)
      },
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: artifactNodeStatus === "completed" ? undefined : input.result.run.failureClass ?? "toolsmith_artifact_store_failed"
    });
    const verifiedArtifacts = artifacts.filter((artifact) => artifact.blobId && artifact.sha256);
    const verifyStatus = artifactNodeStatus === "completed" && verifiedArtifacts.length > 0 ? "completed" : "failed";
    const verifyNode = this.options.storage.upsertCapabilityDagNode({
      id: `${input.dagNodeId}:verify_artifact`,
      dagRunId: state.summary.dagRunId,
      kind: "verify_artifact",
      status: verifyStatus,
      dependsOn: [storeNode.id],
      input: {
        autonomyRunId: input.result.run.id,
        storeArtifactNodeId: storeNode.id
      },
      output: {
        artifactCount: artifacts.length,
        verifiedArtifactCount: verifiedArtifacts.length,
        artifactRoles,
        sourceSummary,
        verification: {
          status: verifyStatus === "completed" ? "passed" : "failed",
          reason: verifyStatus === "completed"
            ? "Toolsmith artifacts have blob-backed content and hash evidence."
            : "Toolsmith artifact verification requires at least one blob-backed artifact with hash evidence."
        }
      },
      startedAt: now,
      completedAt: now,
      elapsedMs: 0,
      lastError: verifyStatus === "completed" ? undefined : "toolsmith_artifact_verification_failed"
    });
    this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "toolsmith_artifact_verification",
      phase: "verify_artifact",
      status: verifyStatus,
      capabilityDagNodeId: verifyNode.id,
      input: {
        autonomyRunId: input.result.run.id,
        storeArtifactNodeId: storeNode.id
      },
      output: verifyNode.output,
      failureClass: verifyStatus === "completed" ? "none" : "verification_false_negative",
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
    this.recordObservation(input.sessionId, {
      id: `observation:${randomUUID()}`,
      kind: "file",
      source: "toolsmith_scoped_autonomy",
      surface: state.summary.selectedSurface?.kind,
      capturedAt: input.result.run.completedAt ?? new Date().toISOString(),
      dagNodeId: input.dagNodeId,
      evalRunId: state.summary.evalRunId,
      resourceIds,
      summary: `Toolsmith autonomy run ${input.result.run.status}; ${artifacts.length} artifacts collected.`,
      freshness: "fresh",
      metadata: {
        autonomyRunId: input.result.run.id,
        autonomyEvalRunId: input.result.run.evalRunId,
        autonomyDagRunId: input.result.run.dagRunId,
        toolRunCount: input.result.toolRuns.length,
        artifactCount: artifacts.length,
        artifactRoles,
        sourceSummary,
        storeArtifactNodeId: storeNode.id,
        verifyArtifactNodeId: verifyNode.id,
        status: input.result.run.status
      },
      redaction: {
        rawArtifactPaths: "redacted",
        credentials: "redacted"
      }
    });
    if (artifacts.length > 0) {
      this.recordRollbackAction(input.sessionId, {
        kind: "delete_artifact",
        label: "Artifact deletion requires an explicit file rollback grant",
        status: "blocked",
        riskClass: "local_file_disclosure",
        reason: "artifact_delete_grant_required",
        metadata: {
          autonomyRunId: input.result.run.id,
          artifactCount: artifacts.length,
          artifactRoles
        }
      });
    }
  }

  private upsertSessionOperationFollowupDagNodes(input: {
    dagRunId: string;
    dagNodeId: string;
    capabilityJobId?: string;
    status: "completed" | "failed" | "cancelled";
    completedAt: string;
    output?: unknown;
    lastError?: string;
  }): void {
    const verificationNodeId = `${input.dagNodeId}:verification`;
    this.options.storage.upsertCapabilityDagNode({
      id: verificationNodeId,
      dagRunId: input.dagRunId,
      kind: "verification",
      status: input.status,
      capabilityJobId: input.capabilityJobId,
      dependsOn: [input.dagNodeId],
      input: {
        capabilityJobId: input.capabilityJobId,
        actionNodeId: input.dagNodeId
      },
      output: {
        jobStatus: input.status,
        verification: readToolsmithVerification(input.output),
        lastError: input.lastError
      },
      startedAt: input.completedAt,
      completedAt: input.completedAt,
      elapsedMs: 0,
      lastError: input.lastError
    });
    this.options.storage.upsertCapabilityDagNode({
      id: `${input.dagNodeId}:eval_ledger`,
      dagRunId: input.dagRunId,
      kind: "eval_ledger",
      status: input.status,
      capabilityJobId: input.capabilityJobId,
      dependsOn: [verificationNodeId],
      input: {
        capabilityJobId: input.capabilityJobId,
        verificationNodeId
      },
      output: {
        recorded: true,
        jobStatus: input.status
      },
      startedAt: input.completedAt,
      completedAt: input.completedAt,
      elapsedMs: 0,
      lastError: input.lastError
    });
  }

  private recordRollbackEvalStep(
    state: RuntimeSessionState,
    rollbackAction: ComputerSessionRollbackActionSummary,
    status: ComputerSessionRollbackActionSummary["status"],
    output: Record<string, unknown>
  ): void {
    if (!state.summary.evalRunId) {
      return;
    }
    const now = new Date().toISOString();
    this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "rollback_action",
      phase: "cleanup",
      status: status === "completed" || status === "skipped" ? "completed" : "failed",
      input: {
        rollbackActionId: rollbackAction.id,
        kind: rollbackAction.kind,
        riskClass: rollbackAction.riskClass
      },
      output: {
        ...output,
        rollbackStatus: rollbackAction.status,
        reason: rollbackAction.reason
      },
      failureClass: status === "completed" || status === "skipped" ? "none" : "recovery_failed",
      startedAt: now,
      completedAt: now,
      elapsedMs: 0
    });
  }

  private selectSurface(input: ComputerSessionCreateInput): ExecutionSurfaceDecision {
    return this.surfaceManager.select({
      requestedSurface: input.requestedSurface,
      userRequest: input.userRequest,
      riskClass: input.riskClass,
      requiresBrowserProfile: Boolean(input.metadata?.requiresBrowserProfile),
      requiresForeground: input.requestedSurface === "foreground_desktop_watch" || Boolean(input.metadata?.requiresForeground),
      requiresTerminal: input.requestedSurface === "pty_workspace" || Boolean(input.metadata?.requiresTerminal),
      requiresGeneratedTool: input.requestedSurface === "tool_workspace" || Boolean(input.metadata?.requiresGeneratedTool),
      requiresBrowserChrome: input.requestedSurface === "regular_browser_extension" || Boolean(input.metadata?.requiresBrowserChrome),
      createsLocalArtifact: Boolean(input.metadata?.createsLocalArtifact)
    });
  }

  private evaluateSurfacePermissionProfile(
    state: RuntimeSessionState,
    surfaceDecision: ExecutionSurfaceDecision
  ): AutonomyPermissionDecision {
    if (!surfaceDecision.surface.requiresUserProfileAccess) {
      return {
        allowed: true,
        mode: "scoped_yolo",
        profileId: state.summary.profileId,
        reason: "Execution surface does not require user browser profile access.",
        missingRequirements: [],
        usedRequirements: [],
        safetyBoundaries: []
      };
    }
    const requirements: AutonomyPermissionRequirement[] = [
      {
        type: "browser_automation",
        value: surfaceDecision.surface.kind,
        reason: "Existing browser profile access requires an explicit browser automation/profile grant."
      },
      {
        type: "risk_class",
        value: "high_risk",
        reason: "Existing browser profile state can expose private browsing data."
      }
    ];
    const profile = state.summary.profileId
      ? this.options.storage.readAutonomyPermissionProfile(state.summary.profileId)
      : null;
    return evaluateAutonomyPermission({ profile, requirements });
  }

  private transition(sessionId: string, state: ComputerSessionState, patch: Partial<ComputerSessionSummary> = {}): ComputerSessionSummary {
    const runtimeState = this.requireSession(sessionId);
    const previousState = runtimeState.summary.state;
    runtimeState.summary = {
      ...runtimeState.summary,
      ...patch,
      state,
      updatedAt: new Date().toISOString()
    };
    this.persistSessionState(runtimeState);
    this.emit({ type: "computer.session.state", session: runtimeState.summary, previousState });
    if (state === "completed") {
      this.emit({ type: "computer.session.completed", session: runtimeState.summary });
    }
    return runtimeState.summary;
  }

  private requireSession(sessionId: string): RuntimeSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Computer session not found: ${sessionId}`);
    }
    return session;
  }

  private emit(event: ComputerSessionEvent): void {
    this.options.emit?.(event);
  }

  private createPromptRun(sessionId: string, prompt: string, plan: BrowserActionPromptPlan): ComputerSessionPromptRunSummary {
    const state = this.requireSession(sessionId);
    const now = new Date().toISOString();
    const promptRun: ComputerSessionPromptRunSummary = {
      id: `browser-prompt-run:${randomUUID()}`,
      sessionId,
      prompt,
      planId: plan.id,
      goal: plan.goal,
      status: "pending",
      currentStepIndex: 0,
      confidence: plan.confidence,
      reason: plan.reason,
      steps: plan.steps.map((step, index): ComputerSessionPromptStepSummary => ({
        id: step.id,
        index,
        actionType: step.action.type,
        targetSummary: step.targetSummary,
        status: "pending"
      })),
      createdAt: now,
      updatedAt: now
    };
    state.promptRuns.push(promptRun);
    this.promptPlans.set(promptRun.id, plan);
    this.emitPromptRun(sessionId, promptRun);
    return promptRun;
  }

  private async startBrowserActionPromptStep(
    sessionId: string,
    promptRunId: string,
    stepIndex: number
  ): Promise<ComputerSessionOperationResult> {
    const state = this.requireSession(sessionId);
    const promptRun = this.requirePromptRun(state, promptRunId);
    const plan = this.promptPlans.get(promptRunId);
    const step = plan?.steps[stepIndex];
    const stepSummary = promptRun.steps[stepIndex];
    if (!plan || !step || !stepSummary) {
      throw new Error(`Browser Action prompt step not found: ${promptRunId}#${stepIndex}`);
    }
    const now = new Date().toISOString();
    promptRun.status = "running";
    promptRun.currentStepIndex = stepIndex;
    promptRun.updatedAt = now;
    stepSummary.status = "running";
    stepSummary.startedAt = stepSummary.startedAt ?? now;
    stepSummary.lastError = undefined;
    this.emitPromptRun(sessionId, promptRun);
    const operation = await this.executeOperation({
      sessionId,
      operation: {
        kind: "browser_action",
        input: {
          actionSessionId: `computer-session-browser-action:${sessionId}`,
          mode: plan.mode,
          adapterId: plan.adapterId,
          source: plan.source,
          action: step.action,
          expected: step.expected,
          targetHint: step.targetSummary,
          promptRunId,
          promptStepId: step.id,
          promptStepIndex: stepIndex
        }
      }
    });
    const latest = this.requirePromptRun(state, promptRunId);
    const latestStep = latest.steps[stepIndex];
    latestStep.dagNodeId = operation.dagNode.id;
    latestStep.capabilityJobId = operation.job?.id;
    latestStep.status = readPromptStepStatus(operation);
    latestStep.completedAt = isPromptStepFinal(latestStep.status) ? new Date().toISOString() : latestStep.completedAt;
    latestStep.lastError = operation.dagNode.lastError ?? operation.job?.lastError;
    latest.status = latestStep.status === "awaiting_approval" ? "awaiting_approval" : latestStep.status === "completed" ? "running" : latestStep.status;
    latest.updatedAt = new Date().toISOString();
    this.recordPromptStepEval(sessionId, latest, latestStep, "started");
    this.emitPromptRun(sessionId, latest);
    if (latestStep.status === "completed") {
      return (await this.continueBrowserActionPrompt({ sessionId, promptRunId })).operation ?? operation;
    }
    return operation;
  }

  private refreshPromptRunFromStorage(sessionId: string, promptRunId: string): void {
    const state = this.requireSession(sessionId);
    const promptRun = this.requirePromptRun(state, promptRunId);
    let changed = false;
    for (const step of promptRun.steps) {
      if (!step.capabilityJobId && !step.dagNodeId) {
        continue;
      }
      const before = step.status;
      const job = step.capabilityJobId ? this.options.capabilityRuntime.read(step.capabilityJobId) : null;
      const node = step.dagNodeId ? this.options.storage.readCapabilityDagNode(step.dagNodeId) : null;
      step.status = readPromptStepStatusFromJobNode(job, node, step.status);
      step.lastError = node?.lastError ?? job?.lastError ?? step.lastError;
      if (isPromptStepFinal(step.status) && !step.completedAt) {
        step.completedAt = new Date().toISOString();
      }
      if (before !== step.status) {
        changed = true;
        this.recordPromptStepEval(sessionId, promptRun, step, "completed");
      }
    }
    const failed = promptRun.steps.find((step) => step.status === "failed" || step.status === "cancelled");
    if (failed) {
      promptRun.status = failed.status;
      promptRun.lastError = failed.lastError ?? `browser_action_prompt_step_${failed.status}`;
      promptRun.completedAt = promptRun.completedAt ?? new Date().toISOString();
      changed = true;
    } else if (promptRun.steps.every((step) => step.status === "completed" || step.status === "skipped")) {
      promptRun.status = "completed";
      changed = true;
    } else if (promptRun.steps.some((step) => step.status === "awaiting_approval")) {
      promptRun.status = "awaiting_approval";
      changed = true;
    } else if (promptRun.steps.some((step) => step.status === "running")) {
      promptRun.status = "running";
      changed = true;
    }
    if (changed) {
      promptRun.updatedAt = new Date().toISOString();
      this.emitPromptRun(sessionId, promptRun);
      if (promptRun.status === "completed") {
        this.completePromptRun(sessionId, promptRunId);
      }
    }
  }

  private completePromptRun(sessionId: string, promptRunId: string): void {
    const state = this.requireSession(sessionId);
    const promptRun = this.requirePromptRun(state, promptRunId);
    if (promptRun.status === "completed" && promptRun.completedAt) {
      return;
    }
    promptRun.status = "completed";
    promptRun.completedAt = new Date().toISOString();
    promptRun.updatedAt = promptRun.completedAt;
    this.recordVerifierResult(sessionId, {
      id: `verifier:${promptRun.id}`,
      status: "passed",
      reason: "Browser Action prompt run completed all planned steps.",
      promptRunId,
      stepCount: promptRun.steps.length
    });
    this.transition(sessionId, "completed");
    this.emitPromptRun(sessionId, promptRun);
  }

  private readPromptRun(sessionId: string, promptRunId: string): ComputerSessionPromptRunSummary {
    return this.requirePromptRun(this.requireSession(sessionId), promptRunId);
  }

  private requirePromptRun(state: RuntimeSessionState, promptRunId: string): ComputerSessionPromptRunSummary {
    const promptRun = state.promptRuns.find((candidate) => candidate.id === promptRunId);
    if (!promptRun) {
      throw new Error(`Computer session prompt run not found: ${promptRunId}`);
    }
    return promptRun;
  }

  private findContinuablePromptRun(state: RuntimeSessionState): ComputerSessionPromptRunSummary | undefined {
    return state.promptRuns.find((promptRun) => promptRun.status === "running" || promptRun.status === "awaiting_approval" || promptRun.status === "pending");
  }

  private recordPromptStepEval(
    sessionId: string,
    promptRun: ComputerSessionPromptRunSummary,
    step: ComputerSessionPromptStepSummary,
    phase: "started" | "completed"
  ): void {
    const state = this.requireSession(sessionId);
    if (!state.summary.evalRunId) {
      return;
    }
    this.options.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "browser_action_prompt_step",
      phase: "action",
      status: phase === "started" && !isPromptStepFinal(step.status) ? "running" : step.status,
      capabilityJobId: step.capabilityJobId,
      capabilityDagNodeId: step.dagNodeId,
      input: {
        promptRunId: promptRun.id,
        planId: promptRun.planId,
        stepId: step.id,
        stepIndex: step.index,
        actionType: step.actionType,
        targetSummary: step.targetSummary
      },
      output: {
        promptStatus: promptRun.status,
        stepStatus: step.status,
        lastError: step.lastError
      },
      failureClass: step.status === "failed" ? "action_failed" : step.status === "cancelled" ? "external_blocker" : "none"
    });
  }

  private emitPromptRun(sessionId: string, promptRun: ComputerSessionPromptRunSummary): void {
    const state = this.requireSession(sessionId);
    state.summary.updatedAt = new Date().toISOString();
    this.persistSessionState(state);
    this.emit({ type: "computer.session.prompt_run", sessionId, promptRun });
  }

  private hydratePersistedSessions(): void {
    for (const snapshot of this.options.storage.listComputerUseSessionSnapshots({ limit: 200 })) {
      if (this.sessions.has(snapshot.summary.sessionId)) {
        continue;
      }
      const state: RuntimeSessionState = {
        summary: snapshot.summary,
        observations: snapshot.observations,
        actionFeedbacks: snapshot.actionFeedbacks,
        actionBatches: snapshot.actionBatches,
        promptRuns: snapshot.promptRuns,
        rollbackActions: snapshot.rollbackActions,
        safetyDecisions: snapshot.safetyDecisions,
        verifierResults: snapshot.verifierResults,
        recoveryAttempts: snapshot.recoveryAttempts,
        screenTileCache: isScreenTileCache(snapshot.screenTileCache) ? snapshot.screenTileCache : undefined
      };
      this.reconcileHydratedSession(state);
      this.sessions.set(snapshot.summary.sessionId, state);
      this.persistSessionState(state);
    }
  }

  private reconcileHydratedSession(state: RuntimeSessionState): void {
    if (isComputerSessionFinal(state.summary.state)) {
      return;
    }
    const now = new Date().toISOString();
    const previousState = state.summary.state;
    const activeJobs = this.options.storage.listCapabilityJobs({
      sessionId: state.summary.sessionId,
      statuses: ["queued", "scheduled", "awaiting_approval", "running", "cancelling"],
      limit: 200
    });
    const reconciledJobs = activeJobs.map((job) => this.options.storage.updateCapabilityJob({
      id: job.id,
      status: "cancelled",
      cancelledAt: now,
      completedAt: now,
      lastError: "computer_session_runtime_restarted",
      updatedAt: now
    }));
    for (const job of reconciledJobs) {
      this.options.storage.appendCapabilityJobEvent({
        jobId: job.id,
        transactionId: job.transactionId,
        phase: "cancelled",
        status: "cancelled",
        summary: "Capability job cancelled because its Computer Session was reconciled after daemon restart.",
        detail: {
          previousSessionState: previousState,
          reconciliation: "computer_session_runtime_restart"
        },
        createdAt: now
      });
      state.rollbackActions.push({
        id: `rollback:${randomUUID()}`,
        kind: "cancel_capability_job",
        label: `Cancel interrupted ${job.kind} job after daemon restart`,
        status: "completed",
        riskClass: state.summary.riskClass,
        createdAt: now,
        completedAt: now,
        capabilityJobId: job.id,
        reason: "computer_session_runtime_restarted",
        metadata: {
          reconciliation: "computer_session_runtime_restart",
          previousSessionState: previousState
        }
      });
    }
    if (state.summary.dagRunId) {
      const nodes = this.options.storage.listCapabilityDagNodes(state.summary.dagRunId);
      for (const node of nodes) {
        if (isCapabilityDagNodeFinal(node.status)) {
          continue;
        }
        this.options.storage.upsertCapabilityDagNode({
          id: node.id,
          dagRunId: node.dagRunId,
          kind: node.kind,
          status: "cancelled",
          capabilityKind: node.capabilityKind,
          capabilityJobId: node.capabilityJobId,
          priority: node.priority,
          requestedBy: node.requestedBy,
          dependsOn: node.dependsOn,
          confidenceGate: node.confidenceGate,
          input: node.input,
          output: {
            ...(node.output && typeof node.output === "object" && !Array.isArray(node.output) ? node.output as Record<string, unknown> : {}),
            reconciliation: "computer_session_runtime_restart",
            previousStatus: node.status
          },
          resourceUsage: node.resourceUsage,
          startedAt: node.startedAt,
          completedAt: now,
          elapsedMs: node.elapsedMs,
          lastError: "computer_session_runtime_restarted",
          updatedAt: now
        });
      }
      const dagRun = this.options.storage.readCapabilityDagRun(state.summary.dagRunId);
      if (dagRun && !isCapabilityDagNodeFinal(dagRun.status)) {
        this.options.storage.updateCapabilityDagRun({
          id: dagRun.id,
          status: "cancelled",
          metadata: {
            ...readUnknownRecord(dagRun.metadata),
            reconciliation: "computer_session_runtime_restart",
            previousStatus: dagRun.status
          },
          completedAt: now,
          updatedAt: now
        });
      }
    }
    for (const promptRun of state.promptRuns) {
      if (isPromptStepFinal(promptRun.status)) {
        continue;
      }
      promptRun.status = "cancelled";
      promptRun.lastError = "computer_session_runtime_restarted";
      promptRun.completedAt = now;
      promptRun.updatedAt = now;
      for (const step of promptRun.steps) {
        if (isPromptStepFinal(step.status)) {
          continue;
        }
        step.status = "cancelled";
        step.lastError = "computer_session_runtime_restarted";
        step.completedAt = now;
      }
    }
    state.safetyDecisions.push({
      decision: "cancelled",
      phase: "runtime_restart_reconciliation",
      previousState,
      reason: "computer_session_runtime_restarted",
      activeJobCount: activeJobs.length,
      reconciledJobIds: reconciledJobs.map((job) => job.id),
      reconciledAt: now
    });
    state.verifierResults.push({
      id: `verifier:runtime-restart:${state.summary.sessionId}`,
      status: "cancelled",
      reason: "Computer Session was interrupted by daemon restart and reconciled before resuming actions.",
      previousState,
      reconciledJobCount: reconciledJobs.length,
      createdAt: now
    });
    if (state.summary.evalRunId) {
      this.options.storage.appendComputerUseEvalStep({
        runId: state.summary.evalRunId,
        kind: "runtime_restart_reconciliation",
        phase: "reconcile",
        status: "cancelled",
        input: {
          sessionId: state.summary.sessionId,
          previousState,
          activeJobIds: activeJobs.map((job) => job.id)
        },
        output: {
          state: "cancelled",
          reason: "computer_session_runtime_restarted",
          reconciledJobIds: reconciledJobs.map((job) => job.id)
        },
        failureClass: "external_blocker",
        startedAt: now,
        completedAt: now,
        elapsedMs: 0
      });
      const evalRun = this.options.storage.readComputerUseEvalRun(state.summary.evalRunId);
      if (evalRun?.status === "running") {
        this.options.storage.updateComputerUseEvalRun({
          id: evalRun.id,
          status: "cancelled",
          taskSuccess: "abstained",
          failureClass: "external_blocker",
          metrics: {
            ...readUnknownRecord(evalRun.metrics),
            reconciliation: "computer_session_runtime_restart",
            previousSessionState: previousState,
            reconciledJobCount: reconciledJobs.length
          },
          completedAt: now,
          updatedAt: now
        });
      }
    }
    state.summary = {
      ...state.summary,
      state: "cancelled",
      blockedReason: "computer_session_runtime_restarted",
      requiresUserAction: "Review the debug bundle and rerun the request if it is still needed.",
      latestVerifierResultId: `verifier:runtime-restart:${state.summary.sessionId}`,
      updatedAt: now
    };
  }

  private persistSessionState(state: RuntimeSessionState): void {
    this.options.storage.upsertComputerUseSessionSnapshot({
      summary: state.summary,
      observations: state.observations,
      actionFeedbacks: state.actionFeedbacks,
      actionBatches: state.actionBatches,
      promptRuns: state.promptRuns,
      rollbackActions: state.rollbackActions,
      safetyDecisions: state.safetyDecisions,
      verifierResults: state.verifierResults,
      recoveryAttempts: state.recoveryAttempts,
      screenTileCache: state.screenTileCache
    });
  }

  private async closeSurfaceResources(sessionId: string): Promise<void> {
    const state = this.requireSession(sessionId);
    if (state.summary.selectedSurface?.kind !== "isolated_browser") {
      return;
    }
    const rollback = this.recordRollbackAction(sessionId, {
      kind: "close_surface",
      label: "Close isolated Playwright browser",
      status: "running",
      riskClass: "read_only",
      target: `computer-session-browser-action:${sessionId}`,
      metadata: {
        surface: "isolated_browser",
        resource: "playwright_controlled_browser"
      }
    });
    const closed = await closePlaywrightBrowserSession(`computer-session-browser-action:${sessionId}`);
    if (closed) {
      state.safetyDecisions.push({
        decision: "closed",
        phase: "surface_cleanup",
        surface: "isolated_browser",
        resource: "playwright_controlled_browser"
      });
      this.completeRollbackAction(sessionId, rollback.id, "completed");
      return;
    }
    this.completeRollbackAction(sessionId, rollback.id, "skipped", "surface_resource_not_open");
  }

  private async runLocalDagToIdle(dagRunId: string): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
      const before = this.options.storage.listCapabilityDagNodes(dagRunId).map((node) => `${node.id}:${node.status}`).join("|");
      await this.dagRuntime.runReadyNodes(dagRunId);
      const afterNodes = this.options.storage.listCapabilityDagNodes(dagRunId);
      const after = afterNodes.map((node) => `${node.id}:${node.status}`).join("|");
      if (afterNodes.every((node) => node.status === "completed" || node.status === "failed" || node.status === "cancelled" || node.status === "skipped")) {
        return;
      }
      if (before === after) {
        return;
      }
    }
  }
}

function createSkeletonDagNodes(input: {
  sessionId: string;
  evalRunId: string;
  surfaceDecision: ExecutionSurfaceDecision;
}) {
  const prefix = input.sessionId;
  return [
    {
      id: `${prefix}:permission_check`,
      kind: "permission_check" as const,
      input: {
        evalRunId: input.evalRunId,
        requiredGrants: input.surfaceDecision.requiredGrants
      }
    },
    {
      id: `${prefix}:surface_select`,
      kind: "setup" as const,
      dependsOn: [`${prefix}:permission_check`],
      input: {
        surface: input.surfaceDecision.surface.kind,
        reason: input.surfaceDecision.reason
      }
    },
    {
      id: `${prefix}:observe`,
      kind: "observe" as const,
      dependsOn: [`${prefix}:surface_select`],
      input: { mode: "skeleton_observe" }
    },
    {
      id: `${prefix}:plan`,
      kind: "plan" as const,
      dependsOn: [`${prefix}:observe`],
      input: { mode: "skeleton_plan" }
    },
    {
      id: `${prefix}:eval_ledger`,
      kind: "eval_ledger" as const,
      dependsOn: [`${prefix}:plan`],
      input: { evalRunId: input.evalRunId }
    }
  ];
}

function inferRiskClass(userRequest: string): RiskClass {
  if (/password|credential|token|결제|payment|보안|security/i.test(userRequest)) {
    return "credential_or_secret";
  }
  if (/delete|remove|삭제|변경|settings|설정/i.test(userRequest)) {
    return "os_settings_mutation";
  }
  if (/upload|첨부|file/i.test(userRequest)) {
    return "local_file_disclosure";
  }
  if (/pdf|markdown|문서|보고서|저장|save/i.test(userRequest)) {
    return "local_artifact_create";
  }
  return "read_only";
}

function inferModalitiesForSurface(surface: string): ComputerUseEvalModality[] {
  if (surface === "pty_workspace" || surface === "tool_workspace") {
    return ["terminal", "cross_app"];
  }
  if (surface === "foreground_desktop_watch" || surface === "future_vm_session") {
    return ["windows", "vision"];
  }
  return ["browser"];
}

function inferFailureMemorySurface(surface: string | undefined, capabilityKind: CapabilityJobKind): ComputerUseEvalModality | "memory" {
  if (capabilityKind === "terminal") return "terminal";
  if (capabilityKind === "desktop_action" || surface === "foreground_desktop_watch" || surface === "future_vm_session") return "windows";
  if (capabilityKind === "screen_observe" || capabilityKind === "ocr") return "vision";
  if (capabilityKind === "browser_action" || capabilityKind === "browser_chrome") return "browser";
  return "memory";
}

function sanitizeCapabilityJobForDebugBundle(job: CapabilityJobSummary): CapabilityJobSummary {
  if (job.kind !== "terminal") {
    return job;
  }
  return {
    ...job,
    outputJson: sanitizeTerminalCapabilityOutput(job.outputJson)
  };
}

const TERMINAL_STDOUT_BYTE_LIMIT = 512 * 1024;
const TERMINAL_STDERR_BYTE_LIMIT = 128 * 1024;

function sanitizeRollbackActionForDebugBundle(action: ComputerSessionRollbackActionSummary): ComputerSessionRollbackActionSummary {
  const metadata = readUnknownRecord(action.metadata);
  const terminalArtifactTargets = readTerminalArtifactRollbackTargets(metadata.terminalArtifactTargets);
  if (!terminalArtifactTargets.length) {
    return action;
  }
  return {
    ...action,
    target: action.target ? createHash("sha256").update(action.target, "utf8").digest("hex") : undefined,
    metadata: {
      ...metadata,
      terminalArtifactTargets: terminalArtifactTargets.map((target) => ({
        basename: target.basename,
        size: target.size,
        sha256: target.sha256,
        change: target.change,
        blobId: target.blobId,
        evalResourceId: target.evalResourceId,
        pathHash: createHash("sha256").update(resolve(target.path), "utf8").digest("hex")
      })),
      terminalArtifactTargetPaths: undefined,
      localPaths: "redacted"
    }
  };
}

function sanitizeTerminalCapabilityOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return output;
  }
  const record = output as Record<string, unknown>;
  const stdout = typeof record.stdout === "string" ? record.stdout : undefined;
  const stderr = typeof record.stderr === "string" ? record.stderr : undefined;
  const truncated = readUnknownRecord(record.truncated);
  return {
    ...record,
    ...(stdout !== undefined ? { stdout: undefined } : {}),
    ...(stderr !== undefined ? { stderr: undefined } : {}),
    truncated: undefined,
    terminalOutput: {
      stdoutLength: stdout?.length ?? 0,
      stderrLength: stderr?.length ?? 0,
      stdoutTruncated: truncated.stdout === true,
      stderrTruncated: truncated.stderr === true,
      stdoutByteLimit: TERMINAL_STDOUT_BYTE_LIMIT,
      stderrByteLimit: TERMINAL_STDERR_BYTE_LIMIT,
      stdoutSha256: stdout !== undefined ? createHash("sha256").update(stdout, "utf8").digest("hex") : undefined,
      stderrSha256: stderr !== undefined ? createHash("sha256").update(stderr, "utf8").digest("hex") : undefined,
      stdoutPreview: stdout !== undefined ? redactTerminalOutputPreview(stdout) : undefined,
      stderrPreview: stderr !== undefined ? redactTerminalOutputPreview(stderr) : undefined,
      previewChars: 240,
      redaction: "terminal_stdout_stderr_preview_only",
      resourceLimits: "terminal_helper_bounded_output"
    }
  };
}

function redactTerminalOutputPreview(value: string): string {
  return value
    .slice(0, 240)
    .replace(/(password|passwd|token|cookie|credential|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

function resolvePromptBrowserSource(
  session: ComputerSessionSummary,
  source: Partial<BrowserActionSource> | undefined
): Partial<BrowserActionSource> | undefined {
  if (session.selectedSurface?.kind !== "isolated_browser") {
    return source;
  }
  return {
    ...source,
    kind: "controlled_browser",
    browser: source?.browser ?? "chromium"
  };
}

function bridgeOperationToCapability(operation: ComputerStructuredOperation): { kind: CapabilityJobKind; input: Record<string, unknown> } | null {
  if (operation.kind === "browser_action" ||
    operation.kind === "browser_chrome" ||
    operation.kind === "terminal" ||
    operation.kind === "screen_observe" ||
    operation.kind === "ocr") {
    return { kind: operation.kind, input: operation.input };
  }
  if (operation.kind === "native_browser_window_action") {
    return { kind: "desktop_action", input: operation.input };
  }
  if (operation.kind === "toolsmith") {
    return { kind: "agent_tool", input: { runtime: "simulated_daemon", capability: "toolsmith", request: operation.input } };
  }
  return null;
}

function operationFromCapabilityJob(
  kind: CapabilityJobKind,
  job: CapabilityJobSummary
): ComputerStructuredOperation | undefined {
  const input = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as Record<string, unknown> : {};
  if (kind === "browser_action" || kind === "browser_chrome" || kind === "terminal" || kind === "screen_observe" || kind === "ocr") {
    return { kind, input } as ComputerStructuredOperation;
  }
  if (kind === "desktop_action") {
    return { kind: "native_browser_window_action", input };
  }
  if (kind === "agent_tool") {
    return { kind: "toolsmith", input };
  }
  return undefined;
}

function routeComputerOperation(
  operation: ComputerStructuredOperation,
  session: ComputerSessionSummary
): Record<string, unknown> {
  const surface = session.selectedSurface?.kind;
  if (operation.kind === "toolsmith") {
    return actionRoute("structured_toolsmith", 1, operation.kind, surface, "Research/artifact work is routed to the bounded Toolsmith workspace.");
  }
  if (operation.kind === "terminal") {
    return actionRoute("structured_terminal", 1, operation.kind, surface, "Local command work is routed through the terminal capability allowlist.");
  }
  if (operation.kind === "browser_chrome") {
    return actionRoute("browser_chrome_api", 3, operation.kind, surface, "Browser chrome state uses the Browser Chrome API before visual fallbacks.");
  }
  if (operation.kind === "screen_observe") {
    return actionRoute("screen_observe_roi_cascade", 8, operation.kind, surface, "Screen observation uses the ROI/cascade perception path.");
  }
  if (operation.kind === "ocr") {
    return actionRoute("roi_ocr", 8, operation.kind, surface, "OCR uses the bounded ROI/text recognition path.");
  }
  if (operation.kind === "native_browser_window_action") {
    return actionRoute("native_browser_window_helper", 6, operation.kind, surface, "Native browser-window helper is lower priority than structured browser APIs.");
  }
  if (operation.kind === "browser_permission_bubble_action") {
    return actionRoute("browser_permission_bubble_helper_v2", 7, operation.kind, surface, "Browser permission bubble native-click recovery requires signed watch-mode helper v2 and prompt verification.", {
      nativeHelperRequired: "signed_watch_mode_helper_v2",
      preferredFallback: "browser_chrome_permission_content_settings_api"
    });
  }
  if (operation.kind === "native_file_picker_action") {
    return actionRoute("native_file_picker_helper_v2", 7, operation.kind, surface, "Native file picker automation requires a signed helper v2 and explicit file-selection approval.", {
      nativeHelperRequired: "signed_file_picker_v2"
    });
  }
  if (operation.kind === "visual_desktop_action") {
    return actionRoute("foreground_visual_watch_mode", 7, operation.kind, surface, "Foreground visual action requires signed watch-mode guards before native input.");
  }
  const input = operation.input && typeof operation.input === "object" ? operation.input as Record<string, unknown> : {};
  const adapterId = typeof input.adapterId === "string" ? input.adapterId : undefined;
  const source = input.source && typeof input.source === "object" ? input.source as Record<string, unknown> : {};
  const sourceKind = typeof source.kind === "string" ? source.kind : undefined;
  const action = input.action && typeof input.action === "object" ? input.action as Record<string, unknown> : {};
  if (adapterId === "cdp") {
    return actionRoute("cdp_browser_action", 4, operation.kind, surface, "CDP command path is used after structured DOM routing when explicitly selected.", { adapterId, sourceKind });
  }
  if (adapterId === "playwright" || sourceKind === "controlled_browser" || surface === "isolated_browser") {
    return actionRoute("dom_playwright_locator", 2, operation.kind, surface, "Controlled browser DOM/Playwright action is preferred for isolated web content.", { adapterId, sourceKind });
  }
  if (sourceKind === "active_tab" || surface === "regular_browser_extension") {
    return actionRoute("extension_injected_dom", 5, operation.kind, surface, "Regular browser tasks use the extension-injected DOM path before native fallbacks.", { adapterId, sourceKind });
  }
  if (action.target && typeof action.target === "object") {
    return actionRoute("dom_selector", 2, operation.kind, surface, "Browser Action target includes structured target evidence.", { adapterId, sourceKind });
  }
  if (typeof action.x === "number" && typeof action.y === "number") {
    return actionRoute("coordinate_action", 7, operation.kind, surface, "Coordinate action is only a late fallback when structured targets are unavailable.", { adapterId, sourceKind });
  }
  return actionRoute("browser_action_auto", 5, operation.kind, surface, "Browser Action will resolve the safest available browser adapter.", { adapterId, sourceKind });
}

function actionRoute(
  executionMode: string,
  preferenceRank: number,
  operationKind: string,
  surface: string | undefined,
  reason: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: "computer-session-action-route.v1",
    operationKind,
    selectedSurface: surface,
    executionMode,
    preferenceRank,
    visualFallbackUsed: executionMode === "coordinate_action" || executionMode === "foreground_visual_watch_mode",
    reason,
    ...extra
  };
}

function mapBrowserActionExecutorResultToDagStatus(result: BrowserActionExecutorResult): CapabilityDagNodeSummary["status"] {
  if (result.status === "completed") return "completed";
  if (result.status === "awaiting_approval" || result.status === "running") return "running";
  if (result.status === "cancelled") return "cancelled";
  return "failed";
}

function createBrowserActionAdapterFallbackPlan(input: {
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>;
  session: ComputerSessionSummary;
  result: BrowserActionExecutorResult;
  actionRoute: Record<string, unknown>;
}): BrowserActionAdapterFallbackPlan | null {
  if (input.result.status !== "failed") {
    return null;
  }
  const operationInput = readUnknownRecord(input.operation.input);
  if (operationInput.disableAdapterFallback === true || operationInput.adapterFallbackAttempt === true) {
    return null;
  }
  if (!isRetryableBrowserActionAdapterFailure(input.result)) {
    return null;
  }
  if (isCredentialSensitiveBrowserAction(operationInput, input.session)) {
    return null;
  }
  const source = readUnknownRecord(operationInput.source);
  const sourceKind = typeof source.kind === "string" ? source.kind : undefined;
  const fromAdapter = typeof operationInput.adapterId === "string" ? operationInput.adapterId : undefined;
  if (fromAdapter === "playwright" && sourceKind === "controlled_browser") {
    return createBrowserActionAdapterFallbackOperation({
      operation: input.operation,
      session: input.session,
      fromActionRoute: input.actionRoute,
      fromAdapter,
      toAdapter: "cdp",
      reason: "Playwright Browser Action failed with a retryable adapter error; retrying once through the same controlled browser using CDP."
    });
  }
  if (fromAdapter !== "extension" && (sourceKind === "active_tab" || input.session.selectedSurface?.kind === "regular_browser_extension")) {
    return createBrowserActionAdapterFallbackOperation({
      operation: input.operation,
      session: input.session,
      fromActionRoute: input.actionRoute,
      fromAdapter,
      toAdapter: "extension",
      reason: "Browser Action failed with a retryable adapter error; retrying once through the extension-injected DOM path."
    });
  }
  return null;
}

function createBrowserActionAdapterFallbackOperation(input: {
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>;
  session: ComputerSessionSummary;
  fromActionRoute: Record<string, unknown>;
  fromAdapter?: string;
  toAdapter: string;
  reason: string;
}): BrowserActionAdapterFallbackPlan {
  const operationInput = readUnknownRecord(input.operation.input);
  const fallbackInput: Record<string, unknown> = {
    ...operationInput,
    adapterId: input.toAdapter,
    adapterFallbackAttempt: true,
    adapterFallbackFrom: input.fromAdapter ?? input.fromActionRoute.executionMode,
    adapterFallbackReason: input.reason
  };
  if (typeof fallbackInput.requestId === "string" && fallbackInput.requestId.trim()) {
    fallbackInput.requestId = `${fallbackInput.requestId.trim()}:adapter-fallback:${input.toAdapter}`;
  }
  const operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }> = {
    kind: "browser_action",
    input: fallbackInput
  };
  return {
    operation,
    actionRoute: {
      ...routeComputerOperation(operation, input.session),
      fallbackFrom: input.fromActionRoute,
      fallbackReason: input.reason
    },
    reason: input.reason,
    fromAdapter: input.fromAdapter,
    toAdapter: input.toAdapter
  };
}

function isRetryableBrowserActionAdapterFailure(result: BrowserActionExecutorResult): boolean {
  const haystack = JSON.stringify({
    error: result.error,
    summary: result.summary,
    output: result.output
  }).toLowerCase();
  if (/(restricted|credential|password|secret|token|permission[_\s-]*denied|approval|unsafe|policy|destructive|blocked_by_policy)/i.test(haystack)) {
    return false;
  }
  return true;
}

function isCredentialSensitiveBrowserAction(input: Record<string, unknown>, session: ComputerSessionSummary): boolean {
  if (session.riskClass === "credential_or_secret" || session.riskClass === "security_boundary") {
    return true;
  }
  const action = readUnknownRecord(input.action);
  const target = readUnknownRecord(action.target);
  const riskHints = Array.isArray(target.riskHints) ? target.riskHints : Array.isArray(action.riskHints) ? action.riskHints : [];
  if (riskHints.some((hint) => typeof hint === "string" && /credential|password|payment|auth|secret|token/i.test(hint))) {
    return true;
  }
  return /(password|passwd|token|cookie|credential|secret|api[_-]?key|payment|card|비밀번호|암호|결제)/i.test(JSON.stringify({ action, target }));
}

function readForegroundWatchPreflight(value: unknown): ForegroundWatchPreflightState {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const abortOnUserInputArmed = readBooleanField(record, "abortOnUserInputArmed");
  const userInputDetected = readBooleanField(record, "userInputDetected");
  const activeWindowDriftDetected = readBooleanField(record, "activeWindowDriftDetected");
  const abortReason = abortOnUserInputArmed && userInputDetected
    ? "foreground_watch_user_input_abort"
    : activeWindowDriftDetected
      ? "foreground_watch_active_window_drift_abort"
      : undefined;
  return {
    schemaVersion: "foreground-watch-preflight.v1",
    oneTimeApprovalGranted: readBooleanField(record, "oneTimeApprovalGranted"),
    visibleCountdownArmed: readBooleanField(record, "visibleCountdownArmed"),
    activeWindowAsserted: readBooleanField(record, "activeWindowAsserted"),
    targetIdentityAsserted: readBooleanField(record, "targetIdentityAsserted"),
    processAllowed: readBooleanField(record, "processAllowed"),
    surfaceLockArmed: readBooleanField(record, "surfaceLockArmed"),
    userIdle: readBooleanField(record, "userIdle"),
    abortOnUserInputArmed,
    userInputDetected,
    activeWindowDriftDetected,
    timeoutArmed: readBooleanField(record, "timeoutArmed"),
    preActionEvidenceReady: readBooleanField(record, "preActionEvidenceReady"),
    postActionEvidenceReady: readBooleanField(record, "postActionEvidenceReady"),
    effectVerifierReady: readBooleanField(record, "effectVerifierReady"),
    rollbackProofReady: readBooleanField(record, "rollbackProofReady"),
    notReversibleRecordReady: readBooleanField(record, "notReversibleRecordReady"),
    signedHelperV2Available: readBooleanField(record, "signedHelperV2Available"),
    actualInputSent: false,
    ...(abortReason ? { abortReason } : {})
  };
}

function buildDisabledForegroundWatchExecutorState(): ForegroundWatchExecutorState {
  return {
    schemaVersion: "browser-native-desktop-helper-foreground-watch-executor.v1",
    helperCommand: "foreground_watch_execute",
    helperScope: "browser_windows_only",
    enabled: false,
    supported: false,
    dryRunOnly: true,
    actualInputSent: false,
    signedHelperV2Available: false,
    releaseGate: "browser-native-helper-signing",
    blocker: "signed_helper_v2_unavailable",
    requiredPreconditions: [
      "one_time_approval",
      "visible_countdown",
      "active_window_assertion",
      "target_identity_assertion",
      "process_allowlist",
      "surface_lock",
      "user_idle",
      "abort_on_user_input",
      "timeout_guard",
      "pre_action_evidence",
      "post_action_evidence",
      "effect_verifier",
      "rollback_or_not_reversible_record"
    ],
    disabledReason: "current_helper_is_browser_window_scoped_and_must_not_send_broad_foreground_input"
  };
}

function readForegroundWatchBlockReason(surfaceKind: string | undefined, preflight: ForegroundWatchPreflightState): string {
  if (surfaceKind !== "foreground_desktop_watch") {
    return "visual_desktop_action_requires_foreground_watch_surface";
  }
  if (preflight.abortReason) {
    return preflight.abortReason;
  }
  return "foreground_watch_mode_v2_not_available";
}

function readForegroundWatchVerifierReason(reason: string): string {
  if (reason === "foreground_watch_user_input_abort") {
    return "Foreground desktop visual action aborted before native input because user input was detected during watch-mode preflight.";
  }
  if (reason === "foreground_watch_active_window_drift_abort") {
    return "Foreground desktop visual action aborted before native input because the active window drifted during watch-mode preflight.";
  }
  return "Foreground desktop visual action did not run because watch-mode safety preconditions are incomplete.";
}

function buildForegroundWatchPreconditions(input: {
  surfaceKind?: string;
  action: Extract<ComputerStructuredOperation, { kind: "visual_desktop_action" }>["action"];
  preflight?: ForegroundWatchPreflightState;
}): Array<{
  id: string;
  status: "satisfied" | "missing" | "blocked";
  reason: string;
}> {
  const surfaceReady = input.surfaceKind === "foreground_desktop_watch";
  const preflight = input.preflight ?? readForegroundWatchPreflight(undefined);
  const effectProofReady = preflight.effectVerifierReady && (preflight.rollbackProofReady || preflight.notReversibleRecordReady);
  return [
    {
      id: "foreground_watch_surface_selected",
      status: surfaceReady ? "satisfied" : "missing",
      reason: surfaceReady ? "Session selected the foreground watch surface." : "Visual desktop actions require a foreground_desktop_watch surface."
    },
    {
      id: "one_time_user_approval",
      status: preflight.oneTimeApprovalGranted ? "satisfied" : "missing",
      reason: preflight.oneTimeApprovalGranted ? "The foreground action has a one-time approval record for this run." : "Foreground input must be approved per run with a visible action preview."
    },
    {
      id: "visible_countdown",
      status: preflight.visibleCountdownArmed ? "satisfied" : "missing",
      reason: preflight.visibleCountdownArmed ? "The foreground watch preflight armed a visible countdown." : "The user must see a countdown before native input is injected."
    },
    {
      id: "active_window_assertion",
      status: preflight.activeWindowDriftDetected ? "blocked" : preflight.activeWindowAsserted ? "satisfied" : "missing",
      reason: preflight.activeWindowDriftDetected
        ? "The foreground watch preflight detected active-window drift and aborted before native input."
        : preflight.activeWindowAsserted
          ? "The foreground watch preflight asserted the active window before input."
          : "The helper must prove the active window still matches the planned target."
    },
    {
      id: "target_identity_check",
      status: preflight.targetIdentityAsserted ? "satisfied" : "missing",
      reason: preflight.targetIdentityAsserted ? "The foreground watch preflight matched the target title, URL, app, or workflow identity." : "The helper must verify the current title, URL, app, or workflow identity before native input."
    },
    {
      id: "process_allowlist_match",
      status: preflight.processAllowed ? "satisfied" : "missing",
      reason: preflight.processAllowed ? "The foreground watch preflight matched the active process allowlist." : "The active process must match the bounded workflow allowlist."
    },
    {
      id: "surface_lock",
      status: preflight.surfaceLockArmed ? "satisfied" : "missing",
      reason: preflight.surfaceLockArmed ? "The foreground surface is locked for this action window." : "Foreground input requires a surface lock so the target cannot drift during countdown or execution."
    },
    {
      id: "mouse_keyboard_idle_guard",
      status: preflight.userInputDetected ? "blocked" : preflight.userIdle ? "satisfied" : "missing",
      reason: preflight.userInputDetected
        ? "The foreground watch preflight detected user input and aborted before native input."
        : preflight.userIdle
          ? "The foreground watch preflight proved the user input stream was idle."
          : "The helper must prove there was no recent user input before acting."
    },
    {
      id: "abort_on_user_input",
      status: preflight.abortOnUserInputArmed ? "satisfied" : "missing",
      reason: preflight.abortOnUserInputArmed ? "The foreground watch preflight armed abort-on-user-input monitoring." : "Any mouse, keyboard, focus, or active-window drift during countdown/execution must abort."
    },
    {
      id: "timeout_guard",
      status: preflight.timeoutArmed ? "satisfied" : "missing",
      reason: preflight.timeoutArmed ? "The foreground watch preflight armed a bounded execution timeout." : "Foreground watch execution must have a bounded timeout before native input can be sent."
    },
    {
      id: "pre_action_screenshot_or_uia",
      status: preflight.preActionEvidenceReady ? "satisfied" : "missing",
      reason: preflight.preActionEvidenceReady ? "Pre-action screen/UIA evidence is available under retention policy." : "The run needs pre-action screen/UIA evidence with blob retention policy."
    },
    {
      id: "post_action_screenshot_or_uia",
      status: preflight.postActionEvidenceReady ? "satisfied" : "missing",
      reason: preflight.postActionEvidenceReady ? "Post-action evidence is available to prove the abort/no-mutation result." : "The run needs post-action evidence to verify the effect or prove no mutation."
    },
    {
      id: "signed_watch_mode_helper_v2",
      status: preflight.signedHelperV2Available ? "satisfied" : "blocked",
      reason: preflight.signedHelperV2Available ? "Signed watch-mode helper v2 is available for this preflight." : "The current helper is browser-window scoped; broader foreground control requires signed watch-mode helper v2."
    },
    {
      id: "effect_verifier_or_not_reversible_record",
      status: effectProofReady ? "satisfied" : "missing",
      reason: effectProofReady ? "Effect verifier and rollback/not-reversible proof are ready." : "Every foreground action needs an effect verifier and either rollback proof or a not-reversible record."
    }
  ];
}

function buildNativeFilePickerPreconditions(input: {
  surfaceKind?: string;
  input: Record<string, unknown>;
}): Array<{
  id: string;
  status: "satisfied" | "missing" | "blocked";
  reason: string;
}> {
  const surfaceReady = input.surfaceKind === "foreground_desktop_watch";
  const hasApprovedPath = typeof input.input.approvedFilePath === "string" || Array.isArray(input.input.approvedFilePaths);
  return [
    {
      id: "foreground_watch_surface_selected",
      status: surfaceReady ? "satisfied" : "missing",
      reason: surfaceReady ? "Session selected the foreground watch surface." : "Native file picker automation requires the foreground_desktop_watch surface."
    },
    {
      id: "one_time_file_selection_approval",
      status: "missing",
      reason: "The user must approve the exact file selection workflow for this run."
    },
    {
      id: "approved_file_path_or_root_grant",
      status: hasApprovedPath ? "satisfied" : "missing",
      reason: hasApprovedPath ? "The request provided an explicit approved path hint." : "The run needs an explicit file path or allowed-root grant before any local path can be selected."
    },
    {
      id: "file_picker_window_assertion",
      status: "missing",
      reason: "The helper must prove the native picker dialog is active and belongs to the expected process."
    },
    {
      id: "active_window_assertion",
      status: "missing",
      reason: "The helper must prove the foreground window still matches the planned file picker target."
    },
    {
      id: "abort_on_user_input",
      status: "missing",
      reason: "Any mouse, keyboard, focus, or active-window drift during picker automation must abort."
    },
    {
      id: "path_redaction_and_retention_policy",
      status: "missing",
      reason: "The helper must emit redacted path evidence and must not persist raw paths or file contents by default."
    },
    {
      id: "signed_file_picker_helper_v2",
      status: "blocked",
      reason: "The current native helper is browser-window scoped; native file picker control requires signed helper v2."
    }
  ];
}

function buildBrowserPermissionBubblePreconditions(input: {
  surfaceKind?: string;
  input: Record<string, unknown>;
}): Array<{
  id: string;
  status: "satisfied" | "missing" | "blocked";
  reason: string;
}> {
  const surfaceReady = input.surfaceKind === "foreground_desktop_watch";
  const hasPermissionType = typeof input.input.permissionType === "string";
  const hasOriginScope = typeof input.input.origin === "string" || typeof input.input.host === "string";
  const hasTargetButton = typeof input.input.targetButton === "string";
  return [
    {
      id: "foreground_watch_surface_selected",
      status: surfaceReady ? "satisfied" : "missing",
      reason: surfaceReady ? "Session selected the foreground watch surface." : "Browser permission bubble native-click recovery requires the foreground_desktop_watch surface."
    },
    {
      id: "one_time_permission_popup_approval",
      status: "missing",
      reason: "The user must approve the exact browser permission prompt click for this run."
    },
    {
      id: "permission_type_identified",
      status: hasPermissionType ? "satisfied" : "missing",
      reason: hasPermissionType ? "The requested permission type is identified." : "The helper must identify the requested permission type before a popup can be clicked."
    },
    {
      id: "origin_scope_verified",
      status: hasOriginScope ? "satisfied" : "missing",
      reason: hasOriginScope ? "The request carries an origin/host scope for verification." : "The permission prompt must be tied to the expected origin or host."
    },
    {
      id: "permission_prompt_window_assertion",
      status: "missing",
      reason: "The helper must prove the visible prompt belongs to the active browser window and expected tab."
    },
    {
      id: "safe_prompt_classification",
      status: "missing",
      reason: "Credential, OS security, admin, and extension-install prompts must be classified and blocked."
    },
    {
      id: "target_button_evidence",
      status: hasTargetButton ? "missing" : "missing",
      reason: hasTargetButton ? "The target button still needs current UIA/screenshot evidence before clicking." : "The helper must identify a bounded Allow/Block/Ask button target before clicking."
    },
    {
      id: "active_window_assertion",
      status: "missing",
      reason: "The helper must prove the active window still matches the browser permission prompt target."
    },
    {
      id: "abort_on_user_input",
      status: "missing",
      reason: "Any mouse, keyboard, focus, or active-window drift during permission prompt automation must abort."
    },
    {
      id: "pre_post_prompt_evidence",
      status: "missing",
      reason: "The run needs pre/post prompt evidence and a permission-state verifier."
    },
    {
      id: "signed_watch_mode_helper_v2",
      status: "blocked",
      reason: "The current helper is browser-window scoped; browser chrome permission popup clicking requires signed watch-mode helper v2."
    }
  ];
}

function buildFutureVmSessionPreconditions(input: ComputerSessionCreateInput): Array<{
  id: string;
  status: "missing" | "blocked";
  reason: string;
}> {
  const needsNetwork = input.metadata?.requiresNetwork !== false;
  return [
    {
      id: "vm_backend_provider",
      status: "blocked",
      reason: "No local VM, Windows Sandbox, RDP, or containerized desktop backend is registered."
    },
    {
      id: "vm_image_or_snapshot",
      status: "missing",
      reason: "A pinned disposable image or snapshot is required before task execution."
    },
    {
      id: "vm_network_isolation_policy",
      status: needsNetwork ? "missing" : "missing",
      reason: "Network egress needs an allowlist and capture policy before browser or app workflows run in a VM."
    },
    {
      id: "vm_clipboard_file_sync_policy",
      status: "missing",
      reason: "Clipboard and file sync need redaction, allowed roots, and artifact retention rules."
    },
    {
      id: "vm_lifecycle_cleanup",
      status: "missing",
      reason: "The daemon must prove VM shutdown, snapshot discard, and temp artifact cleanup."
    },
    {
      id: "vm_observation_retention_policy",
      status: "missing",
      reason: "Screenshot/audio/blob retention policy must be enforced for VM observations."
    },
    {
      id: "vm_effect_verifier",
      status: "missing",
      reason: "VM actions still need before/after evidence and effect verification."
    }
  ];
}

function isReadOnlyComputerAction(action: Extract<ComputerStructuredOperation, { kind: "visual_desktop_action" }>["action"]): boolean {
  return action.type === "screenshot" || action.type === "wait";
}

function mapCapabilityKindToObservationKind(kind: CapabilityJobKind): ComputerSessionObservationKind | null {
  if (kind === "screen_observe" || kind === "desktop_action") {
    return "screen";
  }
  if (kind === "ocr") {
    return "ocr";
  }
  if (kind === "terminal") {
    return "terminal";
  }
  if (kind === "browser_action" || kind === "browser_chrome") {
    return "browser_dom";
  }
  return null;
}

function readComputerSessionIdFromBrowserAction(actionSessionId: string): string | undefined {
  const prefix = "computer-session-browser-action:";
  return actionSessionId.startsWith(prefix) ? actionSessionId.slice(prefix.length) : undefined;
}

function summarizeBrowserObservationForSession(observation: BrowserObservation): Record<string, unknown> {
  return {
    id: observation.id,
    url: observation.url,
    title: observation.title,
    capturedAt: observation.capturedAt,
    readyState: observation.readyState,
    textLength: observation.text?.length ?? 0,
    elementCount: observation.elements.length,
    viewport: observation.viewport,
    focusedElementId: observation.focusedElementId
  };
}

function summarizeObservationFeedbackReference(observation: ComputerSessionObservationSummary): Record<string, unknown> {
  const metadata = observation.metadata ?? {};
  return {
    observationId: observation.id,
    kind: observation.kind,
    source: observation.source,
    capturedAt: observation.capturedAt,
    freshness: observation.freshness,
    perceptionGraphId: observation.perceptionGraphId,
    elementCount: typeof metadata.elementCount === "number" ? metadata.elementCount : undefined,
    graphNodeCount: typeof metadata.perceptionGraphNodeCount === "number" ? metadata.perceptionGraphNodeCount : undefined,
    url: typeof metadata.url === "string" ? metadata.url : undefined,
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    verification: typeof metadata.verification === "string" ? metadata.verification : undefined
  };
}

function mapBrowserActionStatusToFeedbackStatus(status: BrowserActionResult["status"]): ComputerSessionActionFeedbackSummary["status"] {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "failed" || status === "cancelled") {
    return "failed";
  }
  if (status === "needs_approval" || status === "needs_clarification") {
    return "blocked";
  }
  return "unknown";
}

function summarizeBrowserActionTargetEvidence(
  result: BrowserActionResult,
  graphs: PerceptionGraphSummary[],
  currentGraphId?: string
): Record<string, unknown> | undefined {
  const elementId = result.target?.id ?? result.transaction?.candidateId;
  if (!elementId) {
    return undefined;
  }
  const risk = mapBrowserActionRiskToPerceptionRisk(result);
  const graphSet = summarizeTargetGraphSet(graphs, currentGraphId);
  const arbitration = arbitratePerceptionTarget({
    graphs,
    target: {
      elementId,
      label: result.target?.label,
      text: result.target?.text
    },
    risk,
    maxGraphAgeMs: 60_000
  });
  if (!arbitration.selected) {
    return {
      schemaVersion: "computer-session-target-evidence.v1",
      elementId,
      action: result.action.type,
      risk,
      allowed: false,
      confidence: 0,
      evidenceCount: 0,
      arbitration: {
        schemaVersion: arbitration.schemaVersion,
        graphCount: arbitration.graphCount,
        candidateCount: arbitration.candidateCount,
        staleGraphCount: arbitration.staleGraphCount,
        graphSet,
        candidateSources: summarizeArbitrationCandidateSources(arbitration.candidates),
        reason: arbitration.reason
      },
      reason: arbitration.reason
    };
  }
  const { graph, node, explanation, candidate } = arbitration.selected;
  const evidenceSources = [...new Set(node.evidence.map((edge) => edge.source))].slice(0, 8);
  const evidenceClasses = [...new Set(node.evidence.map((edge) => edge.class))].slice(0, 12);
  return {
    schemaVersion: "computer-session-target-evidence.v1",
    graphId: graph.id,
    nodeId: node.id,
    elementId,
    action: result.action.type,
    risk,
    threshold: explanation.threshold,
    allowed: explanation.allowed,
    confidence: Number(explanation.confidence.toFixed(3)),
    evidenceCount: explanation.evidenceCount,
    evidenceSources,
    evidenceClasses,
    disagreementNotes: explanation.disagreementNotes,
    arbitration: {
      schemaVersion: arbitration.schemaVersion,
      graphCount: arbitration.graphCount,
      candidateCount: arbitration.candidateCount,
      staleGraphCount: arbitration.staleGraphCount,
      selectedScore: Number(candidate.score.toFixed(3)),
      selectedMatchReason: candidate.matchReason,
      selectedGraphSource: candidate.graphSource,
      graphSet,
      candidateSources: summarizeArbitrationCandidateSources(arbitration.candidates),
      reason: arbitration.reason
    },
    reason: explanation.reason,
    target: {
      label: node.label,
      role: node.role,
      hasBbox: Boolean(node.bbox),
      actionable: node.actionable
    }
  };
}

function collectSessionTargetGraphs(input: {
  currentGraph: PerceptionGraphSummary;
  sessionId: string;
  storage: StorageService;
  observations: ComputerSessionObservationSummary[];
}): PerceptionGraphSummary[] {
  const graphs: PerceptionGraphSummary[] = [input.currentGraph];
  const observationGraphIds = new Set(input.observations
    .map((observation) => observation.perceptionGraphId)
    .filter((id): id is string => typeof id === "string" && id.length > 0));
  for (const graphId of observationGraphIds) {
    const graph = input.storage.readPerceptionGraph(graphId);
    if (graph) {
      graphs.push(graph);
    }
  }
  graphs.push(...input.storage.listPerceptionGraphs({ sessionId: input.sessionId, limit: 50 }));
  return uniqueGraphsById(graphs);
}

function uniqueGraphsById(graphs: PerceptionGraphSummary[]): PerceptionGraphSummary[] {
  const seen = new Set<string>();
  const unique: PerceptionGraphSummary[] = [];
  for (const graph of graphs) {
    if (seen.has(graph.id)) {
      continue;
    }
    seen.add(graph.id);
    unique.push(graph);
  }
  return unique;
}

function summarizeTargetGraphSet(graphs: PerceptionGraphSummary[], currentGraphId?: string): Record<string, unknown> {
  const sources = new Map<string, { graphCount: number; nodeCount: number; actionableNodeCount: number }>();
  for (const graph of graphs) {
    const current = sources.get(graph.source) ?? { graphCount: 0, nodeCount: 0, actionableNodeCount: 0 };
    current.graphCount += 1;
    current.nodeCount += graph.nodes.length;
    current.actionableNodeCount += graph.nodes.filter((node) => node.actionable).length;
    sources.set(graph.source, current);
  }
  const sourceBreakdown = [...sources.entries()].map(([source, summary]) => ({
    source,
    ...summary
  }));
  return {
    schemaVersion: "computer-session-target-graph-set.v1",
    graphCount: graphs.length,
    sourceCount: sourceBreakdown.length,
    sourceBreakdown,
    currentGraphId,
    includesCurrentGraph: Boolean(currentGraphId && graphs.some((graph) => graph.id === currentGraphId)),
    observationLinkedGraphCount: graphs.filter((graph) => graph.id !== currentGraphId).length
  };
}

function summarizeArbitrationCandidateSources(candidates: Array<{
  graphSource: string;
  allowed: boolean;
  evidenceSources: string[];
  evidenceClasses: string[];
}>): Array<Record<string, unknown>> {
  const grouped = new Map<string, {
    candidateCount: number;
    allowedCount: number;
    evidenceSources: Set<string>;
    evidenceClasses: Set<string>;
  }>();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.graphSource) ?? {
      candidateCount: 0,
      allowedCount: 0,
      evidenceSources: new Set<string>(),
      evidenceClasses: new Set<string>()
    };
    current.candidateCount += 1;
    if (candidate.allowed) {
      current.allowedCount += 1;
    }
    for (const source of candidate.evidenceSources) {
      current.evidenceSources.add(source);
    }
    for (const evidenceClass of candidate.evidenceClasses) {
      current.evidenceClasses.add(evidenceClass);
    }
    grouped.set(candidate.graphSource, current);
  }
  return [...grouped.entries()].map(([graphSource, summary]) => ({
    graphSource,
    candidateCount: summary.candidateCount,
    allowedCount: summary.allowedCount,
    evidenceSources: [...summary.evidenceSources].slice(0, 8),
    evidenceClasses: [...summary.evidenceClasses].slice(0, 12)
  }));
}

function mapBrowserActionRiskToPerceptionRisk(result: BrowserActionResult): PerceptionActionRisk {
  if (result.safety.risk === "high") {
    return result.safety.metadata?.credentialRisk === true ? "credential" : "high_risk";
  }
  if (result.action.type === "read" || result.action.type === "screenshot") {
    return "read_only";
  }
  if (result.safety.risk === "medium" || result.safety.destructive) {
    return "side_effect";
  }
  return result.action.type === "navigate" || result.action.type === "back" || result.action.type === "forward" || result.action.type === "reload"
    ? "reversible"
    : "side_effect";
}

function readPerceptionGraphIdFromCapabilityOutput(output: unknown): string | undefined {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const graph = record.perceptionGraph && typeof record.perceptionGraph === "object" ? record.perceptionGraph as Record<string, unknown> : undefined;
  return typeof graph?.id === "string" ? graph.id : undefined;
}

function readNativeHelperSnapshotFromCapabilityOutput(output: unknown): Parameters<typeof buildPerceptionGraphFromNativeObservation>[0]["snapshot"] | undefined {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  for (const key of ["after", "observation"]) {
    const candidate = record[key];
    if (isNativeHelperSnapshotLike(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isNativeHelperSnapshotLike(value: unknown): value is Parameters<typeof buildPerceptionGraphFromNativeObservation>[0]["snapshot"] {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Array.isArray(record.elements) &&
    (typeof record.title === "string" || typeof record.url === "string" || typeof record.text === "string");
}

function readDagNodeIdFromCapabilityJob(job: CapabilityJobSummary): string | undefined {
  const record = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as Record<string, unknown> : {};
  return typeof record.dagNodeId === "string" ? record.dagNodeId : undefined;
}

function readDagRunIdFromCapabilityJob(job: CapabilityJobSummary): string | undefined {
  const record = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as Record<string, unknown> : {};
  return typeof record.dagRunId === "string" ? record.dagRunId : undefined;
}

function readTextFromCapabilityOutput(output: unknown): string | undefined {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const text = typeof record.text === "string" ? record.text : undefined;
  if (text?.trim()) {
    return text;
  }
  const nested = record.output && typeof record.output === "object" ? record.output as Record<string, unknown> : undefined;
  return typeof nested?.text === "string" && nested.text.trim() ? nested.text : undefined;
}

function applyScreenTileCacheToInput(state: RuntimeSessionState, input: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(input.previousTileHashes) || !state.screenTileCache?.tileHashes.length) {
    return input;
  }
  return {
    ...input,
    previousTileHashes: state.screenTileCache.tileHashes,
    previousTileHashObservationId: state.screenTileCache.observationId,
    previousTileHashCapturedAt: state.screenTileCache.capturedAt
  };
}

function readScreenTileHashesFromCapabilityOutput(output: unknown): unknown[] {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  return Array.isArray(record.tileHashes) ? record.tileHashes.slice(0, 512) : [];
}

function readPreviousTileHashCount(input: unknown): number {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return Array.isArray(record.previousTileHashes) ? record.previousTileHashes.length : 0;
}

function readScreenTextFromCapabilityOutput(output: unknown): string | undefined {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  for (const key of ["screenText", "recognizedText", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  const nested = record.output && typeof record.output === "object" ? record.output as Record<string, unknown> : undefined;
  for (const key of ["screenText", "recognizedText", "text"]) {
    const value = nested?.[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function readScreenTextBoxesFromCapabilityOutput(output: unknown): Array<{ text?: string; label?: string; bbox?: { x: number; y: number; w: number; h: number }; confidence?: number }> {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const nested = record.output && typeof record.output === "object" ? record.output as Record<string, unknown> : undefined;
  const rawBoxes = readFirstArray(record, ["ocrBoxes", "textBoxes", "recognizedTextBoxes", "boxes"]) ??
    readFirstArray(nested, ["ocrBoxes", "textBoxes", "recognizedTextBoxes", "boxes"]) ??
    [];
  return rawBoxes.slice(0, 80).map((item) => {
    const box = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      text: typeof box.text === "string" ? box.text : undefined,
      label: typeof box.label === "string" ? box.label : undefined,
      bbox: readPerceptionBox(box.bbox),
      confidence: typeof box.confidence === "number" ? box.confidence : undefined
    };
  }).filter((box) => box.text || box.label || box.bbox);
}

function readScreenDirtyRegionsFromCapabilityOutput(output: unknown): Array<{ id?: string; bbox?: { x: number; y: number; w: number; h: number }; changedPixelsEstimate?: number }> {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const rawRegions = Array.isArray(record.dirtyRegions) ? record.dirtyRegions : [];
  return rawRegions.slice(0, 128).map((item) => {
    const region = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: typeof region.id === "string" ? region.id : undefined,
      bbox: readPerceptionBox(region.bbox),
      changedPixelsEstimate: typeof region.changedPixelsEstimate === "number" ? region.changedPixelsEstimate : undefined
    };
  }).filter((region) => region.id || region.bbox);
}

function readFirstArray(record: Record<string, unknown> | undefined, keys: string[]): unknown[] | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return undefined;
}

function readPerceptionBox(value: unknown): { x: number; y: number; w: number; h: number } | undefined {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const x = typeof record.x === "number" ? record.x : undefined;
  const y = typeof record.y === "number" ? record.y : undefined;
  const w = typeof record.w === "number" ? record.w : typeof record.width === "number" ? record.width : undefined;
  const h = typeof record.h === "number" ? record.h : typeof record.height === "number" ? record.height : undefined;
  return x !== undefined && y !== undefined && w !== undefined && h !== undefined ? { x, y, w, h } : undefined;
}

function readScreenCascadePayload(output: unknown): {
  tileHashes: unknown[];
  dirtyRegions: unknown[];
  cascadeStages: unknown[];
} | null {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const tileHashes = Array.isArray(record.tileHashes) ? record.tileHashes : [];
  const dirtyRegions = Array.isArray(record.dirtyRegions) ? record.dirtyRegions : [];
  const cascadeStages = Array.isArray(record.cascadeStages) ? record.cascadeStages : [];
  if (!tileHashes.length && !dirtyRegions.length && !cascadeStages.length) {
    return null;
  }
  return {
    tileHashes: tileHashes.slice(0, 512),
    dirtyRegions: dirtyRegions.slice(0, 128),
    cascadeStages: cascadeStages.slice(0, 32)
  };
}

function summarizeCapabilityObservation(kind: ComputerSessionObservationKind, output: unknown): Record<string, unknown> {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  if (kind === "ocr") {
    const text = readTextFromCapabilityOutput(output) ?? "";
    return {
      ok: record.ok,
      textLength: text.length,
      preview: text.slice(0, 500),
      perceptionGraphId: readPerceptionGraphIdFromCapabilityOutput(output),
      metadata: record.metadata
    };
  }
  if (kind === "screen") {
    const text = readScreenTextFromCapabilityOutput(output) ?? "";
    return {
      ok: record.ok,
      textLength: text.length,
      preview: text.slice(0, 500),
      perceptionGraphId: readPerceptionGraphIdFromCapabilityOutput(output),
      dirtyRegionCount: Array.isArray(record.dirtyRegions) ? record.dirtyRegions.length : undefined,
      cascadeStageCount: Array.isArray(record.cascadeStages) ? record.cascadeStages.length : undefined,
      hasOutput: record.output !== undefined
    };
  }
  if (kind === "terminal") {
    return {
      ok: record.ok,
      exitCode: record.exitCode,
      stdoutLength: typeof record.stdout === "string" ? record.stdout.length : undefined,
      stderrLength: typeof record.stderr === "string" ? record.stderr.length : undefined
    };
  }
  return {
    ok: record.ok,
    status: record.status,
    verification: record.capabilityVerification ?? record.verification,
    outputKeys: Object.keys(record).slice(0, 20)
  };
}

function mapRiskClassToAutonomyRisk(riskClass: RiskClass): AutonomyRiskClass {
  if (riskClass === "read_only") return "read_only";
  if (riskClass === "local_artifact_create") return "reversible";
  if (riskClass === "credential_or_secret") return "credential";
  if (riskClass === "browser_state_mutation" || riskClass === "external_submission") return "side_effect";
  return "high_risk";
}

type BoundedReversibleRegistryMutation = {
  scope: "hkcu_app_registry";
  action: "set" | "delete";
  root: string;
  valueName: string;
  rollbackCommand?: string;
  proofCommand?: string;
};

const BOUNDED_REVERSIBLE_REGISTRY_ROOT = "HKCU\\Software\\CodexWidgetComputerUseSmoke";
const SAFE_REGISTRY_VALUE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const SAFE_REGISTRY_DATA_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;

function readTerminalHardBlockReason(
  command: string,
  options: { allowBoundedReversibleRegistryMutation?: boolean } = {}
): string | undefined {
  if (/(?:password|passwd|token|cookie|credential|secret|api[_-]?key)\s*[:=]?\s*\S*/i.test(command)) {
    return "terminal_command_credential_like";
  }
  if (/\b(?:format|shutdown|reboot|bcdedit|cipher\s+\/w|diskpart)\b/i.test(command)) {
    return "terminal_command_destructive_boundary";
  }
  if (/\breg\s+(?:add|delete)\b/i.test(command) && options.allowBoundedReversibleRegistryMutation) {
    return undefined;
  }
  if (/\b(?:rm\s+-rf|del\s+\/[fqs]|remove-item\b.*(?:-recurse|-force)|rmdir\s+\/s|reg\s+(?:add|delete)|set-itemproperty\b)\b/i.test(command)) {
    return "terminal_command_destructive_boundary";
  }
  if (hasTerminalShellControlOperator(command)) {
    return "terminal_command_shell_chaining_boundary";
  }
  return undefined;
}

function hasTerminalShellControlOperator(command: string): boolean {
  let quote: "\"" | "'" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const previous = index > 0 ? command[index - 1] : "";
    if ((char === "\"" || char === "'") && previous !== "\\") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (quote) {
      continue;
    }
    if (char === "\n" || char === "\r" || char === ";" || char === "&" || char === "|") {
      return true;
    }
  }
  return false;
}

function readTerminalObservationEvidence(input: Record<string, unknown>): Record<string, unknown> {
  const command = readStringField(input, "command") ?? "";
  const reversibleRegistryMutation = readBoundedReversibleRegistryMutation(input, command);
  return reversibleRegistryMutation ? { reversibleRegistryMutation } : {};
}

function readBoundedReversibleRegistryMutation(
  input: Record<string, unknown>,
  command: string
): BoundedReversibleRegistryMutation | undefined {
  const descriptor = input.reversibleWindowsSetting && typeof input.reversibleWindowsSetting === "object"
    ? input.reversibleWindowsSetting as Record<string, unknown>
    : null;
  if (!descriptor) {
    return undefined;
  }
  const scope = descriptor.scope;
  const root = typeof descriptor.root === "string" ? descriptor.root.trim() : "";
  const valueName = typeof descriptor.valueName === "string" ? descriptor.valueName.trim() : "";
  const action = descriptor.action;
  if (scope !== "hkcu_app_registry" || root !== BOUNDED_REVERSIBLE_REGISTRY_ROOT || !SAFE_REGISTRY_VALUE_RE.test(valueName)) {
    return undefined;
  }
  const normalizedCommand = normalizeRegistryCommand(command);
  const normalizedRoot = normalizeRegistryCommand(BOUNDED_REVERSIBLE_REGISTRY_ROOT);
  if (action === "set") {
    const valueData = typeof descriptor.valueData === "string" ? descriptor.valueData.trim() : "";
    if (!SAFE_REGISTRY_DATA_RE.test(valueData)) {
      return undefined;
    }
    const expected = normalizeRegistryCommand(`reg add ${BOUNDED_REVERSIBLE_REGISTRY_ROOT} /v ${valueName} /t REG_SZ /d ${valueData} /f`);
    if (normalizedCommand !== expected) {
      return undefined;
    }
    const rollbackCommand = `reg delete ${BOUNDED_REVERSIBLE_REGISTRY_ROOT} /v ${valueName} /f`;
    return {
      scope,
      action,
      root: BOUNDED_REVERSIBLE_REGISTRY_ROOT,
      valueName,
      rollbackCommand,
      proofCommand: `reg query ${BOUNDED_REVERSIBLE_REGISTRY_ROOT} /v ${valueName}`
    };
  }
  if (action === "delete") {
    const expected = normalizeRegistryCommand(`reg delete ${BOUNDED_REVERSIBLE_REGISTRY_ROOT} /v ${valueName} /f`);
    if (normalizedCommand !== expected || !normalizedCommand.startsWith(`reg delete ${normalizedRoot} `)) {
      return undefined;
    }
    return {
      scope,
      action,
      root: BOUNDED_REVERSIBLE_REGISTRY_ROOT,
      valueName,
      proofCommand: `reg query ${BOUNDED_REVERSIBLE_REGISTRY_ROOT}`
    };
  }
  return undefined;
}

function normalizeRegistryCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBooleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function readStringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return strings.length ? strings : undefined;
}

function readSourceDocuments(value: unknown): Array<{ title?: string; url?: string; text: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const documents = value
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      title: typeof item.title === "string" ? item.title : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
      text: typeof item.text === "string" ? item.text : ""
    }))
    .filter((item) => item.text.trim());
  return documents.length ? documents : undefined;
}

function readBrowserFallbackDocuments(value: unknown): Array<{
  title?: string;
  url: string;
  text?: string;
  capture?: Record<string, unknown>;
}> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const documents = value
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      title: typeof item.title === "string" ? item.title : undefined,
      url: typeof item.url === "string" ? item.url.trim() : "",
      text: typeof item.text === "string" ? item.text : undefined,
      capture: item.capture && typeof item.capture === "object" && !Array.isArray(item.capture)
        ? item.capture as Record<string, unknown>
        : undefined
    }))
    .filter((item) => item.url && (item.text?.trim() || item.capture));
  return documents.length ? documents : undefined;
}

function createBrowserActionReobserveOperation(
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>
): Extract<ComputerStructuredOperation, { kind: "browser_action" }> {
  const originalInput = operation.input && typeof operation.input === "object"
    ? operation.input as Record<string, unknown>
    : {};
  const reobserveInput: Record<string, unknown> = {
    action: {
      type: "read",
      reason: `Refresh browser observation before ${readBrowserActionTypeFromOperation(operation)}.`
    }
  };
  for (const key of ["actionSessionId", "adapterId", "source", "mode", "targetHint"]) {
    if (originalInput[key] !== undefined) {
      reobserveInput[key] = originalInput[key];
    }
  }
  if (typeof originalInput.requestId === "string" && originalInput.requestId.trim()) {
    reobserveInput.requestId = `${originalInput.requestId.trim()}:reobserve`;
  }
  return {
    kind: "browser_action",
    input: reobserveInput
  };
}

function readBrowserActionTypeFromOperation(
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>
): string {
  const input = operation.input && typeof operation.input === "object"
    ? operation.input as Record<string, unknown>
    : {};
  const action = input.action && typeof input.action === "object" && !Array.isArray(input.action)
    ? input.action as Record<string, unknown>
    : {};
  return typeof action.type === "string" && action.type.trim() ? action.type.trim() : "unknown";
}

function summarizeBrowserActionTargetForRecovery(
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>
): Record<string, unknown> | undefined {
  const input = operation.input && typeof operation.input === "object"
    ? operation.input as Record<string, unknown>
    : {};
  const action = input.action && typeof input.action === "object" && !Array.isArray(input.action)
    ? input.action as Record<string, unknown>
    : {};
  const target = action.target && typeof action.target === "object" && !Array.isArray(action.target)
    ? action.target as Record<string, unknown>
    : undefined;
  if (!target) {
    return undefined;
  }
  const summary: Record<string, unknown> = {};
  for (const key of ["kind", "id", "role", "label", "name", "text", "selector"]) {
    const value = target[key];
    if (typeof value === "string" && value.trim()) {
      summary[key] = value.length > 160 ? `${value.slice(0, 157)}...` : value;
    }
  }
  return Object.keys(summary).length ? summary : { kind: "unknown" };
}

function evaluateOperationFreshnessRequirement(
  observations: ComputerSessionObservationSummary[],
  operation: ComputerStructuredOperation
): {
  status: "not_required" | "ok" | "blocked";
  reason?: string;
  latestObservation?: ComputerSessionObservationSummary;
  maxAgeMs?: number;
} {
  const input = "input" in operation && operation.input && typeof operation.input === "object"
    ? operation.input as Record<string, unknown>
    : {};
  const requiresFreshObservation = input.requiresFreshObservation === true || typeof input.maxEvidenceAgeMs === "number";
  if (!requiresFreshObservation) {
    return { status: "not_required" };
  }
  const maxAgeMs = clampFreshnessMs(typeof input.maxEvidenceAgeMs === "number" ? input.maxEvidenceAgeMs : undefined);
  const latestObservation = [...observations]
    .reverse()
    .find((observation) => observation.kind !== "session_skeleton");
  if (!latestObservation) {
    return {
      status: "blocked",
      reason: "fresh_observation_required_but_missing",
      maxAgeMs
    };
  }
  const [annotated] = annotateObservationFreshness([latestObservation], new Date(), maxAgeMs);
  if (annotated.freshness !== "fresh") {
    return {
      status: "blocked",
      reason: annotated.freshness === "stale"
        ? "fresh_observation_required_but_stale"
        : "fresh_observation_required_but_unknown",
      latestObservation: annotated,
      maxAgeMs
    };
  }
  return {
    status: "ok",
    latestObservation: annotated,
    maxAgeMs
  };
}

function annotateObservationFreshness(
  observations: ComputerSessionObservationSummary[],
  now = new Date(),
  overrideStaleAfterMs?: number
): ComputerSessionObservationSummary[] {
  return observations.map((observation) => {
    const staleAfterMs = overrideStaleAfterMs ?? staleAfterMsForObservation(observation);
    const capturedAtMs = Date.parse(observation.capturedAt);
    if (!Number.isFinite(capturedAtMs) || staleAfterMs <= 0) {
      return {
        ...observation,
        freshness: "unknown",
        metadata: {
          ...(observation.metadata ?? {}),
          freshnessCheckedAt: now.toISOString(),
          freshnessReason: !Number.isFinite(capturedAtMs) ? "invalid_captured_at" : "no_freshness_window"
        }
      };
    }
    const ageMs = Math.max(0, now.getTime() - capturedAtMs);
    const freshness = ageMs <= staleAfterMs ? "fresh" : "stale";
    return {
      ...observation,
      freshness,
      metadata: {
        ...(observation.metadata ?? {}),
        freshnessCheckedAt: now.toISOString(),
        ageMs,
        staleAfterMs
      }
    };
  });
}

function summarizeObservationFreshness(
  observations: ComputerSessionObservationSummary[]
): ComputerSessionFreshnessSummary {
  const summary: ComputerSessionFreshnessSummary = {
    checkedAt: new Date().toISOString(),
    fresh: 0,
    stale: 0,
    unknown: 0,
    staleObservationIds: []
  };
  for (const observation of observations) {
    if (observation.freshness === "fresh") {
      summary.fresh += 1;
    } else if (observation.freshness === "stale") {
      summary.stale += 1;
      summary.staleObservationIds.push(observation.id);
    } else {
      summary.unknown += 1;
    }
    const ageMs = typeof observation.metadata?.ageMs === "number" ? observation.metadata.ageMs : undefined;
    if (ageMs !== undefined) {
      summary.maxAgeMs = Math.max(summary.maxAgeMs ?? 0, ageMs);
    }
  }
  return summary;
}

function staleAfterMsForObservation(observation: ComputerSessionObservationSummary): number {
  if (observation.kind === "browser_dom" || observation.kind === "screen" || observation.kind === "ocr") {
    return 15_000;
  }
  if (observation.kind === "terminal" || observation.kind === "file") {
    return 5 * 60_000;
  }
  return 0;
}

function clampFreshnessMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 15_000;
  }
  return Math.min(Math.max(Math.floor(value), 250), 5 * 60_000);
}

function readExpectedTerminalArtifacts(value: unknown): Array<{
  path: string;
  role?: string;
  mime?: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      path: typeof item.path === "string" ? item.path.trim() : "",
      role: typeof item.role === "string" && item.role.trim() ? item.role.trim() : undefined,
      mime: typeof item.mime === "string" && item.mime.trim() ? item.mime.trim() : undefined
    }))
    .filter((item) => item.path);
}

function readTerminalArtifactRollbackTargets(value: unknown): TerminalArtifactRollbackTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const targets: TerminalArtifactRollbackTarget[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.change !== "created" || typeof record.path !== "string" || typeof record.sha256 !== "string") {
      continue;
    }
    targets.push({
      path: record.path,
      basename: typeof record.basename === "string" ? record.basename : basename(record.path),
      sha256: record.sha256,
      size: typeof record.size === "number" && Number.isFinite(record.size) ? record.size : 0,
      change: "created",
      blobId: typeof record.blobId === "string" ? record.blobId : undefined,
      evalResourceId: typeof record.evalResourceId === "string" ? record.evalResourceId : undefined
    });
  }
  return targets;
}

function readTerminalOutputRoots(input: Record<string, unknown>): string[] {
  const candidates = [
    input.trackOutputRoots,
    input.outputRoots,
    input.expectedOutputRoots
  ];
  const roots: string[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    for (const value of candidate) {
      if (typeof value === "string" && value.trim()) {
        roots.push(value.trim());
      }
    }
  }
  return roots;
}

function snapshotTerminalOutputRoot(root: string): TerminalOutputRootSnapshot["files"] {
  const files = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
  for (const path of listTerminalOutputRootFiles(root, 200)) {
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
        continue;
      }
      const bytes = readFileSync(path);
      files.set(path, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: createHash("sha256").update(bytes).digest("hex")
      });
    } catch {
      // Best-effort diffing must not turn terminal execution into a failure.
    }
  }
  return files;
}

function diffTerminalOutputRootSnapshot(snapshot: TerminalOutputRootSnapshot): { entries: TerminalOutputRootDeltaEntry[]; omittedEntryCount: number } {
  const entries: TerminalOutputRootDeltaEntry[] = [];
  const currentPaths = new Set<string>();
  const currentFiles = listTerminalOutputRootFiles(snapshot.root, 250);
  for (const path of currentFiles) {
    currentPaths.add(path);
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
        continue;
      }
      const bytes = readFileSync(path);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const previous = snapshot.files.get(path);
      if (!previous) {
        entries.push(createTerminalOutputRootDeltaEntry(snapshot.root, path, "created", {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256
        }));
      } else if (previous.size !== stat.size || previous.sha256 !== sha256) {
        entries.push(createTerminalOutputRootDeltaEntry(snapshot.root, path, "modified", {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256,
          previousSize: previous.size,
          previousSha256: previous.sha256
        }));
      }
    } catch {
      // Ignore files that disappeared or became unreadable during command execution.
    }
  }
  for (const [path, previous] of snapshot.files.entries()) {
    if (!currentPaths.has(path)) {
      entries.push(createTerminalOutputRootDeltaEntry(snapshot.root, path, "deleted", {
        previousSize: previous.size,
        previousSha256: previous.sha256
      }));
    }
  }
  const omittedEntryCount = Math.max(0, entries.length - 100) + (currentFiles.length >= 250 ? 1 : 0);
  return { entries: entries.slice(0, 100), omittedEntryCount };
}

function createTerminalOutputRootDeltaEntry(
  root: string,
  path: string,
  change: TerminalOutputRootDeltaEntry["change"],
  metadata: {
    size?: number;
    mtimeMs?: number;
    sha256?: string;
    previousSize?: number;
    previousSha256?: string;
  }
): TerminalOutputRootDeltaEntry {
  const relativePath = relative(root, path);
  const normalizedRelativePath = relativePath.split("\\").join("/");
  return {
    path,
    root,
    change,
    basename: basename(path),
    relativePathHash: createHash("sha256").update(normalizedRelativePath || basename(path), "utf8").digest("hex"),
    depth: normalizedRelativePath ? normalizedRelativePath.split("/").filter(Boolean).length : 0,
    ...metadata
  };
}

function emptyTerminalOutputRootDeltaResult(): TerminalOutputRootDeltaResult {
  return {
    resources: [],
    summary: {
      outputRootCount: 0,
      createdCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      capturedArtifactCount: 0,
      manifestEntryCount: 0,
      omittedEntryCount: 0,
      rollbackCandidateCount: 0
    },
    rollbackTargets: []
  };
}

function buildTerminalOutputRootDeltaManifest(input: {
  sessionId: string;
  dagNodeId: string;
  entries: TerminalOutputRootDeltaEntry[];
  outputRootCount: number;
  omittedEntryCount: number;
  capturedArtifactCount: number;
  rollbackCandidateCount: number;
}): {
  schemaVersion: "computer-session-terminal-artifact-delta.v1";
  sessionId: string;
  dagNodeId: string;
  summary: TerminalOutputRootDeltaResult["summary"];
  entries: Array<Record<string, unknown>>;
  redaction: Record<string, unknown>;
} {
  const createdCount = input.entries.filter((entry) => entry.change === "created").length;
  const modifiedCount = input.entries.filter((entry) => entry.change === "modified").length;
  const deletedCount = input.entries.filter((entry) => entry.change === "deleted").length;
  return {
    schemaVersion: "computer-session-terminal-artifact-delta.v1",
    sessionId: input.sessionId,
    dagNodeId: input.dagNodeId,
    summary: {
      outputRootCount: input.outputRootCount,
      createdCount,
      modifiedCount,
      deletedCount,
      capturedArtifactCount: input.capturedArtifactCount,
      manifestEntryCount: input.entries.length,
      omittedEntryCount: input.omittedEntryCount,
      rollbackCandidateCount: input.rollbackCandidateCount
    },
    entries: input.entries.map((entry) => ({
      change: entry.change,
      basename: entry.basename,
      relativePathHash: entry.relativePathHash,
      depth: entry.depth,
      size: entry.size,
      sha256: entry.sha256,
      previousSize: entry.previousSize,
      previousSha256: entry.previousSha256
    })),
    redaction: {
      absolutePaths: "not_stored_in_manifest",
      roots: "hashed_only",
      credentials: "not_applicable",
      rollbackTargets: "stored_in_session_state_for_confirmed_delete_only"
    }
  };
}

function listTerminalOutputRootFiles(root: string, limit: number): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const stack = [root];
  while (stack.length && files.length < limit) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile()) {
        files.push(path);
        if (files.length >= limit) {
          break;
        }
      }
    }
  }
  return files;
}

function isPathWithinAnyRoot(path: string, roots: string[]): boolean {
  const absolutePath = resolve(path);
  return roots.some((root) => {
    const absoluteRoot = resolve(root);
    const relation = relative(absoluteRoot, absolutePath);
    return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
  });
}

function summarizeToolsmithDagResult(result: ScopedAutonomyDagResult): Record<string, unknown> {
  const artifacts = collectToolsmithArtifacts(result);
  const sourceSummary = collectToolsmithSourceSummary(result);
  return {
    ok: result.run.status === "completed",
    autonomyRunId: result.run.id,
    autonomyEvalRunId: result.run.evalRunId,
    autonomyDagRunId: result.run.dagRunId,
    status: result.run.status,
    failureClass: result.run.failureClass,
    toolSpecId: result.spec?.id,
    toolRunIds: result.toolRuns.map((toolRun) => toolRun.id),
    artifactCount: artifacts.length,
    sourceSummary,
    artifacts: artifacts.map((artifact) => ({
      role: artifact.role,
      mime: artifact.mime,
      size: artifact.size,
      sha256: artifact.sha256,
      blobId: artifact.blobId,
      resourceId: artifact.resourceId,
      basename: artifact.basename
    })),
    verification: {
      status: result.run.status === "completed" ? "passed" : "failed",
      reason: result.run.status === "completed"
        ? "Scoped autonomy DAG completed and produced artifact evidence."
        : result.run.failureClass ?? "scoped_autonomy_failed"
    }
  };
}

function collectToolsmithArtifacts(result: ScopedAutonomyDagResult): Array<{
  role: string;
  mime?: string;
  size?: number;
  sha256?: string;
  blobId?: string;
  resourceId?: string;
  basename?: string;
}> {
  const artifacts: Array<{
    role: string;
    mime?: string;
    size?: number;
    sha256?: string;
    blobId?: string;
    resourceId?: string;
    basename?: string;
  }> = [];
  for (const toolRun of result.toolRuns) {
    const output = toolRun.output && typeof toolRun.output === "object" ? toolRun.output as Record<string, unknown> : {};
    const rawArtifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
    for (const raw of rawArtifacts) {
      const artifact = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const role = typeof artifact.role === "string" ? artifact.role : "artifact";
      const path = typeof artifact.path === "string" ? artifact.path : "";
      artifacts.push({
        role,
        mime: typeof artifact.mime === "string" ? artifact.mime : undefined,
        size: typeof artifact.size === "number" ? artifact.size : undefined,
        sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : undefined,
        blobId: typeof artifact.blobId === "string" ? artifact.blobId : undefined,
        resourceId: typeof artifact.resourceId === "string" ? artifact.resourceId : undefined,
        basename: path ? path.split(/[\\/]/).pop() : undefined
      });
    }
  }
  return artifacts;
}

function collectToolsmithSourceSummary(result: ScopedAutonomyDagResult): {
  sourceCount: number;
  rows: Array<{
    title?: string;
    url?: string;
    status?: string;
    browserFallback?: boolean;
    chars?: number;
    excerpt?: string;
  }>;
  fetchedUrls: string[];
  browserFallbackUrls: string[];
  warnings: string[];
} {
  const rows: Array<{
    title?: string;
    url?: string;
    status?: string;
    browserFallback?: boolean;
    chars?: number;
    excerpt?: string;
  }> = [];
  const fetchedUrls = new Set<string>();
  const browserFallbackUrls = new Set<string>();
  const warnings = new Set<string>();
  const requestedUrls = new Set<string>();
  let sourceCount = 0;
  for (const toolRun of result.toolRuns) {
    const input = toolRun.input && typeof toolRun.input === "object" ? toolRun.input as Record<string, unknown> : {};
    readStringArray(input.urls).forEach((url) => requestedUrls.add(url));
    const output = toolRun.output && typeof toolRun.output === "object" ? toolRun.output as Record<string, unknown> : {};
    if (typeof output.sourceCount === "number" && output.sourceCount > sourceCount) {
      sourceCount = output.sourceCount;
    }
    const evidence = output.evidence && typeof output.evidence === "object" ? output.evidence as Record<string, unknown> : {};
    readStringArray(evidence.urlsFetched).forEach((url) => fetchedUrls.add(url));
    readStringArray(evidence.browserFallbackUrls).forEach((url) => browserFallbackUrls.add(url));
    readStringArray(output.warnings).forEach((warning) => warnings.add(warning));
    for (const artifact of readArtifactRecords(output.artifacts)) {
      const role = typeof artifact.role === "string" ? artifact.role : "";
      const path = typeof artifact.path === "string" ? artifact.path : "";
      if ((role !== "citation" && role !== "source") || !path || !existsSync(path)) {
        continue;
      }
      try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.size > 128 * 1024) {
          continue;
        }
        const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
        const records = Array.isArray(parsed) ? parsed : [];
        for (const record of records.slice(0, 20)) {
          if (!record || typeof record !== "object") {
            continue;
          }
          const item = record as Record<string, unknown>;
          const url = typeof item.url === "string" ? item.url : undefined;
          const title = typeof item.title === "string" ? item.title : undefined;
          const key = `${url ?? ""}\n${title ?? ""}`;
          if (rows.some((row) => `${row.url ?? ""}\n${row.title ?? ""}` === key)) {
            continue;
          }
          rows.push({
            title,
            url,
            status: typeof item.status === "string" ? item.status : undefined,
            browserFallback: item.browserFallback === true,
            chars: typeof item.chars === "number"
              ? item.chars
              : typeof item.text === "string"
                ? item.text.length
                : undefined,
            excerpt: typeof item.excerpt === "string"
              ? item.excerpt.slice(0, 160)
              : typeof item.text === "string"
                ? item.text.slice(0, 160)
                : undefined
          });
        }
      } catch {
        warnings.add(`source_summary_parse_failed:${role}`);
      }
    }
  }
  if (!sourceCount) {
    sourceCount = rows.length || fetchedUrls.size + browserFallbackUrls.size;
  }
  for (const warning of warnings) {
    const match = /^browser_fallback_used:([^:]+):/.exec(warning);
    if (!match) {
      continue;
    }
    const host = match[1];
    const url = [...requestedUrls].find((candidate) => readUrlHost(candidate) === host) ?? host;
    browserFallbackUrls.add(url);
  }
  for (const url of fetchedUrls) {
    if (!rows.some((row) => row.url === url)) {
      rows.push({ url, status: "fetched" });
    }
  }
  for (const url of browserFallbackUrls) {
    if (!rows.some((row) => row.url === url && row.browserFallback)) {
      rows.push({ url, status: "browser_fallback", browserFallback: true });
    }
  }
  return {
    sourceCount,
    rows: rows.slice(0, 12),
    fetchedUrls: [...fetchedUrls].slice(0, 12),
    browserFallbackUrls: [...browserFallbackUrls].slice(0, 12),
    warnings: [...warnings].slice(0, 20)
  };
}

function readArtifactRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readUrlHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function readToolsmithVerification(output: unknown): unknown {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  return record.verification;
}

function summarizeObservationRecord(kind: ComputerSessionObservationKind, output: unknown): string {
  const summary = summarizeCapabilityObservation(kind, output);
  if (kind === "ocr") {
    return `OCR observation captured ${String(summary.textLength ?? 0)} characters.`;
  }
  if (kind === "screen") {
    return `Screen observation captured ${String(summary.dirtyRegionCount ?? "unknown")} dirty regions.`;
  }
  if (kind === "terminal") {
    return `Terminal observation completed with exit code ${String(summary.exitCode ?? "unknown")}.`;
  }
  return "Capability observation completed through Computer Session runtime.";
}

function readOperationTimeoutMs(input: Record<string, unknown>): number | undefined {
  const timeoutMs = Number(input.timeoutMs);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(120_000, Math.floor(timeoutMs)) : undefined;
}

async function waitForCapabilityJobIfRunning(
  runtime: CapabilityRuntime,
  jobId: string,
  timeoutMs: number
): Promise<CapabilityJobSummary> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let latest = runtime.read(jobId);
  while (latest && !isCapabilitySettledForSession(latest.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    latest = runtime.read(jobId);
  }
  if (!latest) {
    throw new Error(`Capability job not found: ${jobId}`);
  }
  return latest;
}

function isCapabilitySettledForSession(status: CapabilityJobSummary["status"]): boolean {
  return status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "expired" ||
    status === "awaiting_approval";
}

function isComputerSessionFinal(state: ComputerSessionState): boolean {
  return state === "completed" || state === "blocked" || state === "cancelled" || state === "failed";
}

function isCapabilityDagNodeFinal(status: CapabilityDagNodeSummary["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "skipped";
}

function readPromptStepStatus(operation: ComputerSessionOperationResult): ComputerSessionPromptStepStatus {
  return readPromptStepStatusFromJobNode(operation.job ?? null, operation.dagNode, "running");
}

function readPromptStepStatusFromJobNode(
  job: CapabilityJobSummary | null,
  node: CapabilityDagNodeSummary | null,
  fallback: ComputerSessionPromptStepStatus
): ComputerSessionPromptStepStatus {
  if (job?.status === "awaiting_approval") {
    return "awaiting_approval";
  }
  if (job?.status === "completed" || node?.status === "completed") {
    return "completed";
  }
  if (job?.status === "cancelled" || node?.status === "cancelled") {
    return "cancelled";
  }
  if (job?.status === "failed" || job?.status === "expired" || node?.status === "failed") {
    return "failed";
  }
  if (job?.status === "queued" || job?.status === "scheduled" || job?.status === "running" || node?.status === "running" || node?.status === "ready" || node?.status === "pending") {
    return "running";
  }
  return fallback;
}

function isPromptStepFinal(status: ComputerSessionPromptStepStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "skipped";
}

function readRecordId(value: unknown): string | undefined {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string"
    ? (value as Record<string, unknown>).id as string
    : undefined;
}

function readUnknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isScreenTileCache(value: unknown): value is ScreenTileCache {
  const record = readUnknownRecord(value);
  return Array.isArray(record.tileHashes) && typeof record.capturedAt === "string";
}
