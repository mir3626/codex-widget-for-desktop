import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type {
  AutonomyCapabilityGap,
  AutonomyCapabilityInventoryItem,
  AutonomyDebugBundle,
  AutonomyGeneratedToolManifest,
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
  forceFirstSmokeFailure?: boolean;
};

export type ScopedAutonomyDagResult = {
  run: AutonomyRunSummary;
  plan: ScopedAutonomyPlanResult;
  spec?: AutonomyGeneratedToolSpec;
  toolRuns: AutonomyToolRunSummary[];
  debugBundle: AutonomyDebugBundle;
};

type DagNodeMap = Record<string, string>;

type ToolCommandMode = AutonomyToolRunSummary["mode"];

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
    const matchedCapability = matchCapabilityForOperations({
      inventory,
      capability: "unknown",
      operations: decomposition.operations
    });
    const matchedCapabilities = matchedCapability ? [matchedCapability] : [];
    const availableCapabilities = input.availableCapabilities ?? inventory
      .filter((item) => item.status === "generated" || (item.status === "available" && item.capability !== "terminal_generated_tool"))
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

  async execute(input: {
    autonomyRunId: string;
    toolSpecId: string;
    request: {
      title?: string;
      urls?: string[];
      sourceDocuments?: Array<{ title?: string; url?: string; text: string }>;
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
      outputDir,
      pdfRenderer
    });
    await this.completeDagNode(run, nodeMap.dependency_prepare, {
      pdfRenderer,
      outputDir,
      commandGrants: this.readProfile(run)?.grants.commands.allowPrefixes ?? []
    });
    await this.completeDagNode(run, nodeMap.smoke_test, {
      toolSpecId: spec.id,
      alreadyPassed: true,
      status: spec.status
    });
    await this.completeDagNode(run, nodeMap.task_plan, {
      stages: AUTONOMY_EXECUTION_STAGES,
      artifactContract: spec.manifest?.artifactContract ?? []
    });

    for (const stage of AUTONOMY_EXECUTION_STAGES) {
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
        finalStage: AUTONOMY_EXECUTION_STAGES[AUTONOMY_EXECUTION_STAGES.length - 1]
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
          stageCount: AUTONOMY_EXECUTION_STAGES.length,
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
    const matched = compareStableOutput(original.output, rerun.output);
    const manifest = updateManifestStability(spec.manifest, {
      rating: matched && rerun.status === "completed" ? "high" : "low",
      lastRerunStatus: rerun.status !== "completed" ? "failed" : matched ? "matched" : "changed",
      rerunCount: (spec.manifest?.stability.rerunCount ?? 0) + 1
    });
    this.storage.upsertAutonomyToolSpec({
      ...spec,
      manifest,
      stabilityRating: manifest?.stability.rating ?? spec.stabilityRating
    });
    return rerun;
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
        output: { permission },
        completedAt: new Date().toISOString(),
        lastError: permission.reason
      });
      this.recordEvalStep(input.run, {
        kind: evalKindForToolMode(input.mode),
        phase: "blocked",
        status: "blocked",
        input: { command: toolCommand, payload: sanitizeAutonomyInput(input.input) },
        output: { permission },
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
    try {
      const result = await runNodeTool({
        entrypoint,
        request: {
          command: toolCommand,
          input: input.input,
          allowedDomains: profile?.grants.networkDomains ?? [],
          allowedCommandPrefixes: profile?.grants.commands.allowPrefixes ?? [],
          deniedCommandPatterns: profile?.grants.commands.denyPatterns ?? [],
          maxOutputBytes: profile?.grants.maxOutputBytes ?? 2 * 1024 * 1024
        },
        timeoutMs: profile?.grants.maxRuntimeMs ?? 30_000,
        maxOutputBytes: profile?.grants.maxOutputBytes ?? 2 * 1024 * 1024
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
        output: { permission, toolRun: redactToolRun(completed) },
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
    this.storage.updateAutonomyPermissionProfile({
      id: profile.id,
      usedCount: profile.usedCount + 1,
      status: profile.maxUses && profile.usedCount + 1 >= profile.maxUses ? "expired" : profile.status
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

const AUTONOMY_EXECUTION_STAGES = [
  "crawl_or_observe",
  "extract",
  "verify_sources",
  "draft_markdown",
  "render_pdf",
  "store_artifact",
  "verify_artifact"
] as const;

function createToolSpecForGap(gap: AutonomyCapabilityGap): AutonomyGeneratedToolSpec {
  const now = new Date().toISOString();
  if (gap.requestedCapability === "web_research_to_pdf") {
    return {
      id: gap.suggestedToolId ?? "tool-web-research-to-pdf",
      name: "Web Research To PDF",
      capability: "web_research_to_pdf",
      version: "0.2.0",
      status: "proposed",
      templateId: "web_research_to_pdf.v2",
      entrypointKind: "node_script",
      description: "Fetch allowed sources, extract evidence, draft Markdown, render PDF, and verify artifacts through staged DAG commands.",
      requiredGrants: gap.requiredGrants,
      smokeTests: [
        {
          id: "fixture-report-pdf",
          description: "Create markdown, citations, and PDF artifacts from deterministic fixture content.",
          expectedArtifacts: ["report.md", "report.pdf", "citations.json"]
        }
      ],
      artifacts: [],
      createdAt: now,
      updatedAt: now
    };
  }
  if (gap.requestedCapability === "terminal_generated_tool") {
    return {
      id: gap.suggestedToolId ?? `tool-terminal-generated-${randomUUID().slice(0, 8)}`,
      name: "Terminal Generated Tool",
      capability: "terminal_generated_tool",
      version: "0.1.0",
      status: "proposed",
      templateId: "terminal_generated_tool.v1",
      entrypointKind: "node_script",
      description: "Execute a narrowly allowed local command without shell expansion and capture stdout/stderr artifacts.",
      requiredGrants: gap.requiredGrants,
      smokeTests: [
        {
          id: "terminal-wrapper-smoke",
          description: "Write deterministic stdout artifacts without running an external command.",
          expectedArtifacts: ["stdout.json", "stdout.txt"]
        }
      ],
      artifacts: [],
      createdAt: now,
      updatedAt: now
    };
  }
  if (gap.requestedCapability === "browser_download_verify") {
    return {
      id: gap.suggestedToolId ?? `tool-browser-download-verify-${randomUUID().slice(0, 8)}`,
      name: "Browser Download Verify",
      capability: "browser_download_verify",
      version: "0.1.0",
      status: "proposed",
      templateId: "browser_download_verify.v1",
      entrypointKind: "node_script",
      description: "Verify a downloaded file exists, meets size constraints, and optionally matches a SHA-256 digest.",
      requiredGrants: gap.requiredGrants,
      smokeTests: [
        {
          id: "download-verify-smoke",
          description: "Verify a deterministic fixture download file in the generated workspace.",
          expectedArtifacts: ["download-verification.json"]
        }
      ],
      artifacts: [],
      createdAt: now,
      updatedAt: now
    };
  }
  return {
    id: gap.suggestedToolId ?? `tool-${gap.requestedCapability}`,
    name: String(gap.requestedCapability),
    capability: String(gap.requestedCapability),
    version: "0.1.0",
    status: "blocked",
    templateId: "unsupported",
    entrypointKind: "internal_template",
    description: "No reviewed built-in or ad hoc generator exists for this capability gap yet.",
    requiredGrants: gap.requiredGrants,
    smokeTests: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now
  };
}

function materializeSpec(
  runtimeRoot: string,
  spec: AutonomyGeneratedToolSpec,
  input: { iteration: number; forceSmokeFailure?: boolean }
): AutonomyGeneratedToolSpec {
  if (isUnsupportedSpec(spec)) {
    return { ...spec, status: "blocked" };
  }
  const toolDir = join(runtimeRoot, "tools", spec.id);
  mkdirSync(toolDir, { recursive: true });
  const entrypoint = join(toolDir, entrypointNameForSpec(spec));
  const source = sourceForSpec(spec, input.forceSmokeFailure);
  writeFileSync(entrypoint, source, "utf8");
  const sourceHash = sha256Bytes(readFileSync(entrypoint));
  const manifest = createManifest(spec, entrypoint, sourceHash, input.iteration);
  const manifestPath = join(toolDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const artifacts: AutonomyGeneratedToolSpec["artifacts"] = [
    {
      role: "entrypoint",
      path: entrypoint,
      mime: "text/javascript",
      size: statSync(entrypoint).size,
      sha256: sourceHash
    },
    {
      role: "manifest",
      path: manifestPath,
      mime: "application/json",
      size: statSync(manifestPath).size,
      sha256: sha256Bytes(readFileSync(manifestPath))
    }
  ];
  return {
    ...spec,
    status: "materialized",
    manifest,
    sourceHash,
    stabilityRating: manifest.stability.rating,
    artifacts,
    updatedAt: new Date().toISOString()
  };
}

function createAutonomyDagNodes(
  storage: StorageService,
  dagRunId: string,
  requirements: AutonomyPermissionRequirement[],
  permissionAllowed: boolean
): DagNodeMap {
  const definitions: Array<{ key: string; kind: CapabilityDagNodeKind; dependsOn: string[] }> = [
    { key: "permission_check", kind: "permission_check", dependsOn: [] },
    { key: "capability_gap", kind: "capability_gap", dependsOn: ["permission_check"] },
    { key: "implement_capability", kind: "implement_capability", dependsOn: ["capability_gap"] },
    { key: "dependency_prepare", kind: "dependency_prepare", dependsOn: ["implement_capability"] },
    { key: "smoke_test", kind: "smoke_test", dependsOn: ["dependency_prepare"] },
    { key: "task_plan", kind: "task_plan", dependsOn: ["smoke_test"] },
    { key: "crawl_or_observe", kind: "crawl_or_observe", dependsOn: ["task_plan"] },
    { key: "extract", kind: "extract", dependsOn: ["crawl_or_observe"] },
    { key: "verify_sources", kind: "verify_sources", dependsOn: ["extract"] },
    { key: "draft_markdown", kind: "draft_markdown", dependsOn: ["verify_sources"] },
    { key: "render_pdf", kind: "render_pdf", dependsOn: ["draft_markdown"] },
    { key: "store_artifact", kind: "store_artifact", dependsOn: ["render_pdf"] },
    { key: "verify_artifact", kind: "verify_artifact", dependsOn: ["store_artifact"] },
    { key: "cleanup_or_rollback", kind: "cleanup_or_rollback", dependsOn: ["verify_artifact"] },
    { key: "eval_ledger_record", kind: "eval_ledger", dependsOn: ["cleanup_or_rollback"] }
  ];
  const map: DagNodeMap = {};
  for (const definition of definitions) {
    map[definition.key] = `${dagRunId}:${definition.key}`;
  }
  for (const definition of definitions) {
    storage.upsertCapabilityDagNode({
      id: map[definition.key],
      dagRunId,
      kind: definition.kind,
      status: definition.key === "permission_check" ? "ready" : permissionAllowed ? "pending" : "skipped",
      dependsOn: definition.dependsOn.map((key) => map[key]).filter(Boolean),
      requestedBy: "prompt",
      priority: "interactive",
      input: { requirements, permissionAllowed }
    });
  }
  return map;
}

function createSmokeInput(spec: AutonomyGeneratedToolSpec, outputDir: string): Record<string, unknown> {
  if (spec.capability === "browser_download_verify") {
    const fixturePath = join(outputDir, "fixture-download.txt");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(fixturePath, "download verification fixture\n", "utf8");
    return { outputDir, filePath: fixturePath, minBytes: 8 };
  }
  if (spec.capability === "terminal_generated_tool") {
    return { outputDir, message: "terminal generated tool smoke" };
  }
  return {
    title: "Scoped autonomy smoke report",
    outputDir,
    sourceDocuments: [
      {
        title: "Fixture",
        url: "https://example.com/scoped-autonomy-fixture",
        text: "Codex can generate bounded tools only after permission and smoke checks."
      }
    ],
    urls: [],
    pdfRenderer: "builtin"
  };
}

function requirementsFromRequest(input: unknown): AutonomyPermissionRequirement[] {
  const record = asRecord(input);
  const requirements: AutonomyPermissionRequirement[] = [];
  const urls = Array.isArray(record.urls) ? record.urls.filter((value): value is string => typeof value === "string") : [];
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      requirements.push({ type: "network_domain", value: parsed.hostname, reason: "Generated tool execution fetches this URL." });
    } catch {
      // Malformed URLs are ignored here; the generated tool reports source-level failures.
    }
  }
  if (typeof record.command === "string") {
    requirements.push(...requiredGrantsForCommand(record.command));
  }
  if (record.pdfRenderer === "pandoc") {
    requirements.push(...requiredGrantsForCommand("pandoc"));
  }
  if (typeof record.filePath === "string") {
    requirements.push({ type: "filesystem_read", value: record.filePath, reason: "Generated verifier reads this local artifact." });
  }
  return requirements;
}

function readEntrypointPath(spec: AutonomyGeneratedToolSpec): string | undefined {
  return spec.artifacts.find((artifact) => artifact.role === "entrypoint")?.path;
}

function uniqueRequirements(requirements: AutonomyPermissionRequirement[]): AutonomyPermissionRequirement[] {
  const seen = new Set<string>();
  const output: AutonomyPermissionRequirement[] = [];
  for (const requirement of requirements) {
    const key = `${requirement.type}:${requirement.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(requirement);
  }
  return output;
}

function isExecutableSpec(spec: AutonomyGeneratedToolSpec): boolean {
  return spec.status === "active" || spec.status === "smoke_passed";
}

function isUnsupportedSpec(spec: AutonomyGeneratedToolSpec): boolean {
  return spec.templateId === "unsupported" || spec.entrypointKind === "internal_template";
}

function canImplementGap(gap: AutonomyCapabilityGap): boolean {
  return gap.requestedCapability === "web_research_to_pdf"
    || gap.requestedCapability === "terminal_generated_tool"
    || gap.requestedCapability === "browser_download_verify";
}

function isExternalOrUnsupportedGap(gap: AutonomyCapabilityGap): boolean {
  if (canImplementGap(gap)) {
    return false;
  }
  return gap.blockerClassification === "unsupported_template"
    || gap.blockerClassification === "external_contract"
    || gap.blockerClassification === "safety_boundary";
}

function evalKindForToolMode(mode: ToolCommandMode): string {
  if (mode === "smoke") {
    return "toolsmith_smoke";
  }
  if (mode === "rerun") {
    return "toolsmith_rerun";
  }
  if (mode === "rollback") {
    return "toolsmith_rollback";
  }
  if (mode === "dependency_prepare") {
    return "toolsmith_dependency_prepare";
  }
  return "toolsmith_execute";
}

function readDagNodeMap(run: AutonomyRunSummary): DagNodeMap {
  const output = asRecord(run.output);
  const map = asRecord(output.dagNodeMap);
  const result: DagNodeMap = {};
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

function mergeManifestIteration(
  manifest: AutonomyGeneratedToolManifest | undefined,
  iteration: number
): AutonomyGeneratedToolManifest | undefined {
  if (!manifest) {
    return undefined;
  }
  return {
    ...manifest,
    provenance: {
      ...manifest.provenance,
      iterations: iteration
    }
  };
}

function updateManifestStability(
  manifest: AutonomyGeneratedToolManifest | undefined,
  update: Partial<AutonomyGeneratedToolManifest["stability"]>
): AutonomyGeneratedToolManifest | undefined {
  if (!manifest) {
    return undefined;
  }
  return {
    ...manifest,
    stability: {
      ...manifest.stability,
      ...update
    }
  };
}

function summarizeManifest(manifest: AutonomyGeneratedToolManifest | undefined): Record<string, unknown> {
  if (!manifest) {
    return {};
  }
  return {
    toolId: manifest.toolId,
    capability: manifest.capability,
    entrypoint: redactPath(manifest.entrypoint),
    commandAllowlist: manifest.commandAllowlist,
    dependencies: manifest.dependencies,
    sourceHashes: manifest.provenance.sourceHashes,
    iterations: manifest.provenance.iterations,
    stability: manifest.stability
  };
}

function createManifest(
  spec: AutonomyGeneratedToolSpec,
  entrypoint: string,
  sourceHash: string,
  iteration: number
): AutonomyGeneratedToolManifest {
  const commandAllowlist = spec.capability === "terminal_generated_tool" ? ["node", "python", "powershell"] : ["node"];
  const artifactContract = spec.capability === "browser_download_verify"
    ? [{ role: "download_verification", mime: "application/json", required: true }]
    : spec.capability === "terminal_generated_tool"
      ? [
        { role: "stdout", mime: "text/plain", required: true },
        { role: "stdout_json", mime: "application/json", required: true }
      ]
      : [
        { role: "report", mime: "text/markdown", required: true },
        { role: "pdf", mime: "application/pdf", required: true },
        { role: "citation", mime: "application/json", required: true }
      ];
  return {
    schemaVersion: "autonomy-tool-manifest.v1",
    toolId: spec.id,
    capability: spec.capability,
    entrypoint,
    commandAllowlist,
    dependencies: [
      { name: "node", source: "system", installed: true },
      ...(spec.capability === "web_research_to_pdf"
        ? [{ name: "pandoc", source: "system" as const, installed: false }]
        : [])
    ],
    smokeCommands: ["smoke"],
    artifactContract,
    rollback: [
      { type: "delete_path", target: dirname(entrypoint) },
      { type: "deactivate_tool", target: spec.id }
    ],
    provenance: {
      generatedBy: spec.templateId.includes("terminal") ? "ad_hoc_generator" : "reviewed_template",
      templateId: spec.templateId,
      sourceHashes: { [basename(entrypoint)]: sourceHash },
      iterations: iteration,
      generatedAt: new Date().toISOString()
    },
    stability: {
      rating: "unknown",
      rerunCount: 0,
      externalDependencyWarnings: spec.capability === "web_research_to_pdf"
        ? ["Live web fetches can vary by network, redirects, and upstream page changes."]
        : []
    }
  };
}

function sourceForSpec(spec: AutonomyGeneratedToolSpec, forceSmokeFailure?: boolean): string {
  if (forceSmokeFailure) {
    return FAILING_SMOKE_TOOL;
  }
  if (spec.capability === "terminal_generated_tool") {
    return TERMINAL_GENERATED_TOOL;
  }
  if (spec.capability === "browser_download_verify") {
    return BROWSER_DOWNLOAD_VERIFY_TOOL;
  }
  return WEB_RESEARCH_TO_PDF_TOOL;
}

function entrypointNameForSpec(spec: AutonomyGeneratedToolSpec): string {
  if (spec.capability === "terminal_generated_tool") {
    return "terminal-generated-tool.mjs";
  }
  if (spec.capability === "browser_download_verify") {
    return "browser-download-verify.mjs";
  }
  return "web-research-to-pdf.mjs";
}

function inferDefaultUrls(goal: string): string[] {
  if (/openai|codex/i.test(goal)) {
    return [
      "https://openai.com/codex/",
      "https://platform.openai.com/docs/codex"
    ];
  }
  return [];
}

function rollbackTargetsForTool(tool: AutonomyGeneratedToolSpec): string[] {
  const targets = new Set<string>();
  for (const artifact of tool.artifacts) {
    if (artifact.role === "entrypoint" || artifact.role === "manifest" || artifact.role === "source") {
      targets.add(dirname(artifact.path));
    }
  }
  for (const action of tool.manifest?.rollback ?? []) {
    if (action.type === "delete_path" || action.type === "delete_artifact") {
      targets.add(action.target);
    }
  }
  return [...targets];
}

function redactToolSpec(spec: AutonomyGeneratedToolSpec): AutonomyGeneratedToolSpec {
  return {
    ...spec,
    artifacts: spec.artifacts.map((artifact) => ({
      ...artifact,
      path: redactPath(artifact.path)
    })),
    manifest: spec.manifest
      ? {
        ...spec.manifest,
        entrypoint: redactPath(spec.manifest.entrypoint),
        rollback: spec.manifest.rollback.map((action) => ({ ...action, target: redactPath(action.target) }))
      }
      : undefined
  };
}

function redactToolRun(run: AutonomyToolRunSummary): AutonomyToolRunSummary {
  return {
    ...run,
    input: redactPaths(run.input),
    output: redactPaths(run.output)
  };
}

function redactPaths(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactPaths);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "path" || key.endsWith("Path") || key.endsWith("Dir")) && typeof nested === "string") {
      output[key] = redactPath(nested);
    } else {
      output[key] = redactPaths(nested);
    }
  }
  return output;
}

function redactPath(path: string): string {
  if (!path) {
    return path;
  }
  return `<redacted>/${basename(path)}`;
}

function compareStableOutput(left: unknown, right: unknown): boolean {
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  return JSON.stringify(stableFingerprint(leftRecord)) === JSON.stringify(stableFingerprint(rightRecord));
}

function stableFingerprint(value: Record<string, unknown>): Record<string, unknown> {
  const artifacts = Array.isArray(value.artifacts)
    ? value.artifacts.map((artifact) => {
      const record = asRecord(artifact);
      return {
        role: record.role,
        mime: record.mime,
        size: record.size,
        sha256: record.sha256
      };
    })
    : [];
  return {
    ok: value.ok,
    stage: value.stage,
    sourceCount: value.sourceCount,
    verified: value.verified,
    artifacts
  };
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "autonomy-run";
}

async function runNodeTool(input: {
  entrypoint: string;
  request: unknown;
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<{ ok: boolean; output: unknown; error?: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [input.entrypoint], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, output: {}, error: "generated_tool_timeout" });
    }, input.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes < input.maxOutputBytes) {
        const remaining = input.maxOutputBytes - stdoutBytes;
        stdout.push(chunk.subarray(0, remaining));
        stdoutBytes += Math.min(chunk.length, remaining);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < 128 * 1024) {
        const remaining = 128 * 1024 - stderrBytes;
        stderr.push(chunk.subarray(0, remaining));
        stderrBytes += Math.min(chunk.length, remaining);
      }
    });
    child.on("error", (error) => finish({ ok: false, output: {}, error: error.message }));
    child.on("close", (code) => {
      const text = Buffer.concat(stdout).toString("utf8");
      const errorText = Buffer.concat(stderr).toString("utf8");
      try {
        const output = JSON.parse(text || "{}");
        finish({
          ok: code === 0 && asRecord(output).ok !== false,
          output,
          error: code === 0 ? undefined : errorText || `generated_tool_exit_${code}`
        });
      } catch (error) {
        finish({
          ok: false,
          output: { stdout: text },
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    child.stdin.end(JSON.stringify(input.request));

    function finish(result: { ok: boolean; output: unknown; error?: string }) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolvePromise(result);
    }
  });
}

const FAILING_SMOKE_TOOL = String.raw`
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ ok: false, error: "intentional_first_smoke_failure" }));
  process.exitCode = 1;
});
`;

const WEB_RESEARCH_TO_PDF_TOOL = String.raw`
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", async () => {
  try {
    const request = JSON.parse(stdin || "{}");
    const command = typeof request.command === "string" ? request.command : "execute";
    const input = request.input && typeof request.input === "object" ? request.input : {};
    const allowedDomains = Array.isArray(request.allowedDomains) ? request.allowedDomains.filter((value) => typeof value === "string") : [];
    const allowedCommandPrefixes = Array.isArray(request.allowedCommandPrefixes) ? request.allowedCommandPrefixes.filter((value) => typeof value === "string") : [];
    const outputDir = readOutputDir(input);
    mkdirSync(outputDir, { recursive: true });
    if (command === "smoke") {
      await runAll({ ...input, outputDir, pdfRenderer: "builtin" }, allowedDomains, allowedCommandPrefixes);
      return;
    }
    if (command === "execute") {
      await runAll(input, allowedDomains, allowedCommandPrefixes);
      return;
    }
    if (command === "crawl_or_observe") {
      writeJson(await crawlOrObserve(input, allowedDomains));
      return;
    }
    if (command === "extract") {
      writeJson(await extract(input));
      return;
    }
    if (command === "verify_sources") {
      writeJson(await verifySources(input));
      return;
    }
    if (command === "draft_markdown") {
      writeJson(await draftMarkdown(input));
      return;
    }
    if (command === "render_pdf") {
      writeJson(await renderPdfStage(input, allowedCommandPrefixes));
      return;
    }
    if (command === "store_artifact") {
      writeJson(await storeArtifact(input));
      return;
    }
    if (command === "verify_artifact") {
      writeJson(await verifyArtifact(input));
      return;
    }
    throw new Error("unknown_command:" + command);
  } catch (error) {
    writeJson({ ok: false, error: readError(error) });
    process.exitCode = 1;
  }
});

async function runAll(input, allowedDomains, allowedCommandPrefixes) {
  const crawl = await crawlOrObserve(input, allowedDomains);
  if (!crawl.ok) return writeJson(crawl);
  const extracted = await extract(input);
  if (!extracted.ok) return writeJson(extracted);
  const verified = await verifySources(input);
  if (!verified.ok) return writeJson(verified);
  const markdown = await draftMarkdown(input);
  if (!markdown.ok) return writeJson(markdown);
  const pdf = await renderPdfStage(input, allowedCommandPrefixes);
  if (!pdf.ok) return writeJson(pdf);
  const stored = await storeArtifact(input);
  if (!stored.ok) return writeJson(stored);
  const artifact = await verifyArtifact(input);
  writeJson({
    ...artifact,
    sourceCount: crawl.sourceCount,
    artifacts: stored.artifacts,
    warnings: [...(crawl.warnings || []), ...(pdf.warnings || [])],
    evidence: {
      urlsFetched: crawl.urlsFetched,
      citationsPath: join(readOutputDir(input), "citations.json"),
      markdownPath: join(readOutputDir(input), "report.md"),
      pdfPath: join(readOutputDir(input), "report.pdf")
    }
  });
}

async function crawlOrObserve(input, allowedDomains) {
  const outputDir = readOutputDir(input);
  const sourcesPath = join(outputDir, "sources.json");
  const docs = [];
  const warnings = [];
  const fixtureDocs = Array.isArray(input.sourceDocuments) ? input.sourceDocuments : [];
  for (let index = 0; index < fixtureDocs.length; index += 1) {
    const doc = fixtureDocs[index];
    if (doc && typeof doc === "object" && typeof doc.text === "string") {
      docs.push({
        title: typeof doc.title === "string" ? doc.title : "Source " + (index + 1),
        url: typeof doc.url === "string" ? doc.url : "",
        text: doc.text,
        fetched: false,
        status: "fixture"
      });
    }
  }
  const urls = Array.isArray(input.urls) ? input.urls.filter((value) => typeof value === "string") : [];
  for (const url of urls.slice(0, 8)) {
    const host = readHost(url);
    if (!host || !allowedDomains.some((pattern) => matchesDomainGrant(pattern, host))) {
      warnings.push("skipped_ungranted_domain:" + (host || url));
      docs.push({ title: host || url, url, text: "Skipped: domain is not in the permission profile.", fetched: false, status: "blocked_domain" });
      continue;
    }
    try {
      const response = await fetch(url, { redirect: "follow" });
      const html = await response.text();
      if (!response.ok) {
        warnings.push("http_status_" + response.status + ":" + host);
      }
      docs.push({
        title: extractTitle(html) || host,
        url,
        text: stripHtml(html).slice(0, 12000),
        fetched: true,
        httpOk: response.ok,
        status: String(response.status)
      });
    } catch (error) {
      warnings.push("fetch_failed:" + host + ":" + readError(error));
      docs.push({ title: host, url, text: "Fetch failed: " + readError(error), fetched: false, status: "fetch_failed" });
    }
  }
  if (docs.length === 0) {
    docs.push({ title: "No sources", url: "", text: "No source documents or allowed URLs were provided.", fetched: false, status: "empty" });
  }
  writeJsonFile(sourcesPath, docs);
  return {
    ok: true,
    stage: "crawl_or_observe",
    sourceCount: docs.length,
    urlsFetched: docs.filter((doc) => doc.fetched).map((doc) => doc.url),
    warnings,
    artifacts: [{ role: "source", path: sourcesPath, mime: "application/json" }]
  };
}

async function extract(input) {
  const outputDir = readOutputDir(input);
  const sourcesPath = join(outputDir, "sources.json");
  const extractedPath = join(outputDir, "extracted.json");
  const sources = readJsonFile(sourcesPath, []);
  const extracted = sources.map((source, index) => ({
    id: "S" + (index + 1),
    title: source.title || "Source " + (index + 1),
    url: source.url || "",
    fetched: Boolean(source.fetched),
    status: source.status || "unknown",
    text: String(source.text || "").replace(/\s+/g, " ").trim().slice(0, 6000)
  }));
  writeJsonFile(extractedPath, extracted);
  return {
    ok: true,
    stage: "extract",
    sourceCount: extracted.length,
    artifacts: [{ role: "source", path: extractedPath, mime: "application/json" }]
  };
}

async function verifySources(input) {
  const outputDir = readOutputDir(input);
  const extracted = readJsonFile(join(outputDir, "extracted.json"), []);
  const citations = extracted.map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    fetched: source.fetched,
    status: source.status,
    chars: String(source.text || "").length,
    excerpt: String(source.text || "").slice(0, 240)
  }));
  const citationsPath = join(outputDir, "citations.json");
  writeJsonFile(citationsPath, citations);
  const verified = citations.length > 0 && citations.some((source) => source.chars > 10);
  return {
    ok: verified,
    stage: "verify_sources",
    verified,
    sourceCount: citations.length,
    artifacts: [{ role: "citation", path: citationsPath, mime: "application/json" }]
  };
}

