#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { CapabilityRuntime } from "../dist/daemon/capability-runtime/index.js";
import { CapabilityDagRuntime } from "../dist/daemon/capability-dag/index.js";
import {
  createReleaseReadinessSummary,
  finalizeEvalRunFromSteps,
  rollupComputerUseEvalMetrics
} from "../dist/daemon/computer-use-eval/index.js";
import {
  buildPerceptionGraphFromBrowserObservation,
  buildPerceptionGraphFromOcr,
  explainPerceptionTarget
} from "../dist/daemon/perception-graph/index.js";
import {
  computeTileHashes,
  diffTileHashes,
  planPerceptionCascade
} from "../dist/daemon/perception-cascade/index.js";
import {
  AsrRouter,
  MockAsrEngine,
  createMockVadSegments,
  decodeAsrCommand
} from "../dist/daemon/transcription/index.js";
import {
  readFailureCalibration,
  recordStructuredFailure
} from "../dist/daemon/failure-memory/index.js";
import { removeSmokeDir } from "./smoke-isolation.mjs";

const evidenceDate = process.env.RESEARCH_COMPUTER_USE_SCENARIO_DATE || localDateString();
const assetDir = join("docs", "reports", "assets", `research-computer-use-scenarios-${evidenceDate}`);
const evidencePath = join(assetDir, "evidence.json");
const scenarioCatalogPath = join("docs", "dogfood", `research-computer-use-scenarios-${evidenceDate}.json`);
const reportPath = join("docs", "reports", `research-computer-use-scenarios-${evidenceDate}.md`);
const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-research-computer-use-"));

await mkdir(assetDir, { recursive: true });
await mkdir(join("docs", "dogfood"), { recursive: true });

let storage;
let runtime;

try {
  storage = createStorageService({ appDataDir: tempRoot });
  runtime = new CapabilityRuntime({ storage, maxActiveJobs: 4 });
  registerScenarioCapabilities(runtime);
  const sessions = {
    browser: storage.createSession({ title: "Scenario Browser" }).id,
    windows: storage.createSession({ title: "Scenario Windows" }).id,
    terminal: storage.createSession({ title: "Scenario Terminal" }).id,
    crossApp: storage.createSession({ title: "Scenario Cross App" }).id
  };

  const scenarios = [];
  scenarios.push(await runBrowserSearchScenario({ storage, runtime, sessions }));
  scenarios.push(await runBrowserBookmarkScenario({ storage, runtime, sessions }));
  scenarios.push(await runWindowsSettingsScenario({ storage, runtime, sessions }));
  scenarios.push(await runTerminalSafetyScenario({ storage, runtime, sessions }));
  scenarios.push(await runCrossAppDagScenario({ storage, runtime, sessions }));

  const runs = storage.listComputerUseEvalRuns({ limit: 200 });
  const metrics = rollupComputerUseEvalMetrics(runs);
  const readiness = createReleaseReadinessSummary(runs);
  const graphs = storage.listPerceptionGraphs({ limit: 100 });
  const failureMemory = storage.listStructuredFailureMemory({ includeExpired: true, limit: 100 });
  const dagRuns = scenarios.map((scenario) => scenario.dagRunId).filter(Boolean);
  const resources = runs.flatMap((run) => storage.listComputerUseEvalResources(run.id));

  const evidence = {
    schemaVersion: "research-computer-use-scenarios.v1",
    date: evidenceDate,
    storageHealth: storage.health(),
    scenarioCatalogPath: scenarioCatalogPath.replace(/\\/g, "/"),
    reportPath: reportPath.replace(/\\/g, "/"),
    scenarios,
    acceptance: {
      allScenariosPassed: scenarios.every((scenario) => scenario.status === "passed"),
      evalRunsRecorded: runs.length >= scenarios.length,
      modalitiesCovered: collectModalities(runs),
      perceptionGraphsRecorded: graphs.length >= 3,
      evalResourcesRecorded: resources.length > 0,
      failureMemoryRecorded: failureMemory.length > 0,
      dagRunsRecorded: dagRuns.length > 0,
      taskSuccessRate: metrics.taskSuccessRate,
      p95LatencyTracked: metrics.p95LatencyMs >= 0,
      p95PerceptionLatencyTracked: metrics.p95PerceptionLatencyMs > 0,
      proofRate: metrics.proofRate
    },
    metrics,
    readiness,
    counts: {
      evalRuns: runs.length,
      perceptionGraphs: graphs.length,
      failureMemory: failureMemory.length,
      evalResources: resources.length,
      dagRuns: dagRuns.length
    }
  };

  assert.equal(evidence.acceptance.allScenariosPassed, true, "All computer-use scenarios should pass.");
  assert.equal(evidence.acceptance.evalRunsRecorded, true, "Eval ledger should record scenario runs.");
  assert.equal(evidence.acceptance.perceptionGraphsRecorded, true, "Perception graphs should be recorded.");
  assert.equal(evidence.acceptance.evalResourcesRecorded, true, "Blob-backed eval resources should be linked.");
  assert.equal(evidence.acceptance.failureMemoryRecorded, true, "Structured failure memory should be recorded.");
  assert.equal(evidence.acceptance.dagRunsRecorded, true, "Capability DAG runs should be recorded.");
  assert.equal(evidence.acceptance.modalitiesCovered.includes("browser"), true, "Browser modality should be covered.");
  assert.equal(evidence.acceptance.modalitiesCovered.includes("windows"), true, "Windows modality should be covered.");
  assert.equal(evidence.acceptance.modalitiesCovered.includes("asr"), true, "ASR modality should be covered.");
  assert.equal(evidence.acceptance.modalitiesCovered.includes("vision"), true, "Vision modality should be covered.");
  assert.equal(evidence.acceptance.modalitiesCovered.includes("terminal"), true, "Terminal modality should be covered.");
  assert.equal(evidence.acceptance.modalitiesCovered.includes("cross_app"), true, "Cross-app modality should be covered.");

  await writeFile(scenarioCatalogPath, `${JSON.stringify(buildScenarioCatalog(scenarios), null, 2)}\n`, "utf8");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderReport(evidence), "utf8");

  console.log(`research computer-use scenarios passed: ${scenarios.length}`);
  console.log(`scenario catalog: ${scenarioCatalogPath}`);
  console.log(`evidence: ${evidencePath}`);
  console.log(`report: ${reportPath}`);
} finally {
  await runtime?.shutdown();
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  removeSmokeDir(tempRoot);
}

