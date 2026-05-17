import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type {
  AutonomyCapabilityGap,
  AutonomyCapabilityInventoryItem,
  AutonomyDebugBundle,
  AutonomyGeneratedToolSpec,
  AutonomyPermissionDecision,
  AutonomyPermissionProfile,
  AutonomyPermissionRequirement,
  AutonomyRequestDecomposition,
  AutonomyRunSummary,
  AutonomyToolRunSummary,
  CapabilityDagNodeKind,
  CapabilityDagNodeStatus,
  ComputerUseFailureClass
} from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";
import {
  listEffectiveAutonomyCapabilities,
  matchCapabilityForOperations,
  registerGeneratedCapability,
  requiredGrantsForCommand,
  seedAutonomyCapabilityInventory
} from "./capabilityInventory.js";
import {
  AUTONOMY_EXECUTION_STAGES,
  createAutonomyDagNodes,
  executionStagesForSpec,
  readDagNodeMap,
  type DagNodeMap
} from "./toolsmithDag.js";
import {
  buildDependencyPolicyReview,
  dependencyPreparationRequirements,
  localNpmDependencyPath,
  prepareDependencyWorkspace
} from "./toolsmithDependencies.js";
import {
  createSmokeInput,
  dependencyWorkspaceForSpec,
  materializeSpec,
  mergeManifestIteration,
  readEntrypointPath,
  rollbackTargetsForTool,
  summarizeManifest,
  updateManifestStability
} from "./toolsmithManifest.js";
import {
  canImplementGap,
  createToolSpecForGap,
  inferDefaultUrls,
  isExecutableSpec,
  isExternalOrUnsupportedGap,
  isUnsupportedSpec,
  requestedCapabilityForDecomposition
} from "./toolsmithPlanning.js";
import {
  requirementsFromRequest,
  uniqueRequirements
} from "./toolsmithPermissions.js";
import {
  redactPath,
  redactPaths,
  redactToolRun,
  redactToolSpec
} from "./toolsmithRedaction.js";
import { compareStableOutput } from "./toolsmithRerun.js";
import { runNodeTool } from "./toolsmithRunner.js";
import {
  asRecord,
  evalKindForToolMode,
  sha256Bytes,
  slugify,
  type ToolCommandMode
} from "./toolsmithShared.js";
import {
  decomposeAutonomyRequest,
  detectAutonomyCapabilityGaps
} from "./gapDetector.js";
import {
  evaluateAutonomyPermission,
  sanitizeAutonomyInput
} from "./permissionProfile.js";

export type ScopedAutonomyRuntimeOptions = {
  runtimeRoot?: string;
};

export type ScopedAutonomyPlanInput = {
  goal: string;
  sessionId?: string;
  permissionProfileId?: string;
  availableCapabilities?: string[];
  outputRoot?: string;
};

export type ScopedAutonomyPlanResult = {
  run: AutonomyRunSummary;
  permission: AutonomyPermissionDecision;
  gaps: AutonomyCapabilityGap[];
  decomposition: AutonomyRequestDecomposition;
  inventory: AutonomyCapabilityInventoryItem[];
  matchedCapabilities: AutonomyCapabilityInventoryItem[];
};

export type ScopedAutonomySelfImplementationResult = {
  spec: AutonomyGeneratedToolSpec;
  smokeRun?: AutonomyToolRunSummary;
  iterations: number;
};

export type ScopedAutonomyDagInput = ScopedAutonomyPlanInput & {
  title?: string;
  urls?: string[];
  sourceDocuments?: Array<{ title?: string; url?: string; text: string }>;
  markdown?: string;
  markdownPath?: string;
  sourcePath?: string;
  browserFallbackDocuments?: Array<{
    title?: string;
    url: string;
    text?: string;
    capture?: Record<string, unknown>;
  }>;
  forceFirstSmokeFailure?: boolean;
};

export type ScopedAutonomyDagResult = {
  run: AutonomyRunSummary;
  plan: ScopedAutonomyPlanResult;
  spec?: AutonomyGeneratedToolSpec;
  toolRuns: AutonomyToolRunSummary[];
  debugBundle: AutonomyDebugBundle;
};

export class ScopedAutonomyRuntime {
  private readonly runtimeRoot: string;

  constructor(
    private readonly storage: StorageService,
    options: ScopedAutonomyRuntimeOptions = {}
  ) {
    this.runtimeRoot = resolve(options.runtimeRoot ?? join(storage.paths.appDataDir, ".runtime", "autonomy"));
  }