async function draftMarkdown(input) {
  const outputDir = readOutputDir(input);
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Scoped autonomy report";
  const extracted = readJsonFile(join(outputDir, "extracted.json"), []);
  const citations = readJsonFile(join(outputDir, "citations.json"), []);
  const lines = ["# " + title, "", "## Summary", ""];
  for (const source of extracted) {
    lines.push("- " + source.title + (source.url ? " (" + source.url + ")" : ""));
  }
  lines.push("", "## Citations", "", "| ID | Title | URL | Status |", "| --- | --- | --- | --- |");
  for (const citation of citations) {
    lines.push("| " + citation.id + " | " + escapeTable(citation.title) + " | " + escapeTable(citation.url || "") + " | " + escapeTable(citation.status || "") + " |");
  }
  lines.push("", "## Source Notes", "");
  for (const source of extracted) {
    lines.push("### " + source.id + " - " + source.title);
    if (source.url) {
      lines.push("", "Source: " + source.url);
    }
    lines.push("", source.text.slice(0, 4000), "");
  }
  const markdownPath = join(outputDir, "report.md");
  writeFileSync(markdownPath, lines.join("\n"), "utf8");
  return {
    ok: true,
    stage: "draft_markdown",
    artifacts: [{ role: "report", path: markdownPath, mime: "text/markdown" }]
  };
}

