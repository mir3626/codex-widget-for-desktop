#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const evidence = readLatestEvidence();
const ledgerPath = join("docs", "reports", "assets", "scoped-autonomy-npm-dependency-runs.jsonl");
const latestEvidencePath = join("docs", "reports", "assets", `scoped-autonomy-npm-dependency-${formatSeoulDate(new Date())}`, "evidence.json").replace(/\\/g, "/");

assert.equal(evidence.schemaVersion, "scoped-autonomy-npm-dependency-dogfood.v1");
assert.equal(evidence.evidenceClass, "local_npm_dependency");
assert.equal(evidence.redaction?.absolutePathLeakCount, 0);
assert.equal(evidence.metrics?.repeatedSamplesPresent, true);
assert.equal(evidence.metrics?.packageInstallProvenancePresent, true);
assert.equal(evidence.metrics?.dependencyPolicyReviewPresent, true);
assert.equal(evidence.metrics?.dependencyExecutionImportPresent, true);
assert.equal(evidence.metrics?.evalEvidencePresent, true);
assert.equal(evidence.metrics?.artifactEvidencePresent, true);
assert.equal(evidence.metrics?.rerunStabilityPresent, true);
assert.equal(evidence.metrics?.pathRedactionPresent, true);
assert.equal(Number(evidence.metrics?.p95LatencySampleCount ?? 0) >= 4, true);
assert.equal(Array.isArray(evidence.scenarios), true);
assert.equal(evidence.scenarios.length >= 2, true);
assert.equal(evidence.scenarios.every((scenario) => scenario.success === true), true);
assert.equal(evidence.scenarios.every((scenario) => scenario.result?.dependencyImported === true), true);
assert.equal(evidence.scenarios.every((scenario) => Number(scenario.result?.installedPackageCount ?? 0) >= 1), true);
assert.equal(evidence.scenarios.every((scenario) => scenario.result?.dependencyPolicyReviewOutcome === "passed_local_or_allowlisted_dependency_policy"), true);

assert.equal(existsSync(ledgerPath), true, "npm dependency dogfood sample ledger missing");
const samples = readJsonl(ledgerPath).filter((sample) =>
  sample.schemaVersion === "scoped-autonomy-npm-dependency-sample.v1" &&
  String(sample.evidencePath ?? "").replace(/\\/g, "/") === latestEvidencePath &&
  sample.generatedAt === evidence.generatedAt
);
assert.equal(samples.length >= 4, true);
assert.equal(samples.filter((sample) => sample.sample?.mode === "execute").length >= 2, true);
assert.equal(samples.filter((sample) => sample.sample?.mode === "rerun").length >= 2, true);
assert.equal(samples.every((sample) => sample.sample?.status === "completed"), true);
assert.equal(samples.every((sample) => sample.sample?.dependencyImported === true), true);
assert.equal(samples.filter((sample) => sample.sample?.mode === "rerun").every((sample) => sample.sample?.matched === true && sample.sample?.artifactMatched === true), true);

const serialized = JSON.stringify({ evidence, samples });
assert.equal(/(^|[^A-Za-z])[A-Z]:[\\/]/.test(serialized), false, "npm dependency dogfood evidence must not contain absolute local paths");
assert.equal(/file:(\/\/\/)?[A-Z]:[\\/]/i.test(serialized), false, "npm dependency dogfood evidence must not contain absolute file package paths");
console.log(`scoped autonomy npm dependency dogfood smoke ok: scenarios=${evidence.scenarios.length} samples=${samples.length}`);

function readLatestEvidence() {
  const datedPath = join("docs", "reports", "assets", `scoped-autonomy-npm-dependency-${formatSeoulDate(new Date())}`, "evidence.json");
  if (existsSync(datedPath)) {
    return JSON.parse(readFileSync(datedPath, "utf8"));
  }
  throw new Error(`Missing scoped autonomy npm dependency evidence: ${datedPath}`);
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function formatSeoulDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}