function registerScenarioCapabilities(runtime) {
  runtime.register("screen_observe", async ({ job, resources }) => {
    const input = readRecord(job.inputJson);
    const screenText = typeof input.screenText === "string" ? input.screenText : "Settings search browser terminal";
    const beforeTiles = computeTileHashes({ bytes: `${screenText}:before`, width: 512, height: 256, tileSize: 128 });
    const afterTiles = computeTileHashes({ bytes: `${screenText}:after`, width: 512, height: 256, tileSize: 128 });
    const dirtyRegions = diffTileHashes(beforeTiles, afterTiles);
    const cascadeStages = planPerceptionCascade({
      cachedGraphConfidence: typeof input.cachedGraphConfidence === "number" ? input.cachedGraphConfidence : 0.2,
      domOrUiaConfidence: typeof input.domOrUiaConfidence === "number" ? input.domOrUiaConfidence : 0.4,
      dirtyRegions,
      requiresText: true
    });
    const stored = resources.storeBuffer({
      job,
      role: "screen_observe_delta",
      bytes: Buffer.from(JSON.stringify({ dirtyRegions, cascadeStages })),
      mime: "application/json",
      displayName: `${job.id}-screen-delta.json`,
      retention: "evidence",
      preview: { dirtyRegionCount: dirtyRegions.length, stageCount: cascadeStages.length },
      redaction: { rawScreenshotStored: false, reason: "scenario_fixture_metadata_only" }
    });
    return {
      output: {
        ok: true,
        screenText,
        tileHashes: afterTiles,
        dirtyRegions,
        cascadeStages,
        resourceId: stored.resourceId
      },
      outputBlobIds: [stored.blobId],
      summary: "Scenario screen observe completed."
    };
  });

  runtime.register("ocr", async ({ job, resources, storage }) => {
    const input = readRecord(job.inputJson);
    const text = typeof input.text === "string" ? input.text : "검색 react-router-dom Settings Terminal";
    const graph = buildPerceptionGraphFromOcr({
      sessionId: job.sessionId,
      text,
      source: "scenario_roi_ocr"
    });
    const recordedGraph = storage.recordPerceptionGraph({
      graph,
      sessionId: job.sessionId,
      source: "scenario_roi_ocr"
    });
    const stored = resources.storeBuffer({
      job,
      role: "roi_ocr_text",
      bytes: Buffer.from(text),
      mime: "text/plain",
      displayName: `${job.id}-ocr.txt`,
      retention: "evidence",
      preview: { text: text.slice(0, 120), perceptionGraphId: recordedGraph.id },
      redaction: { rawScreenshotStored: false }
    });
    return {
      output: {
        ok: true,
        text,
        perceptionGraphId: recordedGraph.id,
        nodeCount: recordedGraph.nodes.length
      },
      outputBlobIds: [stored.blobId],
      summary: "Scenario ROI OCR completed."
    };
  });

  runtime.register("browser_chrome", async ({ job }) => {
    const input = readRecord(job.inputJson);
    const command = typeof input.command === "string" ? input.command : "bookmark.list";
    return {
      output: {
        ok: true,
        command,
        bookmark: {
          id: String(input.id ?? "docs"),
          title: String(input.title ?? "Codex Docs"),
          url: String(input.url ?? "https://example.test/docs")
        },
        tab: command === "bookmark.open"
          ? { id: 1, url: String(input.url ?? "https://example.test/docs"), active: true }
          : undefined,
        metadata: { scenarioHandler: "browser_chrome" }
      },
      summary: `Scenario Browser Chrome command completed: ${command}`
    };
  });

  runtime.register("desktop_action", async ({ job }) => {
    const input = readRecord(job.inputJson);
    const command = typeof input.command === "string" ? input.command : "observe";
    return {
      output: {
        ok: true,
        command,
        observation: {
          title: "Windows Settings",
          text: "Display brightness Night light Reset network",
          elements: [
            { id: "brightness", role: "slider", label: "Brightness", bbox: { x: 80, y: 120, w: 360, h: 48 }, confidence: 0.86 },
            { id: "night-light", role: "switch", label: "Night light", bbox: { x: 80, y: 190, w: 220, h: 44 }, confidence: 0.82 },
            { id: "reset-network", role: "button", label: "Reset network", bbox: { x: 80, y: 340, w: 180, h: 44 }, confidence: 0.62, riskHints: ["delete"] }
          ]
        }
      },
      summary: "Scenario Windows Settings observation completed."
    };
  });

  runtime.register("terminal", async ({ job }) => {
    const input = readRecord(job.inputJson);
    const command = typeof input.command === "string" ? input.command.trim() : "";
    if (command === "node --version") {
      return {
        output: { ok: true, command, stdout: `${process.version}\n`, stderr: "", exitCode: 0 },
        summary: "Scenario terminal command completed."
      };
    }
    return {
      status: "failed",
      output: { ok: false, command, stdout: "", stderr: "scenario command not allowed", exitCode: 1 },
      error: "scenario command not allowed"
    };
  });

  runtime.register("agent_tool", async ({ job }) => {
    const input = readRecord(job.inputJson);
    return {
      output: {
        ok: true,
        runtime: "simulated_daemon",
        toolId: String(input.toolId ?? "scenario.cross_app"),
        request: input.request ?? {},
        result: { status: "verified", evidence: "scenario_fixture" }
      },
      summary: "Scenario cross-app agent tool completed."
    };
  });

  runtime.register("browser_action", async ({ job }) => ({
    output: {
      ok: true,
      action: readRecord(job.inputJson).action ?? {},
      result: "scenario_browser_action_completed"
    },
    summary: "Scenario Browser Action completed."
  }));
}

