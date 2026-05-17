#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const latestEvidence = readLatestEvidence();
const evidence = latestEvidence.data;
assertLatestEvidenceFresh(latestEvidence);
const ledgerPath = join("docs", "reports", "assets", "scoped-autonomy-npm-dependency-runs.jsonl");
const latestEvidencePath = latestEvidence.path.replace(/\\/g, "/");

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
  const root = join("docs", "reports", "assets");
  const prefix = "scoped-autonomy-npm-dependency-";
  const latest = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => join(root, entry.name, "evidence.json"))
    .filter((path) => existsSync(path))
    .sort((a, b) => a.localeCompare(b))
    .at(-1);
  if (latest) {
    return {
      path: latest,
      data: JSON.parse(readFileSync(latest, "utf8"))
    };
  }
  throw new Error(`Missing scoped autonomy npm dependency evidence under ${root}`);
}

function assertLatestEvidenceFresh(latestEvidence) {
  const maxAgeDays = Number(process.env.CODEX_WIDGET_DOGFOOD_MAX_EVIDENCE_AGE_DAYS ?? 3);
  const generatedAt = Date.parse(latestEvidence.data.generatedAt ?? "");
  const pathDate = /scoped-autonomy-npm-dependency-(\d{4}-\d{2}-\d{2})/.exec(latestEvidence.path.replace(/\\/g, "/"))?.[1];
  const evidenceTime = Number.isFinite(generatedAt)
    ? generatedAt
    : pathDate
      ? Date.parse(`${pathDate}T00:00:00Z`)
      : Number.NaN;
  assert.equal(Number.isFinite(evidenceTime), true, "npm dependency dogfood evidence must include a parseable generatedAt or dated path");
  const ageDays = (Date.now() - evidenceTime) / 86_400_000;
  assert.equal(ageDays <= maxAgeDays, true, `npm dependency dogfood evidence is stale: ${latestEvidence.path}`);
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
