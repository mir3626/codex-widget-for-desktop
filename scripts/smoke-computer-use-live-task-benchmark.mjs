#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const outputRoot = mkdtempSync(path.join(tmpdir(), "codex-widget-live-task-benchmark-"));
try {
  const result = spawnSync(process.execPath, [
    "scripts/benchmark-computer-use-live-tasks.mjs",
    "--output-root",
    outputRoot,
    "--date",
    "2099-01-01"
  ], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidencePath = path.join(outputRoot, "assets", "computer-use-live-task-benchmark-2099-01-01", "evidence.json");
  const reportPath = path.join(outputRoot, "computer-use-live-task-benchmark-2099-01-01.md");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const report = readFileSync(reportPath, "utf8");
  assert.equal(evidence.schemaVersion, "computer-use-live-task-benchmark.v1");
  assert.equal(evidence.metrics.taskCount, 3);
  assert.equal(evidence.metrics.successRate, 1);
  assert.equal(evidence.metrics.rollbackCoverage, 1);
  assert.equal(evidence.metrics.evidenceCoverage, 1);
  assert.equal(evidence.promotionGate.gateId, "live_task_benchmark_harness");
  assert.equal(evidence.promotionGate.status, "fixture_only");
  assert.equal(evidence.promotionGate.promotable, false);
  assert.equal(report.includes("Computer Use Live Task Benchmark"), true);
  console.log("computer use live task benchmark smoke ok");
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}