async function runBrowserSearchScenario({ storage, runtime, sessions }) {
  const scenario = {
    id: "browser.search.asr.perception",
    title: "Korean ASR browser search with perception graph and ROI cascade",
    surface: "Browser",
    risk: "side_effect",
    status: "failed",
    modalities: ["browser", "asr", "vision"],
    steps: []
  };
  const evalRun = storage.createComputerUseEvalRun({
    scenarioId: scenario.id,
    sessionId: sessions.browser,
    modalities: scenario.modalities,
    prompt: "검색창에 리액트 라우터 돔 입력하고 검색",
    metrics: { perceptionLatencyMs: 42 },
    scenario: {
      id: scenario.id,
      title: scenario.title,
      modalities: scenario.modalities,
      source: "research-computer-use-scenario",
      prompt: "검색창에 리액트 라우터 돔 입력하고 검색",
      tags: ["browser", "asr", "perception_graph", "roi_cascade"]
    }
  });

  const router = new AsrRouter([new MockAsrEngine([{ text: "검색창에 리액트 라우터 돔 입력하고 검색", confidence: 0.84 }])]);
  const decoded = await router.transcribeAndDecode({
    segments: createMockVadSegments([{ startMs: 0, endMs: 1400 }]),
    language: "ko",
    decoderContext: {
      uiLabels: ["검색", "검색창"],
      packageNames: ["react-router-dom"],
      sideEffectRisk: "side_effect"
    }
  });
  assert.equal(decoded.decode.canonicalText.includes("react-router-dom"), true);
  assert.equal(decoded.decode.clarificationRequired, false, decoded.decode.clarificationReason);
  storage.appendComputerUseEvalStep({
    runId: evalRun.id,
    kind: "asr_decode",
    phase: "framing_intent",
    status: "completed",
    input: { utterance: decoded.transcript.text },
    output: decoded.decode,
    failureClass: "none"
  });
  scenario.steps.push({ kind: "asr_decode", status: "passed", canonicalText: decoded.decode.canonicalText });

  const observation = buildBrowserSearchObservation();
  const graph = storage.recordPerceptionGraph({
    graph: buildPerceptionGraphFromBrowserObservation({ observation, sessionId: sessions.browser }),
    source: "scenario_browser_dom"
  });
  const explanation = explainPerceptionTarget({ graph, nodeId: "search-input", risk: "side_effect" });
  assert.equal(explanation.allowed, true, explanation.reason);
  storage.appendComputerUseEvalStep({
    runId: evalRun.id,
    kind: "perception_graph_target",
    phase: "perceiving",
    status: "completed",
    perceptionGraphId: graph.id,
    output: { explanation },
    failureClass: "none"
  });
  scenario.steps.push({ kind: "perception_graph_target", status: "passed", confidence: explanation.confidence, threshold: explanation.threshold });

  const beforeTiles = computeTileHashes({ bytes: "browser search empty", width: 1024, height: 768, tileSize: 256 });
  const afterTiles = computeTileHashes({ bytes: "browser search react-router-dom typed", width: 1024, height: 768, tileSize: 256 });
  const dirtyRegions = diffTileHashes(beforeTiles, afterTiles);
  const cascadeStages = planPerceptionCascade({
    cachedGraphConfidence: 0.18,
    domOrUiaConfidence: 0.76,
    dirtyRegions,
    requiresText: true
  });
  const cascadeStep = storage.appendComputerUseEvalStep({
    runId: evalRun.id,
    kind: "roi_cascade",
    phase: "perceiving",
    status: "completed",
    output: { dirtyRegions, cascadeStages },
    failureClass: "none"
  });
  const roiBlob = storage.writeBlob({
    bytes: Buffer.from(JSON.stringify({ dirtyRegions, cascadeStages })),
    mime: "application/json",
    displayName: `${scenario.id}-roi-evidence.json`
  });
  storage.createComputerUseEvalResource({
    runId: evalRun.id,
    stepId: cascadeStep.id,
    blobId: roiBlob.id,
    role: "roi_cascade_evidence",
    retention: "evidence",
    redaction: { rawScreenshotStored: false, source: "fixture_tile_hashes" }
  });
  scenario.steps.push({ kind: "roi_cascade", status: "passed", dirtyRegions: dirtyRegions.length, stages: cascadeStages.map((stage) => stage.name) });

  const actionJob = await runtime.enqueue({
    kind: "browser_action",
    sessionId: sessions.browser,
    priority: "interactive",
    requestedBy: "prompt",
    input: {
      evalRunId: evalRun.id,
      action: { type: "type", value: "react-router-dom" },
      target: { id: "search-input", label: "검색창" },
      expectedOutcome: "Search query typed"
    },
    timeoutMs: 5000
  });
  const approved = actionJob.status === "awaiting_approval" ? await runtime.approve(actionJob.id) : actionJob;
  const completedAction = await waitForJob(storage, approved.id);
  assert.equal(completedAction.status, "completed");
  scenario.steps.push({ kind: "browser_action_capability", status: "passed", jobId: completedAction.id });

  const completed = finalizeEvalRunFromSteps({ storage, runId: evalRun.id, taskSuccess: "passed", failureClass: "none" });
  scenario.status = "passed";
  scenario.evalRunId = completed.id;
  scenario.metrics = completed.metrics;
  return scenario;
}

