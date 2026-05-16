#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const evidence = readLatestEvidence();
const samples = readSampleLedger(join("docs", "reports", "assets", "computer-use-browser-chrome-dogfood-runs.jsonl"));

assert.equal(evidence.schemaVersion, "computer-use-browser-chrome-dogfood.v1");
assert.equal(evidence.evidenceClass, "fixture_bridge_repeated_dogfood");
assert.equal(evidence.promotion, "non_promoting_until_real_extension_live_samples_exist");
assert.equal(Array.isArray(evidence.scenarios), true);
assert.equal(evidence.scenarios.length >= 2, true);
assert.equal(evidence.metrics?.fixtureBridge, true);
assert.equal(evidence.metrics?.repeatedSamples, true);
assert.equal(evidence.metrics?.downloadVerifyCovered, true);
assert.equal(evidence.metrics?.debuggerPrintPdfCovered, true);
assert.equal(evidence.metrics?.redactionProofPresent, true);
assert.equal(evidence.metrics?.cleanupRollbackCompleted, true);
assert.equal(Number(evidence.metrics?.p95LatencyMs) > 0, true);

const requiredCommands = new Set(["download.verify", "debugger.print_to_pdf"]);
const seenCommands = new Set(evidence.scenarios.map((scenario) => scenario.command));
for (const command of requiredCommands) {
  assert.equal(seenCommands.has(command), true, `missing command ${command}`);
}

for (const scenario of evidence.scenarios) {
  assert.equal(scenario.success, true, `${scenario.id} did not succeed`);
  assert.equal(scenario.status, "passed");
  assert.equal(Number(scenario.repeatCount) >= 2, true, `${scenario.id} not repeated`);
  assert.equal(Number(scenario.result?.sampleCount) >= 2, true, `${scenario.id} missing samples`);
  assert.equal(Number(scenario.result?.successCount), Number(scenario.result?.sampleCount));
  assert.equal(Number(scenario.result?.p95LatencyMs) > 0, true, `${scenario.id} missing p95`);
  assert.equal(Number(scenario.result?.verifierNodeCount) >= Number(scenario.result?.sampleCount), true, `${scenario.id} missing verifier nodes`);
  assert.equal(Number(scenario.result?.evalLedgerNodeCount) >= Number(scenario.result?.sampleCount), true, `${scenario.id} missing eval ledger nodes`);
  assert.equal(scenario.result?.cleanupRollbackCompleted, true, `${scenario.id} missing cleanup rollback`);
  assert.equal(hasSensitiveLiteral(scenario), false, `${scenario.id} has sensitive literal`);
  if (scenario.command === "download.verify") {
    assert.equal((scenario.result?.resourceRoles ?? []).includes("download_verified_file"), true, "download verify missing resource evidence");
    assert.match(JSON.stringify(scenario.result?.redaction ?? {}), /basename_only/);
  }
  if (scenario.command === "debugger.print_to_pdf") {
    assert.match(JSON.stringify(scenario.result?.redaction ?? {}), /path_redacted|pathRedacted/);
  }
}

const successfulSamples = samples.filter((sample) => sample.scenario?.success === true);
assert.equal(successfulSamples.length >= Number(evidence.metrics.sampleCount), true);
console.log(`computer use browser chrome dogfood smoke ok: ${evidence.path} samples=${samples.length}`);

function readLatestEvidence() {
  const root = join("docs", "reports", "assets");
  if (!existsSync(root)) {
    throw new Error("Missing docs/reports/assets.");
  }
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = /^computer-use-browser-chrome-dogfood-(\d{4}-\d{2}-\d{2})$/.exec(entry.name);
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
    throw new Error("Missing Computer Use Browser Chrome dogfood evidence. Run npm run dogfood:computer-use-browser-chrome first.");
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
