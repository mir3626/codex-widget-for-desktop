import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { WidgetMode } from "../../shared/protocol.js";
import type {
  CapabilityDagNodeSummary,
  CapabilityJobKind,
  CapabilityJobSummary,
  AutonomyPermissionProfile,
  AutonomyPermissionDecision,
  AutonomyPermissionRequirement,
  ComputerSessionCreateInput,
  ComputerSessionDebugBundle,
  ComputerSessionEvent,
  ComputerUseFindElementsQuery,
  ComputerUseSnapshotResult,
  ComputerSessionObservationResourceSummary,
  ComputerSessionObservationSummary,
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
  RiskClass
} from "../../shared/protocol.js";
import { normalizeComputerActionBatch } from "../../shared/protocol.js";
import {
  type BrowserActionResult,
  type BrowserActionPromptPlan,
  type BrowserActionSource
} from "../browser-action/index.js";
import { closePlaywrightBrowserSession } from "../browser-action/adapters/playwright/runtime.js";
import { CapabilityDagRuntime } from "../capability-dag/index.js";
import { auditComputerUseVerifier, finalizeEvalRunFromSteps } from "../computer-use-eval/index.js";
import { recordStructuredFailure } from "../failure-memory/index.js";
import { buildPerceptionGraphFromNativeObservation, buildPerceptionGraphFromOcr, buildPerceptionGraphFromScreenObservation } from "../perception-graph/index.js";
import { ScopedAutonomyRuntime, type ScopedAutonomyDagResult } from "../scoped-autonomy/index.js";
import {
  evaluateAutonomyPermission,
  readAutonomyPermissionModeCapabilities
} from "../scoped-autonomy/permissionProfile.js";
import type { ComputerSessionEffectVerification } from "./effectVerifier.js";
import { ExecutionSurfaceManager } from "./surfaceManager.js";
import {
  createBrowserActionAdapterFallbackPlan,
  mapBrowserActionExecutorResultToDagStatus,
  operationFromCapabilityJob,
  routeComputerOperation
} from "./operationRouting.js";
import {
  sanitizeCapabilityJobForDebugBundle,
  sanitizeRollbackActionForDebugBundle
} from "./sessionDebugBundle.js";
import {
  mapCapabilityKindToObservationKind,
  readDagNodeIdFromCapabilityJob,
  readDagRunIdFromCapabilityJob,
  readNativeHelperSnapshotFromCapabilityOutput,
  readPerceptionGraphIdFromCapabilityOutput,
  readTextFromCapabilityOutput
} from "./observationSummaries.js";
import {
  readPreviousTileHashCount,
  readScreenCascadePayload,
  readScreenDirtyRegionsFromCapabilityOutput,
  readScreenTextBoxesFromCapabilityOutput,
  readScreenTextFromCapabilityOutput,
  readScreenTileHashesFromCapabilityOutput,
  summarizeCapabilityObservation
} from "./screenObservationRuntime.js";
import {
  buildBrowserPermissionBubblePreconditions,
  buildDisabledForegroundWatchExecutorState,
  buildForegroundWatchPreconditions,
  buildFutureVmSessionPreconditions,
  buildNativeFilePickerPreconditions,
  isReadOnlyComputerAction,
  readForegroundWatchBlockReason,
  readForegroundWatchPreflight,
  readForegroundWatchVerifierReason
} from "./foregroundPreconditions.js";
import {
  buildTerminalOutputRootDeltaManifest,
  diffTerminalOutputRootSnapshot,
  emptyTerminalOutputRootDeltaResult,
  isPathWithinAnyRoot,
  readExpectedTerminalArtifacts,
  readTerminalOutputRoots,
  snapshotTerminalOutputRoot
} from "./terminalArtifactDelta.js";
import {
  readBoundedReversibleRegistryMutation,
  readTerminalHardBlockReason,
  readTerminalObservationEvidence,
  type BoundedReversibleRegistryMutation
} from "./terminalSafetyPolicy.js";
import {
  collectToolsmithArtifacts,
  collectToolsmithSourceSummary,
  readToolsmithVerification,
  summarizeToolsmithDagResult
} from "./toolsmithSessionSummary.js";
import {
  readBooleanField,
  readRecordId,
  readStringArrayField,
  readStringField,
  readUnknownRecord
} from "./sessionRecordUtils.js";
import {
  continueBrowserActionPrompt,
  continueBrowserActionPromptByCapabilityJob,
  executeBrowserActionPrompt,
  type ComputerSessionPromptRuntimeHost
} from "./sessionPromptRuntime.js";
import { recordCatchUpRecipeEvidence, summarizeCatchUpRecipeForEval } from "./sessionCatchUpRecipeRuntime.js";
import {
  completeRollbackAction,
  executeRollbackAction,
  recordRollbackAction,
  type ComputerSessionRollbackRuntimeHost
} from "./sessionRollbackRuntime.js";
import { planComputerUseCatchUpRecipe, recipeCreatesLocalArtifact, recipeRequiresBrowserChrome, recipeRequiresBrowserProfile, recipeRequiresForeground, recipeRequiresGeneratedTool, type ComputerUseCatchUpRecipe } from "./promptRecipes.js";
import {
  executeOperation as executeSessionOperation,
  type ComputerSessionOperationRuntimeHost
} from "./sessionOperationRuntime.js";
import {
  recordActionBatch,
  recordBrowserActionResultObservation,
  recordObservation,
  recordVerifierResult,
  type ComputerSessionEvidenceRecorderHost
} from "./sessionEvidenceRecorder.js";
import {
  annotateObservationFreshness,
  createBrowserActionReobserveOperation,
  createSkeletonDagNodes,
  evaluateOperationFreshnessRequirement,
  inferFailureMemorySurface,
  inferModalitiesForSurface,
  inferRiskClass,
  isCapabilityDagNodeFinal,
  isComputerSessionFinal,
  isPromptStepFinal,
  isScreenTileCache,
  mapRiskClassToAutonomyRisk,
  readBrowserActionTypeFromOperation,
  readBrowserFallbackDocuments,
  readSourceDocuments,
  summarizeBrowserActionTargetForRecovery,
  summarizeObservationFreshness,
  summarizeObservationRecord,
} from "./sessionRuntimeHelpers.js";
import type {
  ComputerSessionOperationExecutor,
  ComputerSessionOperationResult,
  ComputerSessionPromptPlanResult,
  ComputerSessionRuntimeOptions,
  RuntimeSessionState,
  TerminalArtifactRollbackTarget,
  TerminalOutputRootDeltaEntry,
  TerminalOutputRootDeltaResult,
  TerminalOutputRootSnapshot
} from "./sessionRuntimeTypes.js";
import { captureComputerUseSnapshot as captureSemanticSnapshot } from "./sessionSemanticSnapshotRuntime.js";
import { buildFutureVmSessionBoundary } from "./vmSandboxAdapter.js";