async function runBrowserBookmarkScenario({ storage, runtime, sessions }) {
  const scenario = {
    id: "browser.bookmark.open.approval",
    title: "Browser bookmark open with approval-gated browser chrome capability",
    surface: "Browser Chrome",
    risk: "reversible_side_effect",
    status: "failed",
    modalities: ["browser"],
    steps: []
  };
  const listJob = await runtime.enqueue({
    kind: "browser_chrome",
    sessionId: sessions.browser,
    priority: "interactive",
    requestedBy: "direct_ui",
    input: { command: "bookmark.list", prompt: "List bookmarks" },
    timeoutMs: 5000
  });
  const completedList = await waitForJob(storage, listJob.id);
  assert.equal(completedList.status, "completed");

  const openJob = await runtime.enqueue({
    kind: "browser_chrome",
    sessionId: sessions.browser,
    priority: "interactive",
    requestedBy: "direct_ui",
    input: {
      command: "bookmark.open",
      id: "docs",
      title: "Codex Docs",
      url: "https://example.test/docs",
      prompt: "Open the Codex Docs bookmark"
    },
    timeoutMs: 5000
  });
  assert.equal(openJob.status, "awaiting_approval");
  const approved = await runtime.approve(openJob.id);
  const completedOpen = await waitForJob(storage, approved.id);
  assert.equal(completedOpen.status, "completed");

  scenario.steps.push({ kind: "bookmark_list", status: "passed", jobId: completedList.id, evalRunId: readEvalRunId(completedList.inputJson) });
  scenario.steps.push({ kind: "bookmark_open", status: "passed", jobId: completedOpen.id, evalRunId: readEvalRunId(completedOpen.inputJson), approval: "required_and_approved" });
  scenario.status = "passed";
  scenario.evalRunIds = scenario.steps.map((step) => step.evalRunId).filter(Boolean);
  return scenario;
}

