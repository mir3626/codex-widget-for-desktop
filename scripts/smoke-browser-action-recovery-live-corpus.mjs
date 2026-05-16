#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const corpusPath = "docs/dogfood/browser-action-recovery-live-corpus.jsonl";
const corpus = (await readJsonl(corpusPath)).map((entry, index) => {
  assert.equal(typeof entry.id, "string", `${corpusPath}:${index + 1} id`);
  assert.equal(typeof entry.failureReportPath, "string", `${entry.id} failureReportPath`);
  assert.equal(typeof entry.recoveryReportPath, "string", `${entry.id} recoveryReportPath`);
  assert.equal(typeof entry.scenarioId, "string", `${entry.id} scenarioId`);
  assert.equal(typeof entry.failureClass, "string", `${entry.id} failureClass`);
  assert.ok(Array.isArray(entry.recoveryEvidence) && entry.recoveryEvidence.length > 0, `${entry.id} recovery evidence tags`);
  assert.ok(Array.isArray(entry.calibrationImpact) && entry.calibrationImpact.length > 0, `${entry.id} calibration impact tags`);
  assert.equal(hasSensitiveLiteral(entry), false, `${entry.id} should not store raw secrets or private content`);
  return entry;
});

assert.ok(corpus.length >= 4, "recovery corpus should include multiple reviewed failure-to-pass pairs");

const ids = new Set();
const failureClasses = new Set();
const sources = new Set();
const reportCache = new Map();

for (const entry of corpus) {
  assert.equal(ids.has(entry.id), false, `duplicate recovery corpus id: ${entry.id}`);
  ids.add(entry.id);
  failureClasses.add(entry.failureClass);
  sources.add(entry.source);

  const failureReport = await readReport(entry.failureReportPath, reportCache);
  const recoveryReport = await readReport(entry.recoveryReportPath, reportCache);
  const failureRow = findScenarioRow(failureReport, entry.scenarioId);
  const recoveryRow = findScenarioRow(recoveryReport, entry.scenarioId);
  assert.ok(failureRow, `${entry.id} failure scenario ${entry.scenarioId} must exist in ${entry.failureReportPath}`);
  assert.ok(recoveryRow, `${entry.id} recovery scenario ${entry.scenarioId} must exist in ${entry.recoveryReportPath}`);
  assert.equal(failureRow.status, "fail", `${entry.id} failure row status`);
  assert.equal(failureRow.failureClass, entry.failureClass, `${entry.id} failure class`);
  assert.equal(recoveryRow.status, "pass", `${entry.id} recovery row status`);
  assert.equal(recoveryRow.mode, entry.mode, `${entry.id} recovery mode`);
  assert.ok(Number.isFinite(failureRow.elapsedMs), `${entry.id} failure latency`);
  assert.ok(Number.isFinite(recoveryRow.elapsedMs), `${entry.id} recovery latency`);
}

for (const requiredClass of ["permission_missing", "wrong_effect", "latency_regression"]) {
  assert.equal(failureClasses.has(requiredClass), true, `missing recovery failure class: ${requiredClass}`);
}
assert.equal(sources.has("live-widget-ui"), true, "recovery corpus should include widget UI dogfood");
assert.equal(sources.has("live-isolated"), true, "recovery corpus should include isolated dogfood");

console.log(`browser action recovery live corpus smoke ok: cases=${corpus.length} failureClasses=${failureClasses.size}`);

async function readJsonl(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

async function readReport(path, reportCache) {
  if (!reportCache.has(path)) {
    reportCache.set(path, await readFile(path, "utf8"));
  }
  return reportCache.get(path);
}

function findScenarioRow(report, scenarioId) {
  for (const line of report.split(/\r?\n/)) {
    if (!line.startsWith("|") || !line.includes(scenarioId)) {
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === scenarioId) {
      return {
        scenario: cells[0],
        mode: cells[1],
        status: cells[2],
        failureClass: cells[3],
        elapsedMs: Number(cells[4])
      };
    }
  }
  return null;
}

function hasSensitiveLiteral(entry) {
  const text = JSON.stringify(entry).toLowerCase();
  return /\b(password|token|cookie|payment|secret|credential)\b/.test(text);
}
