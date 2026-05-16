#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const evidence = readLatestEvidence();
const samples = readSampleLedger(join("docs", "reports", "assets", "computer-use-browser-chrome-live-extension-runs.jsonl"));
const latestSamples = samples.filter((sample) => sample.runId === evidence.runId);

assert.equal(evidence.schemaVersion, "computer-use-browser-chrome-live-extension-dogfood.v1");
assert.equal(evidence.evidenceClass, "real_extension_local_fixture");
assert.equal(evidence.extension?.browserApiExecution, true);
assert.equal(evidence.metrics?.realExtension, true);
assert.equal(evidence.metrics?.localFixture, true);
assert.equal(evidence.metrics?.downloadVerifyCovered, true);
assert.equal(evidence.metrics?.debuggerPrintPdfCovered, true);
assert.equal(evidence.metrics?.redactionProofPresent, true);
assert.equal(evidence.metrics?.cleanupReconciled, true);
assert.equal(Number(evidence.metrics?.successRate), 1);
assert.equal(Number(evidence.metrics?.p95LatencyMs) > 0, true);
assert.equal(latestSamples.length >= 2, true);

const download = evidence.scenarios.find((scenario) => scenario.id === "browser-chrome-live-extension-download-verify");
const print = evidence.scenarios.find((scenario) => scenario.id === "browser-chrome-live-extension-debugger-print-pdf");
assert.equal(download?.success, true);
assert.equal(download?.result?.fileExists, true);
assert.equal(download?.result?.resourceRoles?.includes("download_verified_file"), true);
assert.match(JSON.stringify(download?.result?.redaction ?? {}), /basename_only/);
assert.equal(typeof download?.result?.fileSha256, "string");
assert.equal(download.result.fileSha256.length >= 32, true);
assert.equal(print?.success, true);
assert.equal(Number(print?.result?.byteLength) > 0, true);
assert.equal(typeof print?.result?.pdfSha256, "string");
assert.equal(print.result.pdfSha256.length >= 32, true);
assert.equal(print.result.dataOmitted, true);
assert.match(JSON.stringify(print.result.redaction ?? {}), /arbitraryCdpEvalAllowed":false/);
assert.equal(hasSensitiveLiteral(evidence), false);

console.log(`computer use browser chrome live extension dogfood smoke ok: ${evidence.path} samples=${latestSamples.length}`);

function readLatestEvidence() {
  const root = join("docs", "reports", "assets");
  if (!existsSync(root)) {
    throw new Error("Missing docs/reports/assets.");
  }
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = /^computer-use-browser-chrome-live-extension-(\d{4}-\d{2}-\d{2})$/.exec(entry.name);
      if (!match) {
        return null;
      }
      const path = join(root, entry.name, "evidence.json");
      if (!existsSync(path)) {
        return null;
      }
      return {
        date: match[1],
        path: path.replace(/\\/g, "/"),
        data: JSON.parse(readFileSync(path, "utf8"))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = entries.at(-1);
  if (!latest) {
    throw new Error("Missing Computer Use Browser Chrome live extension evidence. Run npm run dogfood:computer-use-browser-chrome-live-extension first.");
  }
  return {
    ...latest.data,
    path: latest.path
  };
}

function readSampleLedger(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing sample ledger: ${path}`);
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function hasSensitiveLiteral(value) {
  return /\b(password|token|cookie|secret|credential|api[_-]?key|authorization)\b/i.test(JSON.stringify(value));
}