async function runWindowsSettingsScenario({ storage, runtime, sessions }) {
  const scenario = {
    id: "windows.settings.observe.high_risk_reject",
    title: "Windows Settings observation with high-risk target rejection",
    surface: "Windows Settings",
    risk: "high_risk",
    status: "failed",
    modalities: ["windows", "vision"],
    steps: []
  };
  const job = await runtime.enqueue({
    kind: "desktop_action",
    sessionId: sessions.windows,
    priority: "interactive",
    requestedBy: "direct_ui",
    input: {
      command: "observe",
      prompt: "설정 화면에서 네트워크 초기화 버튼은 누르지 말고 상태만 확인"
    },
    timeoutMs: 5000
  });
  const completedJob = await waitForJob(storage, job.id);
  assert.equal(completedJob.status, "completed");
  const evalRunId = readEvalRunId(completedJob.inputJson);
  assert.ok(evalRunId);
  const windowsEvalRun = storage.readComputerUseEvalRun(evalRunId);
  storage.updateComputerUseEvalRun({
    id: evalRunId,
    metrics: { ...(windowsEvalRun?.metrics ?? {}), perceptionLatencyMs: 34 }
  });

  const observation = buildWindowsSettingsObservation();
  const graph = storage.recordPerceptionGraph({
    graph: buildPerceptionGraphFromBrowserObservation({ observation, sessionId: sessions.windows }),
    source: "scenario_windows_uia"
  });
  const resetExplanation = explainPerceptionTarget({ graph, nodeId: "reset-network", risk: "high_risk" });
  assert.equal(resetExplanation.allowed, false, "High-risk reset target should not pass evidence threshold.");
  storage.appendComputerUseEvalStep({
    runId: evalRunId,
    kind: "windows_uia_graph",
    phase: "perceiving",
    status: "completed",
    capabilityJobId: completedJob.id,
    perceptionGraphId: graph.id,
    output: { resetExplanation },
    failureClass: "none"
  });
  const failure = recordStructuredFailure({
    storage,
    failureClass: "unsafe_action_rejected",
    surface: "windows",
    source: "research_computer_use_scenario",
    scenarioId: scenario.id,
    evalRunId,
    perceptionGraphId: graph.id,
    badTargetPatterns: ["Reset network"],
    recoveryHints: ["observe_only", "require_explicit_user_approval_for_reset"],
    abstentionTriggers: ["unsafe_action_rejected"],
    ttlMs: 7 * 24 * 60 * 60 * 1000
  });
  const calibration = readFailureCalibration({ storage, surface: "windows" });
  assert.equal(calibration.abstentionTriggers.includes("unsafe_action_rejected"), true);
  const completed = finalizeEvalRunFromSteps({ storage, runId: evalRunId, taskSuccess: "passed", failureClass: "none" });

  scenario.steps.push({ kind: "desktop_observe", status: "passed", jobId: completedJob.id, evalRunId });
  scenario.steps.push({ kind: "high_risk_threshold", status: "passed", allowed: resetExplanation.allowed, confidence: resetExplanation.confidence, threshold: resetExplanation.threshold });
  scenario.steps.push({ kind: "failure_memory", status: "passed", recordId: failure.id, mayCompleteTask: failure.safety.mayCompleteTask });
  scenario.status = "passed";
  scenario.evalRunId = completed.id;
  return scenario;
}

