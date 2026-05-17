#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));
const corpusPath = path.resolve(options.corpus ?? "docs/eval/computer-use-live-task-corpus.fixture.json");
const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
const date = options.date ?? localDateString();
const outputRoot = path.resolve(options.outputRoot ?? path.join("docs", "reports"));
const assetDir = path.join(outputRoot, "assets", `computer-use-live-task-benchmark-${date}`);
const evidencePath = path.join(assetDir, "evidence.json");
const reportPath = path.join(outputRoot, `computer-use-live-task-benchmark-${date}.md`);

const tasks = Array.isArray(corpus.tasks) ? corpus.tasks : [];
if (!tasks.length) {
  throw new Error(`Computer Use live task corpus must contain tasks: ${corpusPath}`);
}

const results = tasks.map(evaluateTask);
const latencyValues = results.map((result) => result.latencyMs).filter(Number.isFinite);
const successCount = results.filter((result) => result.success).length;
const rollbackCovered = results.filter((result) => result.rollbackCovered).length;
const evidenceCovered = results.filter((result) => result.evidenceCovered).length;
const output = {
  schemaVersion: "computer-use-live-task-benchmark.v1",
  generatedAt: new Date().toISOString(),
  date,
  corpus: {
    path: path.relative(process.cwd(), corpusPath).replace(/\\/g, "/"),
    schemaVersion: corpus.schemaVersion,
    fixtureOnly: corpus.fixtureOnly === true,
    taskCount: tasks.length
  },
  metrics: {
    taskCount: tasks.length,
    successCount,
    successRate: successCount / tasks.length,
    p50LatencyMs: percentile(latencyValues, 0.5),
    p95LatencyMs: percentile(latencyValues, 0.95),
    rollbackCoverage: rollbackCovered / tasks.length,
    evidenceCoverage: evidenceCovered / tasks.length
  },
  promotionGate: {
    schemaVersion: "computer-use-live-task-benchmark-gate.v1",
    gateId: "live_task_benchmark_harness",
    status: corpus.fixtureOnly === true ? "fixture_only" : successCount === tasks.length ? "passed" : "blocked",
    promotable: corpus.fixtureOnly !== true && successCount === tasks.length && evidenceCovered === tasks.length,
    reasons: [
      corpus.fixtureOnly === true ? "fixture_corpus_does_not_promote_live_computer_use" : "user_captured_live_corpus_present",
      successCount === tasks.length ? "all_tasks_succeeded" : "task_failure_present",
      rollbackCovered === tasks.length ? "rollback_coverage_complete" : "rollback_coverage_incomplete",
      evidenceCovered === tasks.length ? "evidence_coverage_complete" : "evidence_coverage_incomplete"
    ]
  },
  results
};

if (!options.dryRun) {
  await mkdir(assetDir, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderReport(output), "utf8");
}

if (options.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`computer-use live task benchmark: ${output.promotionGate.status}`);
  console.log(`success=${output.metrics.successRate.toFixed(3)} p95=${output.metrics.p95LatencyMs}ms rollback=${output.metrics.rollbackCoverage.toFixed(3)} evidence=${output.metrics.evidenceCoverage.toFixed(3)}`);
  if (!options.dryRun) {
    console.log(`evidence: ${path.relative(process.cwd(), evidencePath).replace(/\\/g, "/")}`);
    console.log(`report: ${path.relative(process.cwd(), reportPath).replace(/\\/g, "/")}`);
  }
}

function evaluateTask(task) {
  const evidence = Array.isArray(task.evidence) ? task.evidence.filter((item) => typeof item === "string") : [];
  const rollback = task.rollback && typeof task.rollback === "object" ? task.rollback : {};
  const success = task.verification?.success === true && task.expectedStatus === "passed";
  return {
    id: String(task.id ?? "unknown-task"),
    surface: String(task.surface ?? "unknown"),
    status: success ? "passed" : "failed",
    success,
    latencyMs: Number.isFinite(Number(task.latencyMs)) ? Number(task.latencyMs) : 0,
    rollbackRequired: rollback.required === true,
    rollbackCovered: rollback.required === true ? rollback.covered === true : true,
    evidenceCovered: evidence.length > 0,
    evidence,
    notes: typeof task.verification?.notes === "string" ? task.verification.notes : undefined
  };
}

function renderReport(output) {
  const lines = [
    "# Computer Use Live Task Benchmark",
    "",
    `- Date: ${output.date}`,
    `- Corpus: ${output.corpus.path}`,
    `- Fixture only: ${output.corpus.fixtureOnly}`,
    `- Gate: ${output.promotionGate.status}`,
    `- Success rate: ${output.metrics.successRate.toFixed(3)}`,
    `- P95 latency: ${output.metrics.p95LatencyMs} ms`,
    `- Rollback coverage: ${output.metrics.rollbackCoverage.toFixed(3)}`,
    `- Evidence coverage: ${output.metrics.evidenceCoverage.toFixed(3)}`,
    "",
    "## Tasks",
    ""
  ];
  for (const result of output.results) {
    lines.push(`- ${result.status} ${result.id} (${result.surface}) latency=${result.latencyMs}ms rollback=${result.rollbackCovered} evidence=${result.evidenceCovered}`);
  }
  lines.push("");
  lines.push("Fixture evidence is a harness smoke only. Live promotion requires user-captured traces with real Windows app, browser, and terminal execution evidence.");
  return `${lines.join("\n")}\n`;
}

function percentile(values, p) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function localDateString() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(args) {
  const options = { dryRun: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--corpus") {
      options.corpus = args[++index];
    } else if (arg === "--output-root") {
      options.outputRoot = args[++index];
    } else if (arg === "--date") {
      options.date = args[++index];
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--json") {
      options.json = true;
    }
  }
  return options;
}
