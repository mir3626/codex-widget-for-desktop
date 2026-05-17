#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const outputRoot = mkdtempSync(path.join(tmpdir(), "codex-widget-asr-benchmark-"));
try {
  const result = spawnSync(process.execPath, [
    "scripts/benchmark-asr-corpus.mjs",
    "--output-root",
    outputRoot,
    "--date",
    "2099-01-01"
  ], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidencePath = path.join(outputRoot, "assets", "asr-benchmark-corpus-2099-01-01", "evidence.json");
  const reportPath = path.join(outputRoot, "asr-benchmark-corpus-2099-01-01.md");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const report = readFileSync(reportPath, "utf8");
  assert.equal(evidence.schemaVersion, "asr-benchmark-corpus-report.v1");
  assert.equal(evidence.metrics.sampleCount, 3);
  assert.equal(evidence.metrics.averageWer, 0);
  assert.equal(evidence.metrics.commandAccuracy, 1);
  assert.equal(evidence.metrics.cpuFixtureSampleCount, 3);
  assert.equal(report.includes("ASR Benchmark Corpus"), true);
  console.log("asr benchmark harness smoke ok");
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}
