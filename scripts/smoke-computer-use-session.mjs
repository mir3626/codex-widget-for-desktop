#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { CapabilityRuntime } from "../dist/daemon/capability-runtime/index.js";
import { ComputerSessionRuntime } from "../dist/daemon/computer-use/index.js";
import { registerDaemonCapabilities } from "../dist/daemon/capabilities/registerCapabilities.js";
import { BrowserChromeCommandBridge } from "../dist/daemon/browser-chrome/index.js";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-computer-session-"));
let storage;
let capabilityRuntime;
let cancelSmokeSignalSeen = false;

try {
  storage = createStorageService({ appDataDir: tempRoot });
  capabilityRuntime = new CapabilityRuntime({ storage, maxActiveJobs: 2 });
  registerDaemonCapabilities({
    capabilityRuntime,
    browserChromeCommands: new BrowserChromeCommandBridge(),
    getDaemonPort: () => 4128
  });
  capabilityRuntime.register("screen_observe", async ({ job, signal }) => {
    const input = job.inputJson && typeof job.inputJson === "object" ? job.inputJson : {};
    if (input.cancelSmoke === true) {
      await waitForAbort(signal, 5000);
      cancelSmokeSignalSeen = signal.aborted;
      return {
        status: signal.aborted ? "cancelled" : "failed",
        output: {
          ok: signal.aborted,
          cancelSmokeSignalSeen: signal.aborted
        },
        summary: signal.aborted ? "screen observe cancel smoke received abort" : "screen observe cancel smoke timed out",
        error: signal.aborted ? "computer_session_cancelled" : "cancel_smoke_timeout"
      };
    }
    const previousTileHashes = Array.isArray(input.previousTileHashes) ? input.previousTileHashes : [];
    const tileHashes = [
      { id: "tile:0:0", x: 0, y: 0, w: 128, h: 128, hash: "before-after-hash" }
    ];
    const unchanged = previousTileHashes.some((tile) => tile.id === "tile:0:0" && tile.hash === "before-after-hash");
    return {
      output: {
        ok: true,
        screenText: "OpenAI docs link visible",
        ocrBoxes: [
          { text: "OpenAI docs link visible", bbox: { x: 12, y: 18, w: 210, h: 28 }, confidence: 0.82 }
        ],
        tileHashes,
        dirtyRegions: unchanged
          ? []
          : [{ id: "roi:tile:0:0", bbox: { x: 0, y: 0, w: 128, h: 128 }, changedPixelsEstimate: 16384 }],
        cascadeStages: unchanged
          ? [
              { name: "cached_graph", status: "hit", confidence: 0.88 },
              { name: "tile_diff", status: "skipped", confidence: 0.4 },
              { name: "roi_ocr", status: "skipped", confidence: 0.55 }
            ]
          : [
              { name: "tile_diff", status: "completed", confidence: 0.8 },
              { name: "roi_ocr", status: "completed", confidence: 0.7 }
            ]
      },
      summary: "screen observe cascade smoke completed"
    };
  });

  const events = [];
  const runtime = new ComputerSessionRuntime({
    storage,
    capabilityRuntime,
    emit: (event) => events.push(event)
  });

  const blockedProfileSurface = await runtime.start({
    userRequest: "현재 브라우저 프로필의 열린 탭을 확인해줘",
    requestedSurface: "regular_browser_extension",
    metadata: { requiresBrowserProfile: true }
  });
  assert.equal(blockedProfileSurface.session.state, "blocked");
  assert.equal(blockedProfileSurface.session.selectedSurface?.kind, "regular_browser_extension");
  assert.equal(blockedProfileSurface.dagRun.status, "failed");
  assert.equal(blockedProfileSurface.evalRun.status, "failed");
  assert.equal(blockedProfileSurface.dagNodes.some((node) =>
    node.kind === "permission_check" &&
    node.status === "failed" &&
    node.output?.missingRequirements?.some((requirement) => requirement.type === "browser_automation")
  ), true);
  const blockedProfileBundle = runtime.exportDebugBundle(blockedProfileSurface.session.sessionId);
  assert.equal(blockedProfileBundle.safetyDecisions.some((decision) =>
    decision?.phase === "surface_permission_profile" &&
    decision.decision === "blocked" &&
    decision.missingRequirements?.some((requirement) => requirement.type === "browser_automation")
  ), true);

  const browserProfileGrant = storage.createAutonomyPermissionProfile({
    name: "Browser profile smoke grant",
    mode: "scoped_yolo",
    scope: "one_time",
    grants: {
      browserAutomation: true,
      riskClasses: ["high_risk"]
    },
    safetyBoundaries: ["browser_profile_access_explicit"]
  });
  const allowedProfileSurface = await runtime.start({
    userRequest: "현재 브라우저 프로필의 열린 탭을 확인해줘",
    requestedSurface: "regular_browser_extension",
    profileId: browserProfileGrant.id,
    metadata: { requiresBrowserProfile: true }
  });
  assert.equal(allowedProfileSurface.session.state, "completed");
  assert.equal(allowedProfileSurface.session.selectedSurface?.kind, "regular_browser_extension");

  const started = await runtime.start({
    userRequest: "OpenAI docs 조사해서 PDF 보고서로 저장해줘",
    profileId: "profile:smoke",
    metadata: { createsLocalArtifact: true }
  });

  assert.equal(started.session.state, "completed");
  assert.equal(started.session.selectedSurface?.kind, "tool_workspace");
  assert.equal(started.evalRun.status, "running", "start result preserves initially created eval run snapshot");
  const storedEval = storage.readComputerUseEvalRun(started.evalRun.id);
  assert.equal(storedEval?.status, "completed");
  assert.equal(storedEval?.taskSuccess, "partial");
  const dag = storage.readCapabilityDagRun(started.dagRun.id);
  assert.equal(dag?.status, "completed");
  const nodes = storage.listCapabilityDagNodes(started.dagRun.id);
  assert.equal(nodes.length, 5);
  assert.equal(nodes.every((node) => node.status === "completed"), true);
  assert.equal(events.some((event) => event.type === "computer.session.created"), true);
  assert.equal(events.some((event) => event.type === "computer.session.completed"), true);

  const readOnlyJob = await capabilityRuntime.enqueue({
    kind: "browser_action",
    sessionId: started.session.sessionId,
    requestedBy: "direct_ui",
    input: {
      action: { type: "read", reason: "session smoke" },
      evalRunId: started.evalRun.id
    }
  });
  await waitForJob(storage, readOnlyJob.id);
  assert.equal(storage.readCapabilityJob(readOnlyJob.id)?.status, "completed");

  const operation = await runtime.executeOperation({
    sessionId: started.session.sessionId,
    operation: {
      kind: "browser_action",
      input: {
        action: { type: "read", reason: "session operation smoke" }
      }
    }
  });
  assert.equal(operation.job?.kind, "browser_action");
  assert.equal(operation.job?.status, "completed");
  assert.equal(operation.dagNode.status, "completed");

  runtime.recordObservation(started.session.sessionId, {
    id: "observation:stale-dom-smoke",
    kind: "browser_dom",
    source: "smoke_stale_evidence",
    surface: started.session.selectedSurface?.kind,
    capturedAt: new Date(Date.now() - 60_000).toISOString(),
    evalRunId: started.evalRun.id,
    summary: "Synthetic stale DOM evidence for freshness gate smoke.",
    freshness: "fresh",
    metadata: { smoke: true },
    redaction: { credentials: "redacted" }
  });
  const freshnessBlocked = await runtime.executeOperation({
    sessionId: started.session.sessionId,
    operation: {
      kind: "browser_action",
      input: {
        action: { type: "read", reason: "freshness preflight smoke" },
        requiresFreshObservation: true,
        maxEvidenceAgeMs: 1000
      }
    }
  });
  assert.equal(freshnessBlocked.job, undefined);
  assert.equal(freshnessBlocked.dagNode.status, "failed");
  assert.equal(freshnessBlocked.dagNode.output.reason, "fresh_observation_required_but_stale");

  const screenOperation = await runtime.executeOperation({
    sessionId: started.session.sessionId,
    operation: {
      kind: "screen_observe",
      input: {
        requiresText: true,
        tileSize: 128
      }
    },
    waitMs: 5000
  });
  assert.equal(screenOperation.job?.kind, "screen_observe");
  assert.equal(screenOperation.job?.status, "completed");

  const cachedScreenOperation = await runtime.executeOperation({
    sessionId: started.session.sessionId,
    operation: {
      kind: "screen_observe",
      input: {
        requiresText: false,
        tileSize: 128
      }
    },
    waitMs: 5000
  });
  assert.equal(cachedScreenOperation.job?.kind, "screen_observe");
  assert.equal(cachedScreenOperation.job?.status, "completed");
  assert.equal(Array.isArray(cachedScreenOperation.job.inputJson.previousTileHashes), true);
  assert.equal(cachedScreenOperation.job.outputJson.dirtyRegions.length, 0);
  assert.equal(cachedScreenOperation.job.outputJson.cascadeStages.some((stage) => stage.name === "roi_ocr" && stage.status === "skipped"), true);

  const crossSourceCapturedAt = new Date().toISOString();
  const crossSourceElement = {
    id: "openai-docs-link",
    role: "link",
    tagName: "a",
    label: "OpenAI docs link visible",
    text: "OpenAI docs link visible",
    selector: "#openai-docs-link",
    bbox: { x: 12, y: 18, w: 210, h: 28 },
    visible: true,
    enabled: true,
    editable: false,
    confidence: 0.94,
    riskHints: []
  };
  runtime.recordBrowserActionResultObservation({
    result: {
      id: "browser-action-result-cross-source-smoke",
      actionSessionId: `computer-session-browser-action:${started.session.sessionId}`,
      adapterId: "smoke",
      action: { type: "click", target: { kind: "element_id", id: crossSourceElement.id } },
      target: crossSourceElement,
      startedAt: crossSourceCapturedAt,
      completedAt: crossSourceCapturedAt,
      status: "succeeded",
      safety: {
        decision: "allow",
        risk: "low",
        reason: "Synthetic cross-source arbitration smoke action.",
        actionLabel: "Click OpenAI docs link visible",
        targetSummary: "OpenAI docs link visible",
        destructive: false
      },
      before: {
        id: "browser-observation-cross-source-before",
        capturedAt: crossSourceCapturedAt,
        source: { kind: "controlled_browser", browser: "chromium", url: "https://example.test/docs" },
        url: "https://example.test/docs",
        title: "Cross-source arbitration smoke",
        readyState: "complete",
        text: "OpenAI docs link visible",
        elements: [crossSourceElement]
      },
      verification: { status: "passed", reason: "Synthetic Browser Action result was recorded." }
    },
  });

  const cancelStarted = await runtime.start({
    userRequest: "화면 관찰 작업을 시작한 뒤 취소해줘",
    metadata: { requiresScreenObserve: true }
  });
  const cancellableOperation = await runtime.executeOperation({
    sessionId: cancelStarted.session.sessionId,
    operation: {
      kind: "screen_observe",
      input: {
        cancelSmoke: true,
        timeoutMs: 10000
      }
    },
    waitMs: 50
  });
  assert.equal(cancellableOperation.job?.kind, "screen_observe");
  assert.equal(["queued", "scheduled", "running", "cancelling"].includes(cancellableOperation.job.status), true);
  const cancelledSession = await runtime.cancel(cancelStarted.session.sessionId, "active_job_cancel_smoke");
  assert.equal(cancelledSession.state, "cancelled");
  const cancelledJob = await waitForJobStatus(storage, cancellableOperation.job.id, "cancelled");
  assert.equal(cancelledJob.status, "cancelled");
  assert.equal(cancelSmokeSignalSeen, true);
  const cancelBundle = runtime.exportDebugBundle(cancelStarted.session.sessionId);
  assert.equal(cancelBundle.session.state, "cancelled");
  assert.equal(cancelBundle.capabilityJobs.some((job) => job.id === cancellableOperation.job?.id && job.status === "cancelled"), true);
  assert.equal(cancelBundle.rollbackActions.some((action) =>
    action.kind === "cancel_capability_job" &&
    action.capabilityJobId === cancellableOperation.job?.id &&
    action.status === "completed"
  ), true);
  assert.equal(cancelBundle.dagRun?.status, "cancelled");

  const blockedBatch = runtime.recordActionBatch(started.session.sessionId, {
    actions: [{ type: "format_disk", x: 0, y: 0 }]
  });
  assert.match(blockedBatch.blockedReason ?? "", /Unknown or unsafe/);
  assert.equal(runtime.read(started.session.sessionId)?.state, "blocked");

  const bundle = runtime.exportDebugBundle(started.session.sessionId);
  assert.equal(bundle.schemaVersion, "computer-session-debug-bundle.v1");
  assert.equal(bundle.session.sessionId, started.session.sessionId);
  assert.equal(bundle.dagNodes.length >= 6, true);
  assert.equal(bundle.capabilityJobs.some((job) => job.kind === "browser_action"), true);
  assert.equal(Array.isArray(bundle.evalResources), true);
  assert.equal(Array.isArray(bundle.perceptionGraphs), true);
  assert.equal(Array.isArray(bundle.rollbackActions), true);
  assert.equal(bundle.observations.some((observation) => observation.kind === "browser_dom" && observation.capabilityJobId === operation.job?.id), true);
  assert.equal(bundle.observations.some((observation) =>
    observation.kind === "screen" &&
    observation.capabilityJobId === screenOperation.job?.id &&
    observation.perceptionGraphId &&
    observation.resourceIds?.some((resource) => resource.role === "roi_cascade_evidence")
  ), true);
  const crossSourceObservation = bundle.observations.find((observation) =>
    observation.kind === "browser_dom" &&
    observation.metadata?.observationPhase === "pre_action" &&
    observation.metadata?.title === "Cross-source arbitration smoke"
  );
  const crossSourceTargetEvidence = crossSourceObservation?.metadata?.targetEvidence;
  assert.equal(crossSourceTargetEvidence?.schemaVersion, "computer-session-target-evidence.v1");
  assert.equal(crossSourceTargetEvidence?.arbitration?.graphSet?.schemaVersion, "computer-session-target-graph-set.v1");
  assert.equal(crossSourceTargetEvidence?.arbitration?.graphSet?.graphCount >= 2, true, JSON.stringify(crossSourceTargetEvidence, null, 2));
  assert.equal(crossSourceTargetEvidence?.arbitration?.graphSet?.sourceBreakdown?.some((source) =>
    source.source === "computer_session_screen_observation" && source.nodeCount >= 1
  ), true, JSON.stringify(crossSourceTargetEvidence, null, 2));
  assert.equal(crossSourceTargetEvidence?.arbitration?.graphSet?.sourceBreakdown?.some((source) =>
    source.source === "computer_session_browser_action_pre_action" && source.actionableNodeCount >= 1
  ), true, JSON.stringify(crossSourceTargetEvidence, null, 2));
  assert.equal(crossSourceTargetEvidence?.arbitration?.candidateSources?.some((source) =>
    source.graphSource === "computer_session_screen_observation" &&
    source.evidenceSources?.includes("ocr")
  ), true, JSON.stringify(crossSourceTargetEvidence, null, 2));
  assert.equal(crossSourceTargetEvidence?.arbitration?.candidateSources?.some((source) =>
    source.graphSource === "computer_session_browser_action_pre_action" &&
    source.evidenceClasses?.includes("dom_selector")
  ), true, JSON.stringify(crossSourceTargetEvidence, null, 2));
  const screenObservation = bundle.observations.find((observation) => observation.kind === "screen" && observation.capabilityJobId === screenOperation.job?.id);
  const screenGraph = bundle.perceptionGraphs.find((graph) => graph.id === screenObservation?.perceptionGraphId);
  assert.equal(screenGraph?.source, "computer_session_screen_observation");
  assert.equal(screenGraph?.nodes.some((node) =>
    node.text === "OpenAI docs link visible" &&
    node.evidence.some((edge) => edge.source === "screenshot" && edge.class === "screenshot_region") &&
    node.evidence.some((edge) => edge.source === "ocr" && edge.class === "visible_text")
  ), true);
  const cachedScreenObservation = bundle.observations.find((observation) => observation.kind === "screen" && observation.capabilityJobId === cachedScreenOperation.job?.id);
  assert.equal(cachedScreenObservation?.metadata?.screenTileCache?.previousTileHashCount, 1);
  assert.equal(cachedScreenObservation?.metadata?.screenTileCache?.dirtyRegionCount, 0);
  assert.equal(bundle.evalResources.some((resource) => resource.role === "roi_cascade_evidence"), true);
  assert.equal(bundle.observations.some((observation) => observation.id === "observation:stale-dom-smoke" && observation.freshness === "stale"), true);
  assert.equal(bundle.freshnessSummary?.staleObservationIds.includes("observation:stale-dom-smoke"), true);
  assert.equal(bundle.safetyDecisions.some((decision) => decision?.phase === "evidence_freshness_check" && decision.reason === "fresh_observation_required_but_stale"), true);
  assert.equal(bundle.redaction.credentials, "redacted");

  const persistedSnapshot = storage.readComputerUseSessionSnapshot(started.session.sessionId);
  assert.equal(persistedSnapshot?.summary.sessionId, started.session.sessionId);
  assert.equal(persistedSnapshot?.summary.state, "blocked");
  assert.equal(persistedSnapshot?.summary.evalRunId, started.evalRun.id);
  assert.equal(persistedSnapshot?.summary.dagRunId, started.dagRun.id);
  assert.equal(persistedSnapshot?.observations.some((observation) => observation.kind === "screen"), true);
  assert.equal(persistedSnapshot?.actionBatches.some((batch) => batch.blockedReason?.includes("Unknown or unsafe")), true);
  assert.equal(persistedSnapshot?.screenTileCache?.tileHashes?.length, 1);
  assert.equal(storage.listComputerUseSessionSnapshots({ limit: 10 }).some((snapshot) => snapshot.summary.sessionId === started.session.sessionId), true);

  const resumedRuntime = new ComputerSessionRuntime({
    storage,
    capabilityRuntime
  });
  assert.equal(resumedRuntime.read(started.session.sessionId)?.state, "blocked");
  const resumedBundle = resumedRuntime.exportDebugBundle(started.session.sessionId);
  assert.equal(resumedBundle.session.sessionId, started.session.sessionId);
  assert.equal(resumedBundle.observations.some((observation) => observation.id === "observation:stale-dom-smoke"), true);
  assert.equal(resumedBundle.actionBatches.some((batch) => batch.blockedReason?.includes("Unknown or unsafe")), true);
  assert.equal(resumedBundle.rollbackActions.length >= bundle.rollbackActions.length, true);

  const interruptedCreatedAt = new Date(Date.now() - 5000).toISOString();
  const interruptedSessionId = storage.createSession({ title: "Interrupted Computer Session restart smoke" }).activeSessionId;
  const interruptedEval = storage.createComputerUseEvalRun({
    sessionId: interruptedSessionId,
    modalities: ["vision"],
    prompt: "Restart reconciliation smoke",
    status: "running",
    scenario: {
      id: "computer-session-restart-reconciliation-smoke",
      title: "Runtime restart reconciles active Computer Session",
      source: "smoke",
      prompt: "Restart reconciliation smoke",
      modalities: ["vision"],
      tags: ["computer_session", "restart_reconciliation"]
    },
    createdAt: interruptedCreatedAt
  });
  const interruptedDag = storage.createCapabilityDagRun({
    sessionId: interruptedSessionId,
    evalRunId: interruptedEval.id,
    goal: "Restart reconciliation smoke",
    status: "running",
    createdAt: interruptedCreatedAt
  });
  const interruptedJob = storage.createCapabilityJob({
    sessionId: interruptedSessionId,
    kind: "screen_observe",
    status: "running",
    requestedBy: "direct_ui",
    inputJson: { restartReconciliationSmoke: true },
    timeoutMs: 10000,
    createdAt: interruptedCreatedAt
  });
  const interruptedNode = storage.upsertCapabilityDagNode({
    dagRunId: interruptedDag.id,
    kind: "action",
    status: "running",
    capabilityKind: "screen_observe",
    capabilityJobId: interruptedJob.id,
    requestedBy: "direct_ui",
    input: { restartReconciliationSmoke: true },
    startedAt: interruptedCreatedAt,
    createdAt: interruptedCreatedAt
  });
  storage.upsertComputerUseSessionSnapshot({
    summary: {
      sessionId: interruptedSessionId,
      userRequest: "Restart reconciliation smoke",
      riskClass: "read_only",
      state: "executing",
      createdAt: interruptedCreatedAt,
      updatedAt: interruptedCreatedAt,
      evalRunId: interruptedEval.id,
      dagRunId: interruptedDag.id,
      latestObservationId: "observation:restart-smoke"
    },
    observations: [{
      id: "observation:restart-smoke",
      kind: "screen",
      source: "smoke",
      capturedAt: interruptedCreatedAt,
      evalRunId: interruptedEval.id,
      dagNodeId: interruptedNode.id,
      capabilityJobId: interruptedJob.id,
      freshness: "fresh",
      summary: "Interrupted screen observation placeholder."
    }],
    safetyDecisions: [{
      decision: "allow",
      phase: "pre_restart_smoke",
      createdAt: interruptedCreatedAt
    }]
  });
  const restartRuntime = new ComputerSessionRuntime({
    storage,
    capabilityRuntime
  });
  const reconciledSession = restartRuntime.read(interruptedSessionId);
  assert.equal(reconciledSession?.state, "cancelled");
  assert.equal(reconciledSession?.blockedReason, "computer_session_runtime_restarted");
  assert.equal(storage.readCapabilityJob(interruptedJob.id)?.status, "cancelled");
  assert.equal(storage.readCapabilityDagRun(interruptedDag.id)?.status, "cancelled");
  assert.equal(storage.readCapabilityDagNode(interruptedNode.id)?.status, "cancelled");
  assert.equal(storage.readComputerUseEvalRun(interruptedEval.id)?.status, "cancelled");
  const restartBundle = restartRuntime.exportDebugBundle(interruptedSessionId);
  assert.equal(restartBundle.safetyDecisions.some((decision) =>
    decision?.phase === "runtime_restart_reconciliation" &&
    decision.previousState === "executing" &&
    decision.reconciledJobIds?.includes(interruptedJob.id)
  ), true);
  assert.equal(restartBundle.rollbackActions.some((action) =>
    action.kind === "cancel_capability_job" &&
    action.capabilityJobId === interruptedJob.id &&
    action.reason === "computer_session_runtime_restarted"
  ), true);
  assert.equal(restartBundle.verifierResults.some((result) =>
    result?.status === "cancelled" &&
    result.reason?.includes("daemon restart")
  ), true);
  assert.equal(storage.listComputerUseEvalSteps(interruptedEval.id).some((step) =>
    step.kind === "runtime_restart_reconciliation" &&
    step.status === "cancelled"
  ), true);

  const fallbackCalls = [];
  const fallbackRuntime = new ComputerSessionRuntime({
    storage,
    capabilityRuntime,
    executors: {
      browserAction: async ({ operation }) => {
        const input = operation.input && typeof operation.input === "object" ? operation.input : {};
        const adapterId = typeof input.adapterId === "string" ? input.adapterId : "auto";
        fallbackCalls.push(adapterId);
        if (adapterId === "cdp") {
          return {
            status: "failed",
            output: {
              ok: false,
              adapterId,
              errorCode: "adapter_target_detached"
            },
            summary: "Synthetic CDP adapter failure for fallback smoke.",
            error: "adapter_target_detached"
          };
        }
        if (adapterId === "extension") {
          return {
            status: "completed",
            output: {
              ok: true,
              adapterId,
              fallbackSmoke: true
            },
            summary: "Synthetic extension adapter fallback completed."
          };
        }
        return {
          status: "failed",
          output: { ok: false, adapterId },
          error: "unexpected_adapter"
        };
      }
    }
  });
  const fallbackGrant = storage.createAutonomyPermissionProfile({
    name: "Browser adapter fallback smoke grant",
    mode: "scoped_yolo",
    scope: "one_time",
    grants: {
      browserAutomation: true,
      riskClasses: ["high_risk"]
    },
    safetyBoundaries: ["browser_profile_access_explicit"]
  });
  const fallbackStarted = await fallbackRuntime.start({
    userRequest: "현재 브라우저 탭에서 버튼을 클릭해줘",
    requestedSurface: "regular_browser_extension",
    profileId: fallbackGrant.id,
    metadata: { requiresBrowserProfile: true }
  });
  const fallbackOperation = await fallbackRuntime.executeOperation({
    sessionId: fallbackStarted.session.sessionId,
    operation: {
      kind: "browser_action",
      input: {
        adapterId: "cdp",
        source: { kind: "active_tab", url: "https://example.test/fallback" },
        action: { type: "click", target: { kind: "selector", selector: "#fallback-button" } }
      }
    }
  });
  assert.deepEqual(fallbackCalls, ["cdp", "extension"]);
  assert.equal(fallbackOperation.dagNode.status, "completed");
  assert.equal(fallbackOperation.dagNode.output?.adapterFallback?.used, true);
  assert.equal(fallbackOperation.dagNode.output?.adapterFallback?.toAdapter, "extension");
  assert.equal(fallbackOperation.dagNode.output?.actionRoute?.executionMode, "extension_injected_dom");
  assert.equal(fallbackOperation.dagNode.output?.routeAttempts?.length, 2);
  const fallbackBundle = fallbackRuntime.exportDebugBundle(fallbackStarted.session.sessionId);
  assert.equal(fallbackBundle.dagNodes.some((node) =>
    node.kind === "fallback" &&
    node.status === "completed" &&
    node.output?.actionRoute?.executionMode === "extension_injected_dom"
  ), true);
  assert.equal(fallbackBundle.safetyDecisions.some((decision) =>
    decision?.phase === "browser_action_adapter_fallback" &&
    decision.toAdapter === "extension"
  ), true);
  assert.equal(fallbackBundle.verifierResults.some((result) =>
    result?.adapterFallback?.used === true &&
    result.reason?.includes("adapter fallback")
  ), true);
  assert.equal(storage.listComputerUseEvalSteps(fallbackStarted.evalRun.id).some((step) =>
    step.kind === "browser_action_adapter_fallback" &&
    step.status === "completed" &&
    step.output?.fallbackStatus === "completed"
  ), true);

  console.log("computer use session smoke ok");
} finally {
  await capabilityRuntime?.shutdown();
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function waitForJob(storage, jobId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = storage.readCapabilityJob(jobId);
    if (job && ["completed", "failed", "cancelled", "expired"].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function waitForJobStatus(storage, jobId, status) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = storage.readCapabilityJob(jobId);
    if (job?.status === status) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach ${status}`);
}

async function waitForAbort(signal, timeoutMs) {
  if (signal.aborted) {
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