async function renderPdfStage(input, allowedCommandPrefixes) {
  const outputDir = readOutputDir(input);
  const markdownPath = join(outputDir, "report.md");
  const pdfPath = join(outputDir, "report.pdf");
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Scoped autonomy report";
  const warnings = [];
  if (input.pdfRenderer === "pandoc" && isCommandAllowed("pandoc", allowedCommandPrefixes) && existsSync(markdownPath)) {
    const result = spawnSync("pandoc", [markdownPath, "-o", pdfPath], { encoding: "utf8", shell: false, timeout: 30000 });
    if (result.status === 0 && existsSync(pdfPath)) {
      return {
        ok: true,
        stage: "render_pdf",
        renderer: "pandoc",
        warnings,
        artifacts: [{ role: "pdf", path: pdfPath, mime: "application/pdf" }]
      };
    }
    warnings.push("pandoc_failed_or_missing:" + (result.stderr || result.error?.message || "unknown"));
  }
  const markdown = existsSync(markdownPath) ? readFileSync(markdownPath, "utf8") : title;
  writeFileSync(pdfPath, renderMinimalPdf(title, markdown));
  return {
    ok: true,
    stage: "render_pdf",
    renderer: "builtin",
    warnings,
    artifacts: [{ role: "pdf", path: pdfPath, mime: "application/pdf" }]
  };
}

