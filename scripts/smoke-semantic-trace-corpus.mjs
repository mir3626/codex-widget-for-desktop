import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  createSemanticGoldenTraceSuite,
  runSemanticGoldenTraceSuite,
  summarizeSemanticGoldenTraceMetrics
} from "../dist/daemon/semantic-interface/index.js";

const corpusPath = "docs/dogfood/semantic-trace-corpus.jsonl";
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

const suite = createSemanticGoldenTraceSuite();
const suiteById = new Map(suite.map((testCase) => [testCase.id, testCase]));
for (const entry of corpus) {
  assert.equal(typeof entry.id, "string", "corpus entry id");
  assert.equal(suiteById.has(entry.id), true, `corpus entry ${entry.id} must map to a golden trace case`);
  const expected = suiteById.get(entry.id)?.expect;
  assert.equal(entry.expectOutcome, expected?.outcome, `${entry.id} outcome contract`);
  if (entry.expectSelectedEntityId) {
    assert.equal(entry.expectSelectedEntityId, expected?.selectedEntityId, `${entry.id} selected entity contract`);
  }
  if (entry.expectWarningKind) {
    assert.equal(entry.expectWarningKind, expected?.warningKind, `${entry.id} warning contract`);
  }
}

const missing = suite.filter((testCase) => !corpus.some((entry) => entry.id === testCase.id));
assert.deepEqual(missing.map((item) => item.id), [], "semantic corpus should cover every golden trace case");

const results = runSemanticGoldenTraceSuite({ cases: suite });
const metrics = summarizeSemanticGoldenTraceMetrics(results);
assert.equal(metrics.failed, 0, `semantic trace corpus failures: ${JSON.stringify(results.filter((result) => !result.passed), null, 2)}`);
assert.equal(metrics.passRate, 1, "semantic trace corpus pass rate");
for (const [mode, bucket] of Object.entries(metrics.byMode)) {
  assert.equal(bucket.passRate, 1, `semantic trace corpus mode ${mode} pass rate`);
}

console.log(`semantic trace corpus smoke ok: cases=${metrics.total} passRate=${metrics.passRate}`);