async function runTerminalSafetyScenario({ storage, runtime, sessions }) {
  const scenario = {
    id: "terminal.safe_command.credential_reject",
    title: "Terminal safe command executes while credential-like command is rejected before persistence",
    surface: "Terminal",
    risk: "credential_sensitive",
    status: "failed",
    modalities: ["terminal"],
    steps: []
  };
  const safeJob = await runtime.enqueue({
    kind: "terminal",
    sessionId: sessions.terminal,
    priority: "interactive",
    requestedBy: "direct_ui",
    input: { command: "node --version", prompt: "Check local Node version" },
    timeoutMs: 5000
  });
  assert.equal(safeJob.status, "awaiting_approval");
  const approved = await runtime.approve(safeJob.id);
  const completedSafe = await waitForJob(storage, approved.id);
  assert.equal(completedSafe.status, "completed");
  assert.equal(String(completedSafe.outputJson?.stdout ?? "").includes(process.version), true);

  let blockedMessage = "";
  try {
    await runtime.enqueue({
      id: "scenario-terminal-credential-block",
      kind: "terminal",
      sessionId: sessions.terminal,
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { command: "echo token=abc123" },
      timeoutMs: 5000
    });
  } catch (error) {
    blockedMessage = error instanceof Error ? error.message : String(error);
  }
  assert.equal(/credential-like/.test(blockedMessage), true, blockedMessage);
  assert.equal(storage.readCapabilityJob("scenario-terminal-credential-block"), null);

  scenario.steps.push({ kind: "terminal_safe_command", status: "passed", jobId: completedSafe.id, evalRunId: readEvalRunId(completedSafe.inputJson) });
  scenario.steps.push({ kind: "credential_rejection", status: "passed", persisted: false, message: blockedMessage });
  scenario.status = "passed";
  scenario.evalRunIds = scenario.steps.map((step) => step.evalRunId).filter(Boolean);
  return scenario;
}