async function storeArtifact(input) {
  const outputDir = readOutputDir(input);
  const artifactDefs = [
    { role: "report", path: join(outputDir, "report.md"), mime: "text/markdown" },
    { role: "pdf", path: join(outputDir, "report.pdf"), mime: "application/pdf" },
    { role: "citation", path: join(outputDir, "citations.json"), mime: "application/json" }
  ].filter((artifact) => existsSync(artifact.path));
  return {
    ok: artifactDefs.length >= 2,
    stage: "store_artifact",
    artifacts: artifactDefs
  };
}

async function verifyArtifact(input) {
  const outputDir = readOutputDir(input);
  const markdownPath = join(outputDir, "report.md");
  const pdfPath = join(outputDir, "report.pdf");
  const markdownOk = existsSync(markdownPath) && readFileSync(markdownPath).byteLength > 20;
  const pdfOk = existsSync(pdfPath) && readFileSync(pdfPath).subarray(0, 5).toString("ascii") === "%PDF-";
  return {
    ok: markdownOk && pdfOk,
    stage: "verify_artifact",
    verified: markdownOk && pdfOk,
    artifacts: [
      ...(markdownOk ? [{ role: "report", path: markdownPath, mime: "text/markdown" }] : []),
      ...(pdfOk ? [{ role: "pdf", path: pdfPath, mime: "application/pdf" }] : [])
    ]
  };
}

