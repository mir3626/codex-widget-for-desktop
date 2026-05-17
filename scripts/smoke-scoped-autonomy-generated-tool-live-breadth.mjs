#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const latestEvidence = readLatestEvidence();
const evidence = latestEvidence.data;
assertLatestEvidenceFresh(latestEvidence);
const ledgerPath = join("docs", "reports", "assets", "scoped-autonomy-generated-tool-live-breadth-runs.jsonl");
const latestEvidencePath = latestEvidence.path.replace(/\\/g, "/");
assert.equal(evidence.schemaVersion, "scoped-autonomy-generated-tool-live-breadth-dogfood.v1");
assert.equal(evidence.redaction?.absolutePathLeakCount, 0);
assert.equal(evidence.metrics?.requiredGeneratedClassesPresent, true);
assert.equal(evidence.metrics?.repeatedLiveRunsPresent, true);
assert.equal(evidence.metrics?.webSourceQualityAccepted, true);
assert.equal(evidence.metrics?.localDocumentConversionVerified, true);
assert.equal(evidence.metrics?.terminalCommandVerified, true);
assert.equal(evidence.metrics?.publicDownloadVerified, true);
assert.equal(evidence.metrics?.pathRedactionPresent, true);
assert.equal(Number(evidence.metrics?.p95LatencySampleCount ?? 0) >= 16, true);
assert.equal(Array.isArray(evidence.scenarios), true);
assert.equal(evidence.scenarios.length >= 8, true);

const requiredClasses = ["browser_download_verify", "local_document_conversion", "terminal_generated_tool", "web_research_to_pdf"];
for (const capability of requiredClasses) {
  assert.equal(evidence.scenarios.filter((scenario) => scenario.capability === capability && scenario.success === true).length >= 2, true, capability);
}

assert.equal(existsSync(ledgerPath), true, "live breadth sample ledger missing");
const samples = readJsonl(ledgerPath).filter((sample) =>
  sample.schemaVersion === "scoped-autonomy-generated-tool-live-breadth-sample.v1" &&
  String(sample.evidencePath ?? "").replace(/\\/g, "/") === latestEvidencePath &&
  sample.generatedAt === evidence.generatedAt
);
assert.equal(samples.length >= 16, true);
for (const capability of requiredClasses) {
  const executeSamples = samples.filter((sample) => sample.sample?.capability === capability && sample.sample?.mode === "execute");
  assert.equal(executeSamples.length >= 2, true, `${capability} execute samples`);
  assert.equal(executeSamples.every((sample) => sample.sample?.liveBacked === true && sample.sample?.status === "completed"), true);
}

const serialized = JSON.stringify({ evidence, samples });
assert.equal(/(^|[^A-Za-z])[A-Z]:[\\/]/.test(serialized), false, "live breadth smoke evidence must not contain absolute local paths");
console.log(`scoped autonomy generated-tool live breadth smoke ok: scenarios=${evidence.scenarios.length} samples=${samples.length}`);

function readLatestEvidence() {
  const root = join("docs", "reports", "assets");
  const prefix = "scoped-autonomy-generated-tool-live-breadth-";
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
  throw new Error(`Missing generated-tool live breadth evidence under ${root}`);
}

function assertLatestEvidenceFresh(latestEvidence) {
  const maxAgeDays = Number(process.env.CODEX_WIDGET_DOGFOOD_MAX_EVIDENCE_AGE_DAYS ?? 3);
  const generatedAt = Date.parse(latestEvidence.data.generatedAt ?? "");
  const pathDate = /scoped-autonomy-generated-tool-live-breadth-(\d{4}-\d{2}-\d{2})/.exec(latestEvidence.path.replace(/\\/g, "/"))?.[1];
  const evidenceTime = Number.isFinite(generatedAt)
    ? generatedAt
    : pathDate
      ? Date.parse(`${pathDate}T00:00:00Z`)
      : Number.NaN;
  assert.equal(Number.isFinite(evidenceTime), true, "generated-tool live breadth evidence must include a parseable generatedAt or dated path");
  const ageDays = (Date.now() - evidenceTime) / 86_400_000;
  assert.equal(ageDays <= maxAgeDays, true, `generated-tool live breadth evidence is stale: ${latestEvidence.path}`);
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