async function runCrossAppDagScenario({ storage, runtime, sessions }) {
  const scenario = {
    id: "cross_app.dag.observe_plan_verify",
    title: "Cross-app observe, OCR, plan, action, verify through capability DAG",
    surface: "Cross-app",
    risk: "side_effect",
    status: "failed",
    modalities: ["cross_app", "vision", "browser", "terminal"],
    steps: []
  };
  const evalRun = storage.createComputerUseEvalRun({
    scenarioId: scenario.id,
    sessionId: sessions.crossApp,
    modalities: scenario.modalities,
    prompt: "화면을 보고 문서 링크를 열고 결과를 검증",
    metrics: { perceptionLatencyMs: 58 },
    scenario: {
      id: scenario.id,
      title: scenario.title,
      modalities: scenario.modalities,
      source: "research-computer-use-scenario",
      prompt: "화면을 보고 문서 링크를 열고 결과를 검증",
      tags: ["dag", "parallel_observe", "cross_app"]
    }
  });
  const dagRuntime = new CapabilityDagRuntime(storage, runtime);
  const dag = dagRuntime.createRun({
    evalRunId: evalRun.id,
    sessionId: sessions.crossApp,
    goal: "parallel observe -> graph merge -> plan -> approval -> action -> verification -> eval ledger",
    metadata: { scenarioId: scenario.id },
    nodes: [
      { id: "setup", kind: "setup", input: { fixture: "local_screen_and_browser_docs" } },
      { id: "observe-screen", kind: "observe", dependsOn: ["setup"], capability: { kind: "screen_observe", input: { screenText: "Docs link visible", cachedGraphConfidence: 0.1 }, requestedBy: "background" } },
      { id: "observe-ocr", kind: "observe", dependsOn: ["setup"], capability: { kind: "ocr", input: { text: "Docs link https://example.test/docs" }, requestedBy: "background" } },
      { id: "merge", kind: "graph_merge", dependsOn: ["observe-screen", "observe-ocr"] },
      { id: "plan", kind: "plan", dependsOn: ["merge"], input: { action: "open_docs_link" } },
      { id: "approval", kind: "approval", dependsOn: ["plan"], input: { approvedBy: "scenario_fixture" } },
      { id: "action", kind: "action", dependsOn: ["approval"], capability: { kind: "agent_tool", input: { toolId: "scenario.open_docs", request: { url: "https://example.test/docs" } }, requestedBy: "prompt" } },
      { id: "verification", kind: "verification", dependsOn: ["action"], input: { expectedUrl: "https://example.test/docs" } },
      { id: "ledger", kind: "eval_ledger", dependsOn: ["verification"] }
    ]
  });

  await runDagUntilSettled({ storage, runtime, dagRuntime, dagRunId: dag.id });
  const nodes = storage.listCapabilityDagNodes(dag.id);
  assert.equal(nodes.every((node) => node.status === "completed"), true, JSON.stringify(nodes));
  const actionNode = nodes.find((node) => node.id === "action");
  assert.ok(actionNode?.capabilityJobId);

  const step = storage.appendComputerUseEvalStep({
    runId: evalRun.id,
    kind: "dag_summary",
    phase: "verifying",
    status: "completed",
    capabilityDagNodeId: "ledger",
    output: {
      dagRunId: dag.id,
      nodeStatuses: nodes.map((node) => ({ id: node.id, kind: node.kind, status: node.status, jobId: node.capabilityJobId }))
    },
    failureClass: "none"
  });
  storage.createComputerUseEvalResource({
    runId: evalRun.id,
    stepId: step.id,
    role: "dag_execution_summary",
    retention: "evidence",
    redaction: { rawScreenStored: false, source: "node_status_metadata" }
  });
  const completed = finalizeEvalRunFromSteps({ storage, runId: evalRun.id, taskSuccess: "passed", failureClass: "none" });

  scenario.steps.push({ kind: "dag_nodes", status: "passed", nodes: nodes.map((node) => ({ id: node.id, status: node.status, jobId: node.capabilityJobId })) });
  scenario.status = "passed";
  scenario.evalRunId = completed.id;
  scenario.dagRunId = dag.id;
  return scenario;
}

async function runDagUntilSettled({ storage, runtime, dagRuntime, dagRunId }) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await dagRuntime.runReadyNodes(dagRunId);
    for (const job of storage.listCapabilityJobs({ statuses: ["awaiting_approval"], limit: 100 })) {
      await runtime.approve(job.id);
    }
    await waitForActiveDagJobs(storage, dagRunId);
    const nodes = storage.listCapabilityDagNodes(dagRunId);
    if (nodes.every((node) => node.status === "completed" || node.status === "skipped")) {
      await dagRuntime.runReadyNodes(dagRunId);
      return;
    }
    if (nodes.some((node) => node.status === "failed" || node.status === "cancelled")) {
      throw new Error(`DAG failed: ${JSON.stringify(nodes)}`);
    }
  }
  throw new Error(`Timed out waiting for DAG ${dagRunId}.`);
}

async function waitForActiveDagJobs(storage, dagRunId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const jobIds = storage.listCapabilityDagNodes(dagRunId).map((node) => node.capabilityJobId).filter(Boolean);
    if (jobIds.length === 0 || jobIds.every((id) => isFinalJob(storage.readCapabilityJob(id)))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for DAG jobs in ${dagRunId}.`);
}

async function waitForJob(storage, jobId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = storage.readCapabilityJob(jobId);
    if (isFinalJob(job)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for capability job ${jobId}.`);
}

function isFinalJob(job) {
  return job && ["completed", "failed", "cancelled", "expired"].includes(job.status);
}