function readOutputDir(input) {
  return typeof input.outputDir === "string" && input.outputDir ? input.outputDir : process.cwd();
}

function renderMinimalPdf(title, markdown) {
  const text = [title, "", markdown].join("\n");
  const safeLines = text
    .replace(/[^\x20-\x7E\n]/g, '?')
    .split("\n")
    .slice(0, 52)
    .map((line) => line.slice(0, 88));
  const content = "BT /F1 10 Tf 50 760 Td " + safeLines.map((line, index) => {
    const escaped = line.replace(/[()\\]/g, "\\$&");
    return (index === 0 ? "" : "T* ") + "(" + escaped + ") Tj";
  }).join(" ") + " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + Buffer.byteLength(content, "ascii") + " >>\nstream\n" + content + "\nendstream"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += (i + 1) + " 0 obj\n" + objects[i] + "\nendobj\n";
  }
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(pdf, "ascii");
}

function matchesDomainGrant(pattern, value) {
  const normalizedPattern = normalizeHost(pattern);
  const normalizedValue = normalizeHost(value);
  if (!normalizedPattern || !normalizedValue) return false;
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedValue === suffix || normalizedValue.endsWith("." + suffix);
  }
  return normalizedPattern === normalizedValue;
}

function normalizeHost(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text.startsWith("*.")) return "*." + normalizeHost(text.slice(2));
  try {
    return new URL(text.includes("://") ? text : "https://" + text).hostname.toLowerCase();
  } catch {
    return text.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  }
}

function readHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function extractTitle(html) {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).trim() : "";
}

function stripHtml(html) {
  return decodeEntities(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeTable(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function isCommandAllowed(command, prefixes) {
  const normalized = String(command || "").trim().toLowerCase();
  return prefixes.some((prefix) => normalized === String(prefix).trim().toLowerCase() || normalized.startsWith(String(prefix).trim().toLowerCase() + " "));
}

function writeJsonFile(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function readJsonFile(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function readError(error) {
  return error && error.message ? error.message : String(error);
}

function writeJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}
`;

const TERMINAL_GENERATED_TOOL = String.raw`
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  try {
    const request = JSON.parse(stdin || "{}");
    const command = typeof request.command === "string" ? request.command : "execute";
    const input = request.input && typeof request.input === "object" ? request.input : {};
    const outputDir = typeof input.outputDir === "string" && input.outputDir ? input.outputDir : process.cwd();
    mkdirSync(outputDir, { recursive: true });
    if (command === "smoke") {
      return writeTerminalOutput(outputDir, { ok: true, stdout: "terminal generated tool smoke\n", stderr: "", exitCode: 0, command: "smoke" });
    }
    if (command !== "execute") {
      return writeJson({ ok: false, error: "unknown_command:" + command });
    }
    if (typeof input.command !== "string" || !input.command.trim()) {
      return writeTerminalOutput(outputDir, { ok: true, stdout: String(input.message || "no command provided") + "\n", stderr: "", exitCode: 0, command: "echo" });
    }
    const allowedPrefixes = Array.isArray(request.allowedCommandPrefixes) ? request.allowedCommandPrefixes : [];
    const deniedPatterns = Array.isArray(request.deniedCommandPatterns) ? request.deniedCommandPatterns : [];
    if (!isAllowed(input.command, allowedPrefixes, deniedPatterns)) {
      return writeJson({ ok: false, error: "command_not_allowed" });
    }
    const parts = splitCommand(input.command);
    const result = spawnSync(parts[0], parts.slice(1), { encoding: "utf8", shell: false, timeout: 30000 });
    return writeTerminalOutput(outputDir, {
      ok: result.status === 0,
      stdout: result.stdout || "",
      stderr: result.stderr || result.error?.message || "",
      exitCode: result.status,
      command: input.command
    });
  } catch (error) {
    writeJson({ ok: false, error: error && error.message ? error.message : String(error) });
    process.exitCode = 1;
  }
});

function writeTerminalOutput(outputDir, payload) {
  const jsonPath = join(outputDir, "stdout.json");
  const textPath = join(outputDir, "stdout.txt");
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(textPath, payload.stdout || "", "utf8");
  writeJson({
    ...payload,
    artifacts: [
      { role: "stdout_json", path: jsonPath, mime: "application/json" },
      { role: "stdout", path: textPath, mime: "text/plain" }
    ]
  });
  if (!payload.ok) {
    process.exitCode = 1;
  }
}

function isAllowed(command, prefixes, deniedPatterns) {
  const normalized = String(command || "").trim().toLowerCase();
  if (!prefixes.some((prefix) => normalized === String(prefix).trim().toLowerCase() || normalized.startsWith(String(prefix).trim().toLowerCase() + " "))) {
    return false;
  }
  return !deniedPatterns.some((pattern) => normalized.includes(String(pattern).toLowerCase()));
}

function splitCommand(command) {
  const matches = String(command).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return matches.map((part) => part.replace(/^"|"$/g, ""));
}

function writeJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}
`;

const BROWSER_DOWNLOAD_VERIFY_TOOL = String.raw`
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  try {
    const request = JSON.parse(stdin || "{}");
    const command = typeof request.command === "string" ? request.command : "execute";
    const input = request.input && typeof request.input === "object" ? request.input : {};
    const outputDir = typeof input.outputDir === "string" && input.outputDir ? input.outputDir : process.cwd();
    mkdirSync(outputDir, { recursive: true });
    if (command === "smoke" && typeof input.filePath !== "string") {
      const fixture = join(outputDir, "fixture-download.txt");
      writeFileSync(fixture, "fixture download\n", "utf8");
      input.filePath = fixture;
      input.minBytes = 4;
    }
    if (command !== "smoke" && command !== "execute" && command !== "verify_artifact") {
      throw new Error("unknown_command:" + command);
    }
    const filePath = typeof input.filePath === "string" ? input.filePath : "";
    const exists = filePath ? existsSync(filePath) : false;
    const bytes = exists ? readFileSync(filePath) : Buffer.alloc(0);
    const size = exists ? statSync(filePath).size : 0;
    const sha256 = exists ? createHash("sha256").update(bytes).digest("hex") : "";
    const minBytes = Number.isFinite(Number(input.minBytes)) ? Number(input.minBytes) : 1;
    const expectedSha256 = typeof input.sha256 === "string" ? input.sha256.toLowerCase() : "";
    const verified = exists && size >= minBytes && (!expectedSha256 || expectedSha256 === sha256);
    const resultPath = join(outputDir, "download-verification.json");
    const result = { ok: verified, stage: "download_verify", exists, size, sha256, expectedSha256, fileName: filePath.split(/[\\/]/).pop() || "" };
    writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
    process.stdout.write(JSON.stringify({
      ...result,
      artifacts: [{ role: "download_verification", path: resultPath, mime: "application/json" }]
    }));
    if (!verified) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) }));
    process.exitCode = 1;
  }
});
`;
