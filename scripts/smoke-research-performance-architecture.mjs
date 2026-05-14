#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { CapabilityRuntime } from "../dist/daemon/capability-runtime/index.js";
import { CapabilityDagRuntime } from "../dist/daemon/capability-dag/index.js";
import { finalizeEvalRunFromSteps, rollupComputerUseEvalMetrics } from "../dist/daemon/computer-use-eval/index.js";
import { buildPerceptionGraphFromBrowserObservation, explainPerceptionTarget } from "../dist/daemon/perception-graph/index.js";
import { computeTileHashes, diffTileHashes, planPerceptionCascade } from "../dist/daemon/perception-cascade/index.js";
import { decodeAsrCommand } from "../dist/daemon/transcription/index.js";
import { readFailureCalibration, recordStructuredFailure } from "../dist/daemon/failure-memory/index.js";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-research-architecture-"));
let storage;
let runtime;

try {
  storage = createStorageService({ appDataDir: tempRoot });
  assert.equal(storage.health().schemaVersion >= 4, true, "research architecture migration should apply");

  const evalRun = storage.createComputerUseEvalRun({
    scenarioId: "research-smoke-browser",
    modalities: ["browser", "vision", "asr"],
    prompt: "검색창에 react router dom 입력하고 검색",
    scenario: {
      id: "research-smoke-browser",
      title: "research architecture browser/asr/vision smoke",
      modalities: ["browser", "vision", "asr"],
      source: "smoke",
      prompt: "검색창에 react router dom 입력하고 검색"
    }
  });

  const observation = {
    id: "obs-smoke",
    capturedAt: new Date().toISOString(),
    source: { kind: "active_tab", browser: "chrome", url: "https://example.test", title: "Example" },
    url: "https://example.test",
    title: "Example",
    elements: [
      {
        id: "search",
        role: "searchbox",
        tagName: "input",
        label: "검색",
        text: "",
        selector: "input[name=q]",
        visible: true,
        enabled: true,
        editable: true,
        bbox: { x: 20, y: 20, w: 400, h: 40 },
        confidence: 0.92,
        sourceOrder: 1,
        riskHints: []
      },
      {
        id: "submit",
        role: "button",
        tagName: "button",
        label: "검색",
        text: "검색",
        selector: "button[type=submit]",
        visible: true,
        enabled: true,
        bbox: { x: 430, y: 20, w: 80, h: 40 },
        confidence: 0.9,
        sourceOrder: 2,
        riskHints: []
      }
    ]
  };
  const graph = storage.recordPerceptionGraph({
    graph: buildPerceptionGraphFromBrowserObservation({ observation, sessionId: evalRun.sessionId }),
    source: "smoke"
  });
  const explanation = explainPerceptionTarget({ graph, nodeId: "search", risk: "side_effect" });
  assert.equal(explanation.allowed, true, explanation.reason);
  storage.appendComputerUseEvalStep({
    runId: evalRun.id,
    kind: "perception_graph",
    phase: "perceiving",
    status: "completed",
    perceptionGraphId: graph.id,
    output: { explanation }
  });

  const transcript = {
    id: "transcript-smoke",
    createdAt: new Date().toISOString(),
    language: "ko",
    text: "검색창에 리액트 라우터 돔 입력하고 검색",
    confidence: 0.82,
    segments: []
  };
  const decoded = decodeAsrCommand(transcript, {
    uiLabels: ["검색"],
    packageNames: ["react-router-dom"],
    sideEffectRisk: "side_effect"
  });
  assert.equal(decoded.canonicalText.includes("react-router-dom"), true, "ASR decoder should canonicalize mixed Korean/English package names");
  assert.equal(decoded.clarificationRequired, false, decoded.clarificationReason);
  storage.appendComputerUseEvalStep({
    runId: evalRun.id,
    kind: "asr_decode",
    phase: "framing_intent",
    status: "completed",
    output: decoded,
    failureClass: "none"
  });

  const beforeTiles = computeTileHashes({ bytes: "screen A", width: 256, height: 128, tileSize: 128 });
  const afterTiles = computeTileHashes({ bytes: "screen B", width: 256, height: 128, tileSize: 128 });
  const dirtyRegions = diffTileHashes(beforeTiles, afterTiles);
  const cascade = planPerceptionCascade({ cachedGraphConfidence: 0.2, domOrUiaConfidence: 0.4, dirtyRegions, requiresText: true });
  assert.equal(dirtyRegions.length > 0, true, "tile diff should produce dirty regions");
  assert.equal(cascade.some((stage) => stage.name === "roi_ocr" && stage.status === "completed"), true, "ROI OCR cascade should run for dirty text regions");
  storage.appendComputerUseEvalStep({
    runId: evalRun.id,
    kind: "roi_cascade",
    phase: "perceiving",
    status: "completed",
    output: { dirtyRegions, cascade },
    failureClass: "none"
  });

  const failure = recordStructuredFailure({
    storage,
    failureClass: "ambiguous_target",
    surface: "browser",
    source: "smoke",
    scenarioId: evalRun.scenarioId,
    evalRunId: evalRun.id,
    perceptionGraphId: graph.id,
    badTargetPatterns: ["generic search button"],
    recoveryHints: ["ask_target_clarification"],
    ttlMs: 60_000
  });
  assert.equal(failure.safety.mayCompleteTask, false, "failure memory must not be authority");
  assert.equal(readFailureCalibration({ storage, surface: "browser" }).badTargetPatterns.includes("generic search button"), true);

  runtime = new CapabilityRuntime({ storage, maxActiveJobs: 2 });
  runtime.register("screen_observe", async ({ job }) => ({
    output: { ok: true, node: job.inputJson },
    summary: "screen observe dag node completed"
  }));
  runtime.register("ocr", async ({ job }) => ({
    output: { ok: true, text: "검색" },
    summary: "ocr dag node completed"
  }));
  const dagRuntime = new CapabilityDagRuntime(storage, runtime);
  const dag = dagRuntime.createRun({
    evalRunId: evalRun.id,
    goal: "parallel observe then ledger",
    nodes: [
      { id: "observe-screen", kind: "observe", capability: { kind: "screen_observe", input: { evalRunId: evalRun.id }, requestedBy: "background" } },
      { id: "observe-ocr", kind: "observe", capability: { kind: "ocr", input: { text: "검색", evalRunId: evalRun.id }, requestedBy: "background" } },
      { id: "merge", kind: "graph_merge", dependsOn: ["observe-screen", "observe-ocr"] },
      { id: "ledger", kind: "eval_ledger", dependsOn: ["merge"] }
    ]
  });
  await dagRuntime.runReadyNodes(dag.id);
  await waitForDagJobs(storage, dag.id);
  await dagRuntime.runReadyNodes(dag.id);
  await dagRuntime.runReadyNodes(dag.id);
  const dagNodes = storage.listCapabilityDagNodes(dag.id);
  assert.equal(dagNodes.some((node) => node.capabilityJobId), true, "DAG observe nodes should enqueue capability jobs");
  assert.equal(dagNodes.every((node) => node.status === "completed"), true, "DAG should complete all local/capability nodes");

  const completed = finalizeEvalRunFromSteps({ storage, runId: evalRun.id, taskSuccess: "passed", failureClass: "none" });
  const metrics = rollupComputerUseEvalMetrics([completed]);
  assert.equal(metrics.taskSuccessRate, 1);
  assert.equal(metrics.runs, 1);

  console.log("research performance architecture smoke ok");
} finally {
  await runtime?.shutdown();
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function waitForDagJobs(storage, dagRunId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const nodes = storage.listCapabilityDagNodes(dagRunId);
    const jobIds = nodes.map((node) => node.capabilityJobId).filter(Boolean);
    if (jobIds.length > 0 && jobIds.every((id) => ["completed", "failed", "cancelled", "expired"].includes(storage.readCapabilityJob(id)?.status))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for DAG capability jobs.");
}