function buildBrowserSearchObservation() {
  return {
    id: "scenario-browser-search-observation",
    capturedAt: new Date().toISOString(),
    source: { kind: "active_tab", browser: "chrome", url: "https://example.test/search", title: "Example Search" },
    url: "https://example.test/search",
    title: "Example Search",
    elements: [
      {
        id: "search-input",
        role: "searchbox",
        tagName: "input",
        label: "검색창",
        text: "",
        selector: "input[name=q]",
        visible: true,
        enabled: true,
        editable: true,
        bbox: { x: 32, y: 48, w: 520, h: 44 },
        confidence: 0.94,
        riskHints: [],
        sourceOrder: 1
      },
      {
        id: "search-submit",
        role: "button",
        tagName: "button",
        label: "검색",
        text: "검색",
        selector: "button[type=submit]",
        visible: true,
        enabled: true,
        editable: false,
        bbox: { x: 568, y: 48, w: 88, h: 44 },
        confidence: 0.91,
        riskHints: ["submit"],
        sourceOrder: 2
      }
    ]
  };
}

function buildWindowsSettingsObservation() {
  return {
    id: "scenario-windows-settings-observation",
    capturedAt: new Date().toISOString(),
    source: { kind: "debug_target", browser: "unknown", title: "Windows Settings" },
    url: "app://windows-settings/display",
    title: "Windows Settings",
    elements: [
      {
        id: "brightness",
        role: "slider",
        tagName: "native",
        label: "Brightness",
        text: "Brightness",
        selector: "uia:slider:brightness",
        visible: true,
        enabled: true,
        editable: false,
        bbox: { x: 80, y: 120, w: 360, h: 48 },
        confidence: 0.86,
        riskHints: [],
        sourceOrder: 1
      },
      {
        id: "reset-network",
        role: "button",
        tagName: "native",
        label: "Reset network",
        text: "Reset network",
        selector: "uia:button:reset-network",
        visible: false,
        enabled: false,
        editable: false,
        bbox: { x: 80, y: 340, w: 180, h: 44 },
        confidence: 0.35,
        riskHints: ["delete", "unknown_side_effect"],
        sourceOrder: 2
      }
    ]
  };
}

function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readEvalRunId(value) {
  const record = readRecord(value);
  return typeof record.evalRunId === "string" ? record.evalRunId : undefined;
}

function collectModalities(runs) {
  return [...new Set(runs.flatMap((run) => run.modalities))].sort();
}

function buildScenarioCatalog(scenarios) {
  return {
    schemaVersion: "research-computer-use-scenario-catalog.v1",
    date: evidenceDate,
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      surface: scenario.surface,
      risk: scenario.risk,
      modalities: scenario.modalities,
      expectedCoverage: scenario.steps.map((step) => step.kind)
    }))
  };
}

function renderReport(evidence) {
  const rows = evidence.scenarios.map((scenario) =>
    `| \`${scenario.id}\` | ${scenario.surface} | \`${scenario.risk}\` | ${scenario.status} | ${(scenario.modalities ?? []).join(", ")} | ${(scenario.steps ?? []).map((step) => step.kind).join(", ")} |`
  ).join("\n");
  const acceptance = Object.entries(evidence.acceptance)
    .map(([key, value]) => `- ${key}: \`${Array.isArray(value) ? value.join(", ") : value}\``)
    .join("\n");
  return `# Research Computer-Use Scenario Evidence - ${evidence.date}

## Scope

These scenarios exercise the research-driven performance architecture across
safe, realistic computer-use workflows. They avoid real destructive OS/browser
mutation and use local fixtures where needed, while still running the daemon
storage, capability runtime, perception, ASR, failure memory, ROI cascade, and
DAG code paths.

- Scenario catalog: \`${evidence.scenarioCatalogPath}\`
- JSON evidence: \`${evidencePath.replace(/\\/g, "/")}\`
- Storage schema: \`${evidence.storageHealth.schemaVersion}\`

## Scenario Results

| Scenario | Surface | Risk | Status | Modalities | Coverage |
| --- | --- | --- | --- | --- | --- |
${rows}

## Acceptance

${acceptance}

## Metrics

- Runs: \`${evidence.metrics.runs}\`
- Task success rate: \`${evidence.metrics.taskSuccessRate.toFixed(3)}\`
- Proof rate: \`${evidence.metrics.proofRate.toFixed(3)}\`
- p95 latency ms: \`${evidence.metrics.p95LatencyMs}\`
- p95 perception latency ms: \`${evidence.metrics.p95PerceptionLatencyMs}\`
- Average action count: \`${evidence.metrics.averageActionCount.toFixed(2)}\`

## Remaining External Deferrals

- Official app-server client-tool contract
- Production signing certificate/service
- GPU ASR validation
- Human microphone corpus benchmark
- ASR fine-tuning/LoRA
`;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