  plan(input: ScopedAutonomyPlanInput): ScopedAutonomyPlanResult {
    seedAutonomyCapabilityInventory(this.storage);
    const profile = input.permissionProfileId
      ? this.storage.readAutonomyPermissionProfile(input.permissionProfileId)
      : this.storage.listAutonomyPermissionProfiles({ status: "active", limit: 1 })[0] ?? null;
    const decomposition = decomposeAutonomyRequest(input.goal);
    const inventory = listEffectiveAutonomyCapabilities(this.storage);
    const requestedCapability = requestedCapabilityForDecomposition(decomposition);
    const matchedCapability = matchCapabilityForOperations({
      inventory,
      capability: requestedCapability,
      operations: decomposition.operations
    });
    const matchedCapabilities = matchedCapability ? [matchedCapability] : [];
    const availableCapabilities = input.availableCapabilities ?? inventory
      .filter((item) => item.status === "generated" || (item.status === "available" && item.capability !== "terminal_generated_tool" && item.capability !== "local_document_conversion"))
      .map((item) => item.capability);
    const evalRun = this.storage.createComputerUseEvalRun({
      scenario: {
        id: `scoped-autonomy:${randomUUID()}`,
        title: "Scoped autonomy self-implementation run",
        modalities: ["browser", "terminal", "cross_app"],
        source: "scoped_autonomy",
        prompt: input.goal,
        safetyBoundaries: [
          "permission_profile_required",
          "generated_tools_must_pass_smoke",
          "credential_access_denied",
          "restricted_pages_are_not_bypassed",
          "generated_code_must_remain_in_runtime_workspace"
        ]
      },
      sessionId: input.sessionId,
      modalities: ["browser", "terminal", "cross_app"],
      prompt: input.goal,
      metrics: {
        scopedAutonomy: true,
        schemaVersion: "autonomy-self-implementation.v1"
      }
    });
    let run = this.storage.createAutonomyRun({
      goal: input.goal,
      sessionId: input.sessionId,
      permissionProfileId: profile?.id,
      evalRunId: evalRun.id,
      status: "planned"
    });
    const rawGaps = detectAutonomyCapabilityGaps({
      goal: input.goal,
      runId: run.id,
      availableCapabilities,
      outputRoot: input.outputRoot
    });
    const gaps = rawGaps.map((gap) => this.storage.recordAutonomyCapabilityGap({
      ...gap,
      id: `${gap.id}-${randomUUID().slice(0, 8)}`,
      runId: run.id
    }));
    const requirements = uniqueRequirements([
      ...matchedCapabilities.flatMap((item) => item.requiredGrants),
      ...gaps.flatMap((gap) => gap.requiredGrants)
    ]);
    const permission = evaluateAutonomyPermission({ profile, requirements });
    const dag = this.storage.createCapabilityDagRun({
      evalRunId: evalRun.id,
      sessionId: input.sessionId,
      goal: input.goal,
      status: "pending",
      metadata: {
        runtime: "scoped_autonomy_self_implementation",
        gapCount: gaps.length,
        permissionAllowed: permission.allowed,
        operations: decomposition.operations
      }
    });
    const nodeMap = createAutonomyDagNodes(this.storage, dag.id, requirements, permission.allowed);
    const blockedByCapability = gaps.some((gap) => isExternalOrUnsupportedGap(gap));
    const status: AutonomyRunSummary["status"] = !permission.allowed || blockedByCapability
      ? "blocked"
      : gaps.length > 0
        ? "implementing"
        : "ready";
    run = this.storage.updateAutonomyRun({
      id: run.id,
      dagRunId: dag.id,
      gapIds: gaps.map((gap) => gap.id),
      status,
      output: {
        permission,
        decomposition,
        matchedCapabilities: matchedCapabilities.map((item) => item.id),
        capabilityInventory: inventory.map((item) => ({
          id: item.id,
          capability: item.capability,
          status: item.status,
          source: item.source
        })),
        gapCount: gaps.length,
        dagNodeIds: Object.values(nodeMap),
        dagNodeMap: nodeMap
      },
      failureClass: !permission.allowed
        ? "approval_denied"
        : blockedByCapability
          ? "external_blocker"
          : "none",
      completedAt: !permission.allowed || blockedByCapability ? new Date().toISOString() : null
    });
    this.recordEvalStep(run, {
      kind: "scoped_autonomy_plan",
      phase: permission.allowed ? "framing_intent" : "blocked",
      status: permission.allowed && !blockedByCapability ? "completed" : "blocked",
      capabilityDagNodeId: nodeMap.capability_gap,
      input: { goal: input.goal, profileId: profile?.id },
      output: { decomposition, matchedCapabilities, gaps, permission },
      failureClass: permission.allowed && !blockedByCapability ? "none" : !permission.allowed ? "approval_denied" : "external_blocker"
    });
    return { run, permission, gaps, decomposition, inventory, matchedCapabilities };
  }

  materializeTool(input: { autonomyRunId: string; gapId: string }): AutonomyGeneratedToolSpec {
    const run = this.requireRun(input.autonomyRunId);
    const gap = this.requireGap(run.id, input.gapId);
    const spec = createToolSpecForGap(gap);
    const permission = this.evaluateToolsmithMaterializationPermission(run, spec);
    if (!permission.allowed || isUnsupportedSpec(spec)) {
      return this.blockToolSpec({
        run,
        spec,
        gap,
        permission,
        reason: !permission.allowed ? permission.reason : "No reviewed or generated template exists for this capability gap."
      });
    }

    const materialized = materializeSpec(this.runtimeRoot, spec, { iteration: 1 });
    const saved = this.storage.upsertAutonomyToolSpec({ ...materialized, status: "materialized" });
    this.storage.updateAutonomyRun({
      id: run.id,
      status: "smoke_testing",
      toolSpecIds: [...new Set([...run.toolSpecIds, saved.id])],
      output: { ...(asRecord(run.output)), materializedToolId: saved.id }
    });
    this.recordEvalStep(run, {
      kind: "toolsmith_materialize",
      phase: "executing",
      status: "completed",
      input: { gap },
      output: { spec: redactToolSpec(saved), permission },
      failureClass: "none"
    });
    return saved;
  }

  async selfImplementTool(input: {
    autonomyRunId: string;
    gapId: string;
    forceFirstSmokeFailure?: boolean;
  }): Promise<ScopedAutonomySelfImplementationResult> {
    let run = this.requireRun(input.autonomyRunId);
    const gap = this.requireGap(run.id, input.gapId);
    let spec = createToolSpecForGap(gap);
    const permission = this.evaluateToolsmithMaterializationPermission(run, spec);
    if (!permission.allowed || isUnsupportedSpec(spec)) {
      const blocked = this.blockToolSpec({
        run,
        spec,
        gap,
        permission,
        reason: !permission.allowed ? permission.reason : "No reviewed or generated template exists for this capability gap."
      });
      return { spec: blocked, iterations: 0 };
    }

    const profile = this.readProfile(run);
    const maxIterations = Math.max(1, Math.min(profile?.grants.maxIterations ?? 3, 5));
    let latestSmoke: AutonomyToolRunSummary | undefined;
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      run = this.requireRun(run.id);
      const materialized = materializeSpec(this.runtimeRoot, spec, {
        iteration,
        forceSmokeFailure: Boolean(input.forceFirstSmokeFailure && iteration === 1)
      });
      spec = this.storage.upsertAutonomyToolSpec({
        ...materialized,
        status: "materialized",
        manifest: mergeManifestIteration(materialized.manifest, iteration)
      });
      this.storage.updateAutonomyRun({
        id: run.id,
        status: "smoke_testing",
        toolSpecIds: [...new Set([...run.toolSpecIds, spec.id])],
        output: {
          ...(asRecord(run.output)),
          selfImplementation: {
            gapId: gap.id,
            toolSpecId: spec.id,
            iteration,
            maxIterations
          }
        }
      });
      this.recordEvalStep(run, {
        kind: "toolsmith_generate_source",
        phase: "implementing",
        status: "completed",
        input: { gap, iteration },
        output: {
          toolSpecId: spec.id,
          sourceHash: spec.sourceHash,
          manifest: summarizeManifest(spec.manifest)
        },
        failureClass: "none"
      });
      latestSmoke = await this.runSmoke({ autonomyRunId: run.id, toolSpecId: spec.id });
      if (latestSmoke.status === "completed") {
        const activeSpec = this.requireSpec(spec.id);
        registerGeneratedCapability(this.storage, activeSpec);
        return { spec: activeSpec, smokeRun: latestSmoke, iterations: iteration };
      }
      const failedSpec = this.requireSpec(spec.id);
      this.storage.upsertAutonomyToolSpec({ ...failedSpec, status: "smoke_failed" });
    }