export type {
  ComputerSessionOperationExecutor,
  ComputerSessionOperationResult,
  ComputerSessionPromptPlanResult,
  ComputerSessionRuntimeOptions
} from "./sessionRuntimeTypes.js";

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
    const catchUpRecipe = planComputerUseCatchUpRecipe(input.userRequest);
    const sessionId = input.sessionId?.trim() || this.options.storage.createSession({
      title: `Computer Use: ${input.userRequest.slice(0, 80)}`
    }).activeSessionId;
    const summary: ComputerSessionSummary = {
      sessionId,
      userRequest: input.userRequest,
      profileId: input.profileId,
      riskClass: input.riskClass ?? catchUpRecipe?.riskClass ?? inferRiskClass(input.userRequest),
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
    const catchUpRecipe = planComputerUseCatchUpRecipe(input.userRequest);
    const surfaceDecision = this.selectSurface(input, catchUpRecipe);
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
          requiredGrants: surfaceDecision.requiredGrants,
          catchUpRecipe: catchUpRecipe ? summarizeCatchUpRecipeForEval(catchUpRecipe) : undefined
        },
        tags: ["computer_session_runtime", surfaceDecision.surface.kind, ...(catchUpRecipe ? [catchUpRecipe.id] : [])],
        safetyBoundaries: [
          "approval_required_for_high_risk_actions",
          "restricted_pages_are_not_bypassed",
          "credentials_are_not_automated",
          "foreground_desktop_requires_watch_mode"
        ]
      },
      metrics: {
        runtime: "computer_session_runtime.v1",
        selectedSurface: surfaceDecision.surface.kind,
        catchUpRecipeId: catchUpRecipe?.id,
        catchUpRecipeStatus: catchUpRecipe?.rolloutStatus,
        catchUpRecipeCommitPolicy: catchUpRecipe?.commitPolicy
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
        selectedSurface: surfaceDecision.surface.kind,
        catchUpRecipeId: catchUpRecipe?.id
      }
    });
    if (catchUpRecipe) {
      recordCatchUpRecipeEvidence({
        storage: this.options.storage,
        requireSession: (sessionId) => this.requireSession(sessionId),
        recordObservation: (sessionId, observation) => this.recordObservation(sessionId, observation)
      }, {
        sessionId: session.sessionId,
        evalRunId: evalRun.id,
        recipe: catchUpRecipe
      });
    }
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
        safetyBoundaries: surfacePermissionDecision.safetyBoundaries,
        credentialPolicy: surfacePermissionDecision.credentialPolicy
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
          usedRequirements: surfacePermissionDecision.usedRequirements,
          credentialPolicy: surfacePermissionDecision.credentialPolicy
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
          usedRequirements: surfacePermissionDecision.usedRequirements,
          credentialPolicy: surfacePermissionDecision.credentialPolicy
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
    if (surfacePermissionDecision.usedRequirements.length > 0) {
      this.consumeOneTimePermissionProfile(state, "surface_permission_profile");
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
    return recordActionBatch(this.createEvidenceRecorderHost(), sessionId, input);
  }

  recordObservation(sessionId: string, observation: ComputerSessionObservationSummary): void {
    recordObservation(this.createEvidenceRecorderHost(), sessionId, observation);
  }

  captureComputerUseSnapshot(input: {
    sessionId?: string;
    fixture?: unknown;
    query?: ComputerUseFindElementsQuery;
    source?: "native_helper_uia" | "native_helper_snapshot" | "fixture" | "unavailable";
  }): ComputerUseSnapshotResult {
    return captureSemanticSnapshot({
      storage: this.options.storage,
      requireSession: (sessionId) => this.requireSession(sessionId),
      recordObservation: (sessionId, observation) => this.recordObservation(sessionId, observation)
    }, input);
  }

  recordBrowserActionResultObservation(input: {
    result: BrowserActionResult;
    capabilityJobId?: string;
    dagNodeId?: string;
  }): ComputerSessionObservationSummary | null {
    return recordBrowserActionResultObservation(this.createEvidenceRecorderHost(), input);
  }

  recordVerifierResult(sessionId: string, result: unknown): void {
    recordVerifierResult(this.createEvidenceRecorderHost(), sessionId, result);
  }

  private createEvidenceRecorderHost(): ComputerSessionEvidenceRecorderHost {
    return {
      storage: this.options.storage,
      hasSession: (sessionId) => this.sessions.has(sessionId),
      requireSession: (sessionId) => this.requireSession(sessionId),
      block: (sessionId, reason) => this.block(sessionId, reason),
      persistSessionState: (state) => this.persistSessionState(state),
      emit: (event) => this.emit(event)
    };
  }
  recordRollbackAction(
    sessionId: string,
    input: Omit<ComputerSessionRollbackActionSummary, "id" | "createdAt">
  ): ComputerSessionRollbackActionSummary {
    return recordRollbackAction(this.createRollbackRuntimeHost(), sessionId, input);
  }

  completeRollbackAction(
    sessionId: string,
    rollbackActionId: string,
    status: ComputerSessionRollbackActionSummary["status"],
    reason?: string
  ): ComputerSessionRollbackActionSummary | null {
    return completeRollbackAction(this.createRollbackRuntimeHost(), sessionId, rollbackActionId, status, reason);
  }

  async executeRollbackAction(input: {
    sessionId: string;
    rollbackActionId: string;
    includeUserArtifacts?: boolean;
    confirmUserArtifacts?: boolean;
  }): Promise<{ session: ComputerSessionSummary; rollbackAction: ComputerSessionRollbackActionSummary; toolRun?: unknown }> {
    return executeRollbackAction(this.createRollbackRuntimeHost(), input);
  }

  private createRollbackRuntimeHost(): ComputerSessionRollbackRuntimeHost {
    return {
      storage: this.options.storage,
      capabilityRuntime: this.options.capabilityRuntime,
      requireSession: (sessionId) => this.requireSession(sessionId),
      persistSessionState: (state) => this.persistSessionState(state)
    };
  }
  async executeOperation(input: {
    sessionId: string;
    operation: ComputerStructuredOperation;
    waitMs?: number;
  }): Promise<ComputerSessionOperationResult> {
    return executeSessionOperation(this.createOperationRuntimeHost(), input);
  }

  private createOperationRuntimeHost(): ComputerSessionOperationRuntimeHost {
    return {
      storage: this.options.storage,
      capabilityRuntime: this.options.capabilityRuntime,
      hasBrowserActionExecutor: Boolean(this.options.executors?.browserAction),
      requireSession: (sessionId) => this.requireSession(sessionId),
      transition: (sessionId, state, patch) => this.transition(sessionId, state, patch),
      block: (sessionId, reason) => this.block(sessionId, reason),
      executeBrowserActionOperation: (sessionId, operation, waitMs) => this.executeBrowserActionOperation(sessionId, operation, waitMs),
      executeToolsmithOperation: (sessionId, operation) => this.executeToolsmithOperation(sessionId, operation),
      executeVisualDesktopWatchOperation: (sessionId, operation) => this.executeVisualDesktopWatchOperation(sessionId, operation),
      executeBrowserPermissionBubbleBoundaryOperation: (sessionId, operation) => this.executeBrowserPermissionBubbleBoundaryOperation(sessionId, operation),
      executeNativeFilePickerBoundaryOperation: (sessionId, operation) => this.executeNativeFilePickerBoundaryOperation(sessionId, operation),
      captureComputerUseSnapshot: (input) => this.captureComputerUseSnapshot(input),
      evaluateTerminalOperationPermission: (sessionId, input) => this.evaluateTerminalOperationPermission(sessionId, input),
      consumeOneTimePermissionProfile: (state, phase) => this.consumeOneTimePermissionProfile(state, phase),
      captureTerminalOutputRootSnapshots: (sessionId, input) => this.captureTerminalOutputRootSnapshots(sessionId, input),
      setTerminalOutputRootSnapshots: (dagNodeId, snapshots) => this.terminalOutputRootSnapshots.set(dagNodeId, snapshots),
      recordCapabilityOperationObservation: (input) => this.recordCapabilityOperationObservation(input),
      recordEffectVerificationStep: (input) => this.recordEffectVerificationStep(input),
      recordVerifierResult: (sessionId, result) => this.recordVerifierResult(sessionId, result),
      recordRecoveryAttempt: (input) => this.recordRecoveryAttempt(input)
    };
  }

  async executeBrowserActionPrompt(input: {
    sessionId: string;
    text: string;
    mode?: WidgetMode;
    source?: Partial<BrowserActionSource>;
  }): Promise<ComputerSessionPromptPlanResult> {
    return executeBrowserActionPrompt(this.createPromptRuntimeHost(), input);
  }

  async continueBrowserActionPrompt(input: {
    sessionId: string;
    promptRunId?: string;
  }): Promise<ComputerSessionPromptPlanResult> {
    return continueBrowserActionPrompt(this.createPromptRuntimeHost(), input);
  }

  async continueBrowserActionPromptByCapabilityJob(capabilityJobId: string): Promise<ComputerSessionPromptPlanResult | null> {
    return continueBrowserActionPromptByCapabilityJob(this.createPromptRuntimeHost(), capabilityJobId);
  }

  private createPromptRuntimeHost(): ComputerSessionPromptRuntimeHost {
    return {
      storage: this.options.storage,
      capabilityRuntime: this.options.capabilityRuntime,
      promptPlans: this.promptPlans,
      sessionEntries: () => this.sessions.entries(),
      requireSession: (sessionId) => this.requireSession(sessionId),
      transition: (sessionId, state, patch) => this.transition(sessionId, state, patch),
      block: (sessionId, reason) => this.block(sessionId, reason),
      executeOperation: (input) => this.executeOperation(input),
      recordVerifierResult: (sessionId, result) => this.recordVerifierResult(sessionId, result),
      persistSessionState: (state) => this.persistSessionState(state),
      emit: (event) => this.emit(event)
    };
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
    const boundary = buildFutureVmSessionBoundary(input.input);
    const reason = boundary.reason;
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
      vmSandboxAdapterBoundary: boundary,
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
      vmSandboxAdapterBoundary: boundary,
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
        vmSandboxAdapterBoundary: boundary,
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
      vmSandboxAdapterBoundary: boundary,
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

  private consumeOneTimePermissionProfile(state: RuntimeSessionState, phase: string): AutonomyPermissionProfile | null {
    const profileId = state.summary.profileId;
    if (!profileId) {
      return null;
    }
    const profile = this.options.storage.readAutonomyPermissionProfile(profileId);
    if (!profile || profile.scope !== "one_time") {
      return null;
    }
    const usedCount = profile.usedCount + 1;
    const maxUses = profile.maxUses ?? 1;
    const updated = this.options.storage.updateAutonomyPermissionProfile({
      id: profile.id,
      usedCount,
      status: usedCount >= maxUses ? "expired" : profile.status
    });
    state.safetyDecisions.push({
      decision: "profile_consumed",
      phase,
      profileId: updated.id,
      profileScope: updated.scope,
      usedCount: updated.usedCount,
      maxUses: updated.maxUses,
      profileStatus: updated.status
    });
    state.summary.updatedAt = new Date().toISOString();
    this.persistSessionState(state);
    return updated;
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
    const profile = state.summary.profileId ? this.options.storage.readAutonomyPermissionProfile(state.summary.profileId) : null;
    const hardBlockReason = readTerminalHardBlockReason(command, {
      allowBoundedReversibleRegistryMutation: Boolean(reversibleRegistryMutation),
      allowCredentialLikeText: readAutonomyPermissionModeCapabilities(profile).credentialCookieCaptchaUnlocked
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

  private selectSurface(input: ComputerSessionCreateInput, catchUpRecipe?: ComputerUseCatchUpRecipe | null): ExecutionSurfaceDecision {
    return this.surfaceManager.select({
      requestedSurface: input.requestedSurface ?? catchUpRecipe?.preferredSurface,
      userRequest: input.userRequest,
      riskClass: input.riskClass ?? catchUpRecipe?.riskClass,
      requiresBrowserProfile: Boolean(input.metadata?.requiresBrowserProfile) || recipeRequiresBrowserProfile(catchUpRecipe ?? null),
      requiresForeground: input.requestedSurface === "foreground_desktop_watch" || Boolean(input.metadata?.requiresForeground) || recipeRequiresForeground(catchUpRecipe ?? null),
      requiresTerminal: input.requestedSurface === "pty_workspace" || Boolean(input.metadata?.requiresTerminal),
      requiresGeneratedTool: input.requestedSurface === "tool_workspace" || Boolean(input.metadata?.requiresGeneratedTool) || recipeRequiresGeneratedTool(catchUpRecipe ?? null),
      requiresBrowserChrome: input.requestedSurface === "regular_browser_extension" || Boolean(input.metadata?.requiresBrowserChrome) || recipeRequiresBrowserChrome(catchUpRecipe ?? null),
      createsLocalArtifact: Boolean(input.metadata?.createsLocalArtifact) || recipeCreatesLocalArtifact(catchUpRecipe ?? null)
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
