#!/usr/bin/env node
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { createReleaseReadinessSummary, rollupComputerUseEvalMetrics } from "../dist/daemon/computer-use-eval/index.js";

const storage = createStorageService();
try {
  const runs = storage.listComputerUseEvalRuns({ limit: readArgNumber("--limit", 500) });
  const output = {
    schemaVersion: "computer-use-eval-rollup.v1",
    generatedAt: new Date().toISOString(),
    metrics: rollupComputerUseEvalMetrics(runs),
    readiness: createReleaseReadinessSummary(runs)
  };
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    console.log(`computer use eval runs: ${output.metrics.runs}`);
    console.log(`task success rate: ${output.metrics.taskSuccessRate.toFixed(3)}`);
    console.log(`p95 latency ms: ${output.metrics.p95LatencyMs}`);
    console.log(`p95 perception latency ms: ${output.metrics.p95PerceptionLatencyMs}`);
  }
} finally {
  storage.close();
}

function readArgNumber(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}