    run = this.requireRun(run.id);
    const failed = this.storage.upsertAutonomyToolSpec({
      ...this.requireSpec(spec.id),
      status: "smoke_failed",
      stabilityRating: "low"
    });
    this.storage.updateAutonomyRun({
      id: run.id,
      status: "failed",
      output: {
        ...(asRecord(run.output)),
        selfImplementationFailure: {
          toolSpecId: failed.id,
          smokeRunId: latestSmoke?.id,
          lastError: latestSmoke?.lastError
        }
      },
      failureClass: "action_failed",
      completedAt: new Date().toISOString()
    });
    this.recordEvalStep(run, {
      kind: "toolsmith_self_implementation",
      phase: "failed",
      status: "failed",
      output: { toolSpecId: failed.id, smokeRunId: latestSmoke?.id, lastError: latestSmoke?.lastError },
      failureClass: "action_failed"
    });
    return { spec: failed, smokeRun: latestSmoke, iterations: maxIterations };
  }

  async runSmoke(input: { autonomyRunId: string; toolSpecId: string }): Promise<AutonomyToolRunSummary> {
    const run = this.requireRun(input.autonomyRunId);
    const spec = this.requireSpec(input.toolSpecId);
    const smokeInput = createSmokeInput(spec, this.toolOutputDirectory(spec.id, "smoke"));
    const toolRun = await this.executeGeneratedTool({
      run,
      spec,
      mode: "smoke",
      toolCommand: "smoke",
      input: smokeInput,
      additionalRequirements: [
        ...requirementsFromRequest(smokeInput),
        { type: "filesystem_write", value: String(smokeInput.outputDir), reason: "Smoke test writes deterministic report artifacts." }
      ]
    });
    const latestSpec = this.requireSpec(spec.id);
    if (toolRun.status === "completed") {
      const now = new Date().toISOString();
      const activeSpec = this.storage.upsertAutonomyToolSpec({
        ...latestSpec,
        status: "active",
        activatedAt: latestSpec.activatedAt ?? now,
        stabilityRating: latestSpec.stabilityRating === "unknown" ? "medium" : latestSpec.stabilityRating,
        manifest: updateManifestStability(latestSpec.manifest, {
          rating: "medium",
          externalDependencyWarnings: latestSpec.manifest?.stability.externalDependencyWarnings ?? []
        })
      });
      registerGeneratedCapability(this.storage, activeSpec);
      this.storage.updateAutonomyRun({
        id: run.id,
        status: "ready",
        output: { ...(asRecord(run.output)), smokeToolRunId: toolRun.id, activeToolSpecId: activeSpec.id }
      });
    } else {
      this.storage.upsertAutonomyToolSpec({ ...latestSpec, status: "smoke_failed", stabilityRating: "low" });
    }
    return toolRun;
  }

  prepareToolDependencies(input: {
    autonomyRunId: string;
    toolSpecId: string;
    outputDir: string;
    pdfRenderer?: "builtin" | "pandoc";
  }): AutonomyToolRunSummary {
    const run = this.requireRun(input.autonomyRunId);
    const spec = this.requireSpec(input.toolSpecId);
    return this.prepareDependencies({
      run,
      spec,
      outputDir: input.outputDir,
      pdfRenderer: input.pdfRenderer ?? this.choosePdfRenderer(run)
    });
  }

  async execute(input: {
    autonomyRunId: string;
    toolSpecId: string;
    request: {
      title?: string;
      urls?: string[];
      sourceDocuments?: Array<{ title?: string; url?: string; text: string }>;
      markdown?: string;
      markdownPath?: string;
      sourcePath?: string;
      outputDir?: string;
      command?: string;
      filePath?: string;
      pdfRenderer?: "builtin" | "pandoc";
    };
  }): Promise<AutonomyToolRunSummary> {
    const run = this.requireRun(input.autonomyRunId);
    const spec = this.requireSpec(input.toolSpecId);
    if (!isExecutableSpec(spec)) {
      return this.createBlockedToolRun({
        run,
        spec,
        mode: "execute",
        input: input.request,
        reason: "Generated tool has not passed smoke tests."
      });
    }
    const outputDir = input.request.outputDir ?? this.toolOutputDirectory(spec.id, "execute");
    const request = sanitizeAutonomyInput({
      ...input.request,
      title: input.request.title ?? run.goal,
      outputDir
    });
    const requirements = [
      { type: "filesystem_write" as const, value: outputDir, reason: "Generated tool writes user-requested artifacts." },
      ...requirementsFromRequest(request)
    ];
    const toolRun = await this.executeGeneratedTool({
      run,
      spec,
      mode: "execute",
      toolCommand: "execute",
      input: request,
      additionalRequirements: requirements
    });
    if (toolRun.status === "completed") {
      this.completeRunFromExecution(run, toolRun);
      this.consumeOneTimeProfile(this.requireRun(run.id));
    }
    return toolRun;
  }

  async runGoalDag(input: ScopedAutonomyDagInput): Promise<ScopedAutonomyDagResult> {
    const plan = this.plan(input);
    let run = this.requireRun(plan.run.id);
    const nodeMap = readDagNodeMap(run);
    const toolRuns: AutonomyToolRunSummary[] = [];
    await this.completeDagNode(run, nodeMap.permission_check, {
      permission: plan.permission,
      missingRequirements: plan.permission.missingRequirements
    }, plan.permission.allowed ? "completed" : "failed");

    if (!plan.permission.allowed || run.status === "blocked") {
      await this.completeDagNode(run, nodeMap.cleanup_or_rollback, { skipped: true, reason: "run_blocked_before_execution" }, "skipped");
      const completed = this.requireRun(run.id);
      return { run: completed, plan, toolRuns, debugBundle: this.createDebugBundle(completed.id) };
    }

    const implementableGap = plan.gaps.find((gap) => canImplementGap(gap));
    let spec = implementableGap
      ? undefined
      : this.findExecutableSpecForPlan(plan);
    if (implementableGap) {
      await this.completeDagNode(run, nodeMap.capability_gap, { gap: implementableGap, decomposition: plan.decomposition });
      await this.completeDagNode(run, nodeMap.implement_capability, { gapId: implementableGap.id }, "running");
      const selfImplementation = await this.selfImplementTool({
        autonomyRunId: run.id,
        gapId: implementableGap.id,
        forceFirstSmokeFailure: input.forceFirstSmokeFailure
      });
      spec = selfImplementation.spec;
      if (selfImplementation.smokeRun) {
        toolRuns.push(selfImplementation.smokeRun);
      }
      await this.completeDagNode(this.requireRun(run.id), nodeMap.implement_capability, {
        toolSpecId: spec.id,
        iterations: selfImplementation.iterations,
        status: spec.status
      }, isExecutableSpec(spec) ? "completed" : "failed");
      if (!isExecutableSpec(spec)) {
        run = this.failAutonomyRun(run.id, "Generated tool failed smoke tests.", "action_failed");
        await this.completeDagNode(run, nodeMap.cleanup_or_rollback, { reason: "tool_not_executable" }, "completed");
        return { run, plan, spec, toolRuns, debugBundle: this.createDebugBundle(run.id) };
      }
    } else {
      await this.completeDagNode(run, nodeMap.capability_gap, { matchedCapabilities: plan.matchedCapabilities.map((item) => item.id) });
      await this.completeDagNode(run, nodeMap.implement_capability, { skipped: true, reason: "existing_capability_matched" }, "skipped");
    }

    if (!spec) {
      run = this.failAutonomyRun(run.id, "No executable capability was available for the planned request.", "external_blocker");
      await this.completeDagNode(run, nodeMap.cleanup_or_rollback, { reason: "no_executable_capability" }, "completed");
      return { run, plan, toolRuns, debugBundle: this.createDebugBundle(run.id) };
    }

    run = this.requireRun(run.id);
    const outputDir = input.outputRoot
      ? join(input.outputRoot, slugify(run.id))
      : this.toolOutputDirectory(spec.id, "dag-execute");
    const pdfRenderer = this.choosePdfRenderer(run);
    const baseRequest = sanitizeAutonomyInput({
      title: input.title ?? run.goal,
      urls: input.urls ?? inferDefaultUrls(run.goal),
      sourceDocuments: input.sourceDocuments ?? [],
      markdown: input.markdown,
      markdownPath: input.markdownPath,
      sourcePath: input.sourcePath,
      browserFallbackDocuments: input.browserFallbackDocuments ?? [],
      outputDir,
      pdfRenderer
    });
    await this.completeDagNode(run, nodeMap.dependency_prepare, {
      pdfRenderer,
      outputDir,
      commandGrants: this.readProfile(run)?.grants.commands.allowPrefixes ?? []
    }, "running");
    const dependencyRun = this.prepareDependencies({
      run,
      spec,
      outputDir,
      pdfRenderer
    });
    toolRuns.push(dependencyRun);
    await this.completeDagNode(this.requireRun(run.id), nodeMap.dependency_prepare, {
      pdfRenderer,
      outputDir,
      toolRunId: dependencyRun.id,
      output: redactPaths(dependencyRun.output)
    }, dependencyRun.status === "completed" ? "completed" : "failed", dependencyRun.lastError ?? undefined);
    if (dependencyRun.status !== "completed") {
      const failedRun = this.failAutonomyRun(run.id, "Dependency preparation failed for generated tool.", dependencyRun.status === "blocked" ? "approval_denied" : "action_failed");
      await this.completeDagNode(failedRun, nodeMap.cleanup_or_rollback, { reason: "dependency_prepare_failed", toolRunId: dependencyRun.id }, "completed");
      return { run: failedRun, plan, spec, toolRuns, debugBundle: this.createDebugBundle(failedRun.id) };
    }
    await this.completeDagNode(run, nodeMap.smoke_test, {
      toolSpecId: spec.id,
      alreadyPassed: true,
      status: spec.status
    });
    await this.completeDagNode(run, nodeMap.task_plan, {
      stages: executionStagesForSpec(spec),
      artifactContract: spec.manifest?.artifactContract ?? []
    });

    const executionStages = executionStagesForSpec(spec);
    for (const skippedStage of AUTONOMY_EXECUTION_STAGES.filter((stage) => !executionStages.includes(stage))) {
      await this.completeDagNode(this.requireRun(run.id), nodeMap[skippedStage], {
        skipped: true,
        reason: "stage_not_required_for_capability",
        capability: spec.capability
      }, "skipped");
    }

    for (const stage of executionStages) {
      const toolRun = await this.executeStage({
        run: this.requireRun(run.id),
        spec,
        stage,
        request: baseRequest,
        nodeId: nodeMap[stage]
      });
      toolRuns.push(toolRun);
      if (toolRun.status !== "completed") {
        const failedRun = this.failAutonomyRun(run.id, `DAG stage failed: ${stage}`, "action_failed");
        await this.completeDagNode(failedRun, nodeMap.cleanup_or_rollback, { reason: "stage_failed", stage, toolRunId: toolRun.id }, "completed");
        return { run: failedRun, plan, spec, toolRuns, debugBundle: this.createDebugBundle(failedRun.id) };
      }
    }

    run = this.requireRun(run.id);
    await this.completeDagNode(run, nodeMap.cleanup_or_rollback, { cleanupRequired: false, rollbackActions: spec.manifest?.rollback ?? [] }, "skipped");
    await this.completeDagNode(run, nodeMap.eval_ledger_record, {
      evalRunId: run.evalRunId,
      toolRunIds: toolRuns.map((toolRun) => toolRun.id)
    });
    const completed = this.storage.updateAutonomyRun({
      id: run.id,
      status: "completed",
      output: {
        ...(asRecord(run.output)),
        executionToolRunIds: toolRuns.map((toolRun) => toolRun.id),
        outputDir,
        pdfRenderer,
        finalStage: executionStages[executionStages.length - 1]
      },
      failureClass: "none",
      completedAt: new Date().toISOString()
    });
    if (completed.evalRunId) {
      this.storage.updateComputerUseEvalRun({
        id: completed.evalRunId,
        status: "completed",
        taskSuccess: "passed",
        failureClass: "none",
        completedAt: new Date().toISOString(),
        metrics: {
          scopedAutonomyDag: true,
          stageCount: executionStages.length,
          toolRunCount: toolRuns.length
        }
      });
    }
    if (completed.dagRunId) {
      this.storage.updateCapabilityDagRun({
        id: completed.dagRunId,
        status: "completed",
        completedAt: new Date().toISOString()
      });
    }
    this.consumeOneTimeProfile(completed);
    return { run: completed, plan, spec, toolRuns, debugBundle: this.createDebugBundle(completed.id) };
  }

  createDebugBundle(autonomyRunId: string): AutonomyDebugBundle {
    const run = this.requireRun(autonomyRunId);
    const profile = this.readProfile(run) ?? undefined;
    const gaps = this.storage.listAutonomyCapabilityGaps(run.id);
    const tools = run.toolSpecIds
      .map((id) => this.storage.readAutonomyToolSpec(id))
      .filter((tool): tool is AutonomyGeneratedToolSpec => Boolean(tool))
      .map(redactToolSpec);
    const toolRuns = this.storage.listAutonomyToolRuns({ autonomyRunId: run.id }).map(redactToolRun);
    const evalSteps = run.evalRunId ? this.storage.listComputerUseEvalSteps(run.evalRunId) : [];
    const evalResources = run.evalRunId ? this.storage.listComputerUseEvalResources(run.evalRunId) : [];
    return {
      schemaVersion: "autonomy-debug-bundle.v1",
      generatedAt: new Date().toISOString(),
      run: {
        ...run,
        output: redactPaths(run.output)
      },
      profile,
      gaps,
      tools,
      toolRuns,
      eval: run.evalRunId
        ? {
          steps: evalSteps.map((step) => ({ ...step, input: redactPaths(step.input), output: redactPaths(step.output) })),
          resources: evalResources
        }
        : undefined,
      redaction: {
        credentialFieldsRedacted: true,
        rawArtifactPathsRedacted: true
      }
    };
  }

  async rerunToolRun(input: { toolRunId: string }): Promise<AutonomyToolRunSummary> {
    const original = this.storage.readAutonomyToolRun(input.toolRunId);
    if (!original) {
      throw new Error(`Autonomy tool run not found: ${input.toolRunId}`);
    }
    if (!original.autonomyRunId) {
      throw new Error(`Autonomy tool run cannot be rerun without an autonomy run: ${input.toolRunId}`);
    }
    const run = this.requireRun(original.autonomyRunId);
    const spec = this.requireSpec(original.toolSpecId);
    const inputRecord = asRecord(original.input);
    const payload = "payload" in inputRecord ? inputRecord.payload : original.input;
    const command = typeof inputRecord.command === "string" ? inputRecord.command : original.mode;
    const rerun = await this.executeGeneratedTool({
      run,
      spec,
      mode: "rerun",
      toolCommand: command,
      input: payload,
      additionalRequirements: requirementsFromRequest(payload)
    });
    const comparison = compareStableOutput(original.output, rerun.output);
    const rerunWithComparison = this.storage.updateAutonomyToolRun({
      id: rerun.id,
      output: {
        ...asRecord(rerun.output),
        rerunComparison: comparison
      }
    });
    const manifest = updateManifestStability(spec.manifest, {
      rating: comparison.matched && rerun.status === "completed" ? "high" : "low",
      lastRerunStatus: rerun.status !== "completed" ? "failed" : comparison.matched ? "matched" : "changed",
      rerunCount: (spec.manifest?.stability.rerunCount ?? 0) + 1
    });
    this.storage.upsertAutonomyToolSpec({
      ...spec,
      manifest,
      stabilityRating: manifest?.stability.rating ?? spec.stabilityRating
    });
    this.recordEvalStep(run, {
      kind: "toolsmith_rerun_comparison",
      phase: "verifying",
      status: comparison.matched && rerun.status === "completed" ? "completed" : "failed",
      input: { originalToolRunId: original.id, rerunToolRunId: rerun.id },
      output: comparison,
      failureClass: comparison.matched && rerun.status === "completed" ? "none" : "action_failed"
    });
    if (rerun.status === "completed") {
      this.consumeOneTimeProfile(run);
    }
    return rerunWithComparison;
  }

  rollbackRun(input: { autonomyRunId: string; includeUserArtifacts?: boolean }): AutonomyToolRunSummary {
    const run = this.requireRun(input.autonomyRunId);
    const startedAt = new Date().toISOString();
    const deleted: string[] = [];
    const skipped: string[] = [];
    const tools = run.toolSpecIds
      .map((id) => this.storage.readAutonomyToolSpec(id))
      .filter((tool): tool is AutonomyGeneratedToolSpec => Boolean(tool));
    for (const tool of tools) {
      for (const target of rollbackTargetsForTool(tool)) {
        if (!input.includeUserArtifacts && !this.isRuntimePath(target)) {
          skipped.push(target);
          continue;
        }
        try {
          rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
          deleted.push(target);
        } catch {
          skipped.push(target);
        }
      }
      this.storage.upsertAutonomyToolSpec({ ...tool, status: "retired" });
    }
    const completedAt = new Date().toISOString();
    const toolRun = this.storage.createAutonomyToolRun({
      toolSpecId: tools[0]?.id ?? "autonomy-rollback",
      autonomyRunId: run.id,
      evalRunId: run.evalRunId,
      mode: "rollback",
      status: "completed",
      input: { includeUserArtifacts: Boolean(input.includeUserArtifacts) },
      output: { ok: true, deleted: deleted.map(redactPath), skipped: skipped.map(redactPath) },
      startedAt
    });
    const completed = this.storage.updateAutonomyToolRun({
      id: toolRun.id,
      status: "completed",
      completedAt,
      elapsedMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      rollback: { deleted, skipped }
    });
    this.storage.updateAutonomyRun({
      id: run.id,
      output: { ...(asRecord(run.output)), rollbackToolRunId: completed.id, rollback: completed.output }
    });
    this.recordEvalStep(run, {
      kind: "toolsmith_rollback",
      phase: "cleanup",
      status: "completed",
      output: completed.output,
      failureClass: "none"
    });
    return completed;
  }

  private async executeStage(input: {
    run: AutonomyRunSummary;
    spec: AutonomyGeneratedToolSpec;
    stage: typeof AUTONOMY_EXECUTION_STAGES[number];
    request: unknown;
    nodeId?: string;
  }): Promise<AutonomyToolRunSummary> {
    await this.completeDagNode(input.run, input.nodeId, { stage: input.stage }, "running");
    const stageRequirements = [
      ...requirementsFromRequest(input.request),
      ...(input.stage === "render_pdf" && asRecord(input.request).pdfRenderer === "pandoc"
        ? requiredGrantsForCommand("pandoc")
        : [])
    ];
    const toolRun = await this.executeGeneratedTool({
      run: input.run,
      spec: input.spec,
      mode: "execute",
      toolCommand: input.stage,
      input: input.request,
      additionalRequirements: stageRequirements
    });
    await this.completeDagNode(input.run, input.nodeId, {
      stage: input.stage,
      toolRunId: toolRun.id,
      output: redactPaths(toolRun.output)
    }, toolRun.status === "completed" ? "completed" : "failed", toolRun.lastError);
    return toolRun;
  }

  private prepareDependencies(input: {
    run: AutonomyRunSummary;
    spec: AutonomyGeneratedToolSpec;
    outputDir: string;
    pdfRenderer: string;
  }): AutonomyToolRunSummary {
    const profile = this.readProfile(input.run);
    const workspace = join(this.toolDirectory(input.spec.id), "dependencies");
    const requirements = dependencyPreparationRequirements(input.spec, workspace);
    const permission = evaluateAutonomyPermission({ profile, requirements });
    const policyReview = buildDependencyPolicyReview(input.spec.manifest, workspace);
    const startedAt = new Date().toISOString();
    const created = this.storage.createAutonomyToolRun({
      toolSpecId: input.spec.id,
      autonomyRunId: input.run.id,
      evalRunId: input.run.evalRunId,
      mode: "dependency_prepare",
      status: permission.allowed ? "running" : "blocked",
      input: {
        manifest: summarizeManifest(input.spec.manifest),
        workspace: redactPath(workspace),
        outputDir: redactPath(input.outputDir),
        pdfRenderer: input.pdfRenderer
      },
      startedAt: permission.allowed ? startedAt : undefined
    });
    if (!permission.allowed) {
      const blocked = this.storage.updateAutonomyToolRun({
        id: created.id,
        status: "blocked",
        output: { permission: redactPaths(permission), workspace: redactPath(workspace), policyReview },
        completedAt: new Date().toISOString(),
        lastError: permission.reason
      });
      this.recordEvalStep(input.run, {
        kind: "toolsmith_dependency_prepare",
        phase: "blocked",
        status: "blocked",
        input: { toolSpecId: input.spec.id, workspace: redactPath(workspace) },
        output: { permission: redactPaths(permission), policyReview },
        failureClass: "approval_denied"
      });
      return blocked;
    }

    const result = prepareDependencyWorkspace({
      workspace,
      manifest: input.spec.manifest,
      pdfRenderer: input.pdfRenderer,
      policyReview
    });
    const completedAt = new Date().toISOString();
    const completed = this.storage.updateAutonomyToolRun({
      id: created.id,
      status: result.ok ? "completed" : "failed",
      output: redactPaths(result),
      completedAt,
      elapsedMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      lastError: result.ok ? null : String(result.error ?? "dependency_prepare_failed")
    });
    this.recordEvalStep(input.run, {
      kind: "toolsmith_dependency_prepare",
      phase: "verifying",
      status: completed.status === "completed" ? "completed" : "failed",
      input: { toolSpecId: input.spec.id, workspace: redactPath(workspace) },
      output: { permission: redactPaths(permission), dependencyRun: redactToolRun(completed) },
      failureClass: completed.status === "completed" ? "none" : "action_failed"
    });
    return completed;
  }

  private async executeGeneratedTool(input: {
    run: AutonomyRunSummary;
    spec: AutonomyGeneratedToolSpec;
    mode: ToolCommandMode;
    toolCommand?: string;
    input: unknown;
    additionalRequirements?: AutonomyPermissionRequirement[];
  }): Promise<AutonomyToolRunSummary> {
    const profile = this.readProfile(input.run);
    const requirements = uniqueRequirements([
      ...input.spec.requiredGrants,
      ...(input.additionalRequirements ?? [])
    ]);
    const permission = evaluateAutonomyPermission({ profile, requirements });
    const toolCommand = input.toolCommand ?? input.mode;
    const created = this.storage.createAutonomyToolRun({
      toolSpecId: input.spec.id,
      autonomyRunId: input.run.id,
      evalRunId: input.run.evalRunId,
      mode: input.mode,
      status: permission.allowed ? "running" : "blocked",
      input: {
        command: toolCommand,
        payload: sanitizeAutonomyInput(input.input)
      },
      startedAt: permission.allowed ? new Date().toISOString() : undefined
    });
    if (!permission.allowed) {
      const blocked = this.storage.updateAutonomyToolRun({
        id: created.id,
        status: "blocked",
        output: { permission: redactPaths(permission) },
        completedAt: new Date().toISOString(),
        lastError: permission.reason
      });
      this.recordEvalStep(input.run, {
        kind: evalKindForToolMode(input.mode),
        phase: "blocked",
        status: "blocked",
        input: { command: toolCommand, payload: sanitizeAutonomyInput(input.input) },
        output: { permission: redactPaths(permission) },
        failureClass: "approval_denied"
      });
      return blocked;
    }
    const entrypoint = readEntrypointPath(input.spec);
    if (!entrypoint || !existsSync(entrypoint)) {
      return this.failToolRun({
        created,
        run: input.run,
        kind: evalKindForToolMode(input.mode),
        input: { command: toolCommand, payload: input.input },
        error: "Generated tool entrypoint is missing."
      });
    }
    const startedAt = created.startedAt ?? new Date().toISOString();
    const dependencyWorkspace = dependencyWorkspaceForSpec(input.spec, this.toolDirectory(input.spec.id));
    try {
      const result = await runNodeTool({
        entrypoint,
        dependencyWorkspace,
        request: {
          command: toolCommand,
          input: input.input,
          allowedDomains: profile?.grants.networkDomains ?? [],
          allowedBrowserDomains: profile?.grants.browserDomains ?? [],
          allowedCommandPrefixes: profile?.grants.commands.allowPrefixes ?? [],
          deniedCommandPatterns: profile?.grants.commands.denyPatterns ?? [],
          maxOutputBytes: profile?.grants.maxOutputBytes ?? 2 * 1024 * 1024
        },
        timeoutMs: profile?.grants.maxRuntimeMs ?? 30_000,
        maxOutputBytes: profile?.grants.maxOutputBytes ?? 2 * 1024 * 1024,
        fsReadRoots: dependencyWorkspace ? localDependencyReadRoots(input.spec, dependencyWorkspace) : [],
        allowChildProcess: shouldAllowGeneratedToolChildProcess(input.spec, input.input)
      });
      const completedAt = new Date().toISOString();
      const storedOutput = this.storeToolArtifacts(input.run, result.output);
      const completed = this.storage.updateAutonomyToolRun({
        id: created.id,
        status: result.ok ? "completed" : "failed",
        output: storedOutput,
        completedAt,
        elapsedMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        lastError: result.ok ? null : result.error,
        rollback: asRecord(result.output).rollback
      });
      this.recordEvalStep(input.run, {
        kind: evalKindForToolMode(input.mode),
        phase: input.mode === "smoke" ? "verifying" : input.mode === "rerun" ? "verifying" : "executing",
        status: completed.status === "completed" ? "completed" : "failed",
        input: { command: toolCommand, payload: sanitizeAutonomyInput(input.input) },
        output: { permission: redactPaths(permission), toolRun: redactToolRun(completed) },
        failureClass: completed.status === "completed" ? "none" : "action_failed"
      });
      return completed;
    } catch (error) {
      return this.failToolRun({
        created,
        run: input.run,
        kind: evalKindForToolMode(input.mode),
        input: { command: toolCommand, payload: input.input },
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private createBlockedToolRun(input: {
    run: AutonomyRunSummary;
    spec: AutonomyGeneratedToolSpec;
    mode: ToolCommandMode;
    input: unknown;
    reason: string;
  }): AutonomyToolRunSummary {
    const now = new Date().toISOString();
    const toolRun = this.storage.createAutonomyToolRun({
      toolSpecId: input.spec.id,
      autonomyRunId: input.run.id,
      evalRunId: input.run.evalRunId,
      mode: input.mode,
      status: "blocked",
      input: sanitizeAutonomyInput(input.input),
      output: { ok: false, reason: input.reason },
      createdAt: now
    });
    const blocked = this.storage.updateAutonomyToolRun({
      id: toolRun.id,
      status: "blocked",
      completedAt: now,
      lastError: input.reason
    });
    this.recordEvalStep(input.run, {
      kind: evalKindForToolMode(input.mode),
      phase: "blocked",
      status: "blocked",
      input: sanitizeAutonomyInput(input.input),
      output: { reason: input.reason },
      failureClass: "approval_denied"
    });
    return blocked;
  }

  private failToolRun(input: {
    created: AutonomyToolRunSummary;
    run: AutonomyRunSummary;
    kind: string;
    input: unknown;
    error: string;
  }): AutonomyToolRunSummary {
    const completedAt = new Date().toISOString();
    const failed = this.storage.updateAutonomyToolRun({
      id: input.created.id,
      status: "failed",
      output: { ok: false, error: input.error },
      completedAt,
      elapsedMs: input.created.startedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(input.created.startedAt)) : 0,
      lastError: input.error
    });
    this.recordEvalStep(input.run, {
      kind: input.kind,
      phase: "failed",
      status: "failed",
      input: sanitizeAutonomyInput(input.input),
      output: { error: input.error },
      failureClass: "action_failed"
    });
    return failed;
  }

  private blockToolSpec(input: {
    run: AutonomyRunSummary;
    spec: AutonomyGeneratedToolSpec;
    gap: AutonomyCapabilityGap;
    permission: AutonomyPermissionDecision;
    reason: string;
  }): AutonomyGeneratedToolSpec {
    const blocked = this.storage.upsertAutonomyToolSpec({ ...input.spec, status: "blocked" });
    this.storage.updateAutonomyRun({
      id: input.run.id,
      status: "blocked",
      toolSpecIds: [...new Set([...input.run.toolSpecIds, blocked.id])],
      output: {
        ...(asRecord(input.run.output)),
        materializationPermission: input.permission,
        blockedToolSpecId: blocked.id,
        blockedReason: input.reason
      },
      failureClass: input.permission.allowed ? "external_blocker" : "approval_denied",
      completedAt: new Date().toISOString()
    });
    this.recordEvalStep(input.run, {
      kind: "toolsmith_materialize",
      phase: "blocked",
      status: "blocked",
      input: { gap: input.gap },
      output: { spec: redactToolSpec(blocked), permission: input.permission, reason: input.reason },
      failureClass: input.permission.allowed ? "external_blocker" : "approval_denied"
    });
    return blocked;
  }

  private evaluateToolsmithMaterializationPermission(
    run: AutonomyRunSummary,
    spec: AutonomyGeneratedToolSpec
  ): AutonomyPermissionDecision {
    const profile = this.readProfile(run);
    return evaluateAutonomyPermission({
      profile,
      requirements: uniqueRequirements([
        ...spec.requiredGrants,
        { type: "filesystem_write", value: this.toolDirectory(spec.id), reason: "Toolsmith must write generated runtime files." },
        { type: "generated_tool_materialization", value: spec.capability, reason: "Toolsmith must materialize the generated capability." },
        ...(spec.entrypointKind === "node_script"
          ? [{ type: "generated_code" as const, value: spec.capability, reason: "Toolsmith must write executable generated source code." }]
          : [])
      ])
    });
  }

  private storeToolArtifacts(run: AutonomyRunSummary, output: unknown): unknown {
    const record = asRecord(output);
    if (!run.evalRunId) {
      return record;
    }
    const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
    const storedArtifacts = [];
    for (const artifact of artifacts) {
      const artifactRecord = asRecord(artifact);
      const path = typeof artifactRecord.path === "string" ? artifactRecord.path : "";
      if (!path || !existsSync(path)) {
        storedArtifacts.push(artifact);
        continue;
      }
      const bytes = readFileSync(path);
      const blob = this.storage.writeBlob({
        bytes,
        mime: typeof artifactRecord.mime === "string" ? artifactRecord.mime : "application/octet-stream",
        displayName: basename(path)
      });
      const resource = this.storage.createComputerUseEvalResource({
        runId: run.evalRunId,
        blobId: blob.id,
        role: typeof artifactRecord.role === "string" ? `autonomy_${artifactRecord.role}` : "autonomy_artifact",
        retention: "evidence",
        redaction: { mode: "artifact_path_redacted", basename: basename(path) }
      });
      storedArtifacts.push({
        ...artifactRecord,
        path: redactPath(path),
        blobId: blob.id,
        resourceId: resource.id,
        size: bytes.byteLength,
        sha256: sha256Bytes(bytes)
      });
    }
    return { ...record, artifacts: storedArtifacts };
  }

  private recordEvalStep(run: AutonomyRunSummary, input: {
    kind: string;
    phase: string;
    status: string;
    capabilityDagNodeId?: string;
    input?: unknown;
    output?: unknown;
    failureClass?: ComputerUseFailureClass;
  }): void {
    if (!run.evalRunId) {
      return;
    }
    this.storage.appendComputerUseEvalStep({
      runId: run.evalRunId,
      kind: input.kind,
      phase: input.phase,
      status: input.status,
      capabilityDagNodeId: input.capabilityDagNodeId,
      input: input.input,
      output: input.output,
      failureClass: input.failureClass
    });
  }

  private async completeDagNode(
    run: AutonomyRunSummary,
    nodeId: string | undefined,
    output: unknown,
    status: CapabilityDagNodeStatus = "completed",
    lastError?: string
  ): Promise<void> {
    if (!nodeId || !run.dagRunId) {
      return;
    }
    const current = this.storage.readCapabilityDagNode(nodeId);
    const now = new Date().toISOString();
    this.storage.upsertCapabilityDagNode({
      id: nodeId,
      dagRunId: run.dagRunId,
      kind: current?.kind ?? "fallback",
      status,
      dependsOn: current?.dependsOn ?? [],
      input: current?.input,
      output,
      startedAt: current?.startedAt ?? (status === "running" ? now : current?.startedAt),
      completedAt: status === "running" ? null : now,
      elapsedMs: current?.startedAt && status !== "running" ? Math.max(0, Date.parse(now) - Date.parse(current.startedAt)) : current?.elapsedMs,
      lastError: lastError ?? null
    });
  }

  private failAutonomyRun(id: string, reason: string, failureClass: ComputerUseFailureClass): AutonomyRunSummary {
    const run = this.requireRun(id);
    if (run.evalRunId) {
      this.storage.updateComputerUseEvalRun({
        id: run.evalRunId,
        status: "failed",
        taskSuccess: "failed",
        failureClass,
        completedAt: new Date().toISOString()
      });
    }
    if (run.dagRunId) {
      this.storage.updateCapabilityDagRun({
        id: run.dagRunId,
        status: "failed",
        completedAt: new Date().toISOString(),
        metadata: { ...(this.storage.readCapabilityDagRun(run.dagRunId)?.metadata ?? {}), failureReason: reason }
      });
    }
    return this.storage.updateAutonomyRun({
      id,
      status: "failed",
      output: { ...(asRecord(run.output)), failureReason: reason },
      failureClass,
      completedAt: new Date().toISOString()
    });
  }

  private completeRunFromExecution(run: AutonomyRunSummary, toolRun: AutonomyToolRunSummary): void {
    const completedAt = new Date().toISOString();
    this.storage.updateAutonomyRun({
      id: run.id,
      status: "completed",
      output: {
        ...(asRecord(run.output)),
        executionToolRunId: toolRun.id,
        execution: toolRun.output
      },
      failureClass: "none",
      completedAt
    });
    if (run.evalRunId) {
      this.storage.updateComputerUseEvalRun({
        id: run.evalRunId,
        status: "completed",
        taskSuccess: "passed",
        failureClass: "none",
        completedAt
      });
    }
    this.recordEvalStep(run, {
      kind: "scoped_autonomy_verification",
      phase: "verifying",
      status: "completed",
      output: { ok: true, toolRunId: toolRun.id },
      failureClass: "none"
    });
  }

  private consumeOneTimeProfile(run: AutonomyRunSummary): void {
    const profile = this.readProfile(run);
    if (!profile || profile.scope !== "one_time") {
      return;
    }
    const maxUses = profile.maxUses ?? 1;
    const usedCount = profile.usedCount + 1;
    this.storage.updateAutonomyPermissionProfile({
      id: profile.id,
      usedCount,
      status: usedCount >= maxUses ? "expired" : profile.status
    });
  }

  private choosePdfRenderer(run: AutonomyRunSummary): "builtin" | "pandoc" {
    const profile = this.readProfile(run);
    if (!profile) {
      return "builtin";
    }
    return profile.grants.commands.allowPrefixes.some((prefix) => prefix.trim().toLowerCase() === "pandoc") ? "pandoc" : "builtin";
  }

  private findExecutableSpecForPlan(plan: ScopedAutonomyPlanResult): AutonomyGeneratedToolSpec | undefined {
    for (const item of plan.matchedCapabilities) {
      if (!item.toolSpecId) {
        continue;
      }
      const spec = this.storage.readAutonomyToolSpec(item.toolSpecId);
      if (spec && isExecutableSpec(spec)) {
        return spec;
      }
    }
    for (const item of plan.matchedCapabilities) {
      const spec = this.storage.listAutonomyToolSpecs({ capability: item.capability, limit: 5 })
        .find(isExecutableSpec);
      if (spec) {
        return spec;
      }
    }
    const webTool = this.storage.listAutonomyToolSpecs({ capability: "web_research_to_pdf", limit: 5 })
      .find(isExecutableSpec);
    return webTool;
  }

  private isRuntimePath(value: string): boolean {
    const root = resolve(this.runtimeRoot).toLowerCase();
    const target = resolve(value).toLowerCase();
    return target === root || target.startsWith(`${root}\\`) || target.startsWith(`${root}/`);
  }

  private requireRun(id: string): AutonomyRunSummary {
    const run = this.storage.readAutonomyRun(id);
    if (!run) {
      throw new Error(`Scoped autonomy run not found: ${id}`);
    }
    return run;
  }

  private requireGap(runId: string, gapId: string): AutonomyCapabilityGap {
    const gap = this.storage.listAutonomyCapabilityGaps(runId).find((candidate) => candidate.id === gapId);
    if (!gap) {
      throw new Error(`Scoped autonomy gap not found: ${gapId}`);
    }
    return gap;
  }

  private requireSpec(id: string): AutonomyGeneratedToolSpec {
    const spec = this.storage.readAutonomyToolSpec(id);
    if (!spec) {
      throw new Error(`Generated autonomy tool spec not found: ${id}`);
    }
    return spec;
  }

  private readProfile(run: AutonomyRunSummary): AutonomyPermissionProfile | null {
    return run.permissionProfileId ? this.storage.readAutonomyPermissionProfile(run.permissionProfileId) : null;
  }

  private toolDirectory(toolId: string): string {
    return join(this.runtimeRoot, "tools", toolId);
  }

  private toolOutputDirectory(toolId: string, mode: string): string {
    return join(this.runtimeRoot, "outputs", toolId, mode);
  }
}

function shouldAllowGeneratedToolChildProcess(spec: AutonomyGeneratedToolSpec, request: unknown): boolean {
  const payload = asRecord(request);
  return spec.capability === "terminal_generated_tool" || payload.pdfRenderer === "pandoc";
}

function localDependencyReadRoots(spec: AutonomyGeneratedToolSpec, workspace: string): string[] {
  return (spec.manifest?.dependencies ?? [])
    .filter((dependency) => dependency.source === "npm" && dependency.installed !== true)
    .map((dependency) => localNpmDependencyPath(dependency.version, workspace))
    .filter((path): path is string => Boolean(path));
}
