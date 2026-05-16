#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const evidence = readLatestEvidence();
const ledgerPath = join("docs", "reports", "assets", "scoped-autonomy-generated-tool-live-breadth-runs.jsonl");
const latestEvidencePath = join("docs", "reports", "assets", `scoped-autonomy-generated-tool-live-breadth-${formatSeoulDate(new Date())}`, "evidence.json").replace(/\\/g, "/");
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
  const datedPath = join("docs", "reports", "assets", `scoped-autonomy-generated-tool-live-breadth-${formatSeoulDate(new Date())}`, "evidence.json");
  if (existsSync(datedPath)) {
    return JSON.parse(readFileSync(datedPath, "utf8"));
  }
  throw new Error(`Missing generated-tool live breadth evidence: ${datedPath}`);
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
