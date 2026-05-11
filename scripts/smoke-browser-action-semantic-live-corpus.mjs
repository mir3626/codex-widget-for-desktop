import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const corpusPath = "docs/dogfood/browser-action-semantic-live-corpus.jsonl";
const corpus = (await readFile(corpusPath, "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${corpusPath}:${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

assert.ok(corpus.length >= 6, "live semantic corpus should include enough reviewed cases to cover multiple browser intents");

const ids = new Set();
const intentClasses = new Set();
const sources = new Set();
const reportCache = new Map();

for (const entry of corpus) {
  assert.equal(typeof entry.id, "string", "entry id");
  assert.equal(ids.has(entry.id), false, `duplicate corpus id: ${entry.id}`);
  ids.add(entry.id);
  assert.equal(typeof entry.reportPath, "string", `${entry.id} reportPath`);
  assert.equal(typeof entry.scenarioId, "string", `${entry.id} scenarioId`);
  assert.equal(entry.expectStatus, "pass", `${entry.id} live corpus only promotes reviewed passing evidence`);
  assert.ok(Array.isArray(entry.semanticEvidence) && entry.semanticEvidence.length > 0, `${entry.id} semantic evidence tags`);
  assert.equal(hasSensitiveLiteral(entry), false, `${entry.id} should not store raw secrets or private content`);

  intentClasses.add(entry.intentClass);
  sources.add(entry.source);
  const report = await readReport(entry.reportPath);
  const row = findScenarioRow(report, entry.scenarioId);
  assert.ok(row, `${entry.id} scenario ${entry.scenarioId} must exist in ${entry.reportPath}`);
  assert.equal(row.status, entry.expectStatus, `${entry.id} report status`);
  assert.equal(row.mode, entry.mode, `${entry.id} report mode`);
}

for (const requiredIntent of [
  "read_current_page",
  "filter_or_tab_activation",
  "history_navigation",
  "search_form_fill_submit",
  "representative_content_selection"
]) {
  assert.equal(intentClasses.has(requiredIntent), true, `missing reviewed live intent class: ${requiredIntent}`);
}

assert.equal(sources.has("live-widget-ui"), true, "live semantic corpus should include widget UI dogfood");
assert.equal(sources.has("live-isolated"), true, "live semantic corpus should include isolated deterministic dogfood");

console.log(`browser action semantic live corpus smoke ok: cases=${corpus.length} intents=${intentClasses.size}`);

async function readReport(path) {
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
