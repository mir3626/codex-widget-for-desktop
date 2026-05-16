#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const evidence = readLatestEvidence();
assert.equal(evidence.schemaVersion, "computer-use-browser-prompt-dogfood.v1");
assert.equal(evidence.metrics?.fixtureBacked, true);
assert.equal(evidence.metrics?.directComputerSessionPromptRoute, true);
assert.equal(Array.isArray(evidence.scenarios), true);
assert.equal(evidence.scenarios.length >= 4, true);

const requiredIntents = [
  "read_current_page",
  "search_form_fill_submit",
  "representative_content_selection",
  "navigation"
];
const intentClasses = new Set(evidence.scenarios.map((scenario) => scenario.intentClass));
for (const intent of requiredIntents) {
  assert.equal(intentClasses.has(intent), true, `missing intent ${intent}`);
}

for (const scenario of evidence.scenarios) {
  assert.equal(scenario.success, true, `${scenario.id} did not succeed`);
  assert.equal(scenario.status, "passed");
  assert.equal(Array.isArray(scenario.architectureWorkflow), true);
  assert.equal(scenario.architectureWorkflow.length >= 6, true);
  assert.match(scenario.architectureWorkflow.join("\n"), /browser-action-prompt/);
  assert.equal(Number(scenario.result?.elapsedMs) > 0, true, `${scenario.id} missing elapsedMs`);
  assert.equal(Number(scenario.result?.stepCount) >= 1, true, `${scenario.id} missing prompt steps`);
  assert.equal(scenario.result?.promptRunStatus, "completed", `${scenario.id} prompt run not completed`);
  assert.equal(Number(scenario.result?.completedStepCount), Number(scenario.result?.stepCount), `${scenario.id} incomplete steps`);
  assert.equal(Number(scenario.result?.completedCapabilityJobCount) >= Number(scenario.result?.stepCount), true, `${scenario.id} missing jobs`);
  assert.equal(Number(scenario.result?.verificationNodeCount) >= 1, true, `${scenario.id} missing verifier nodes`);
  assert.equal(Number(scenario.result?.evalLedgerNodeCount) >= 1, true, `${scenario.id} missing eval ledger nodes`);
  assert.equal(Number(scenario.result?.promptPlanEvalStepCount) >= 1, true, `${scenario.id} missing prompt plan eval`);
  assert.equal(Number(scenario.result?.promptStepEvalStepCount) >= 1, true, `${scenario.id} missing prompt step eval`);
  assert.equal(Number(scenario.result?.browserDomObservationCount) >= 1, true, `${scenario.id} missing DOM observations`);
  if (scenario.intentClass !== "read_current_page") {
    assert.equal(Number(scenario.result?.perceptionGraphCount) >= 1, true, `${scenario.id} missing perception graph evidence`);
  }
  assert.equal(scenario.result?.cleanupRollbackCompleted, true, `${scenario.id} missing cleanup rollback`);
  assert.equal(hasSensitiveLiteral(scenario), false, `${scenario.id} has sensitive literal`);
}

assert.equal(Number(evidence.metrics?.successCount), evidence.scenarios.length);
assert.equal(Number(evidence.metrics?.p95LatencyMs) > 0, true);
console.log(`computer use browser prompt dogfood smoke ok: ${evidence.path}`);

function readLatestEvidence() {
  const root = join("docs", "reports", "assets");
  if (!existsSync(root)) {
    throw new Error("Missing docs/reports/assets.");
  }
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = /^computer-use-browser-prompt-dogfood-(\d{4}-\d{2}-\d{2})$/.exec(entry.name);
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
    throw new Error("Missing Computer Use browser prompt dogfood evidence. Run npm run dogfood:computer-use-browser first.");
  }
  return {
    ...latest.data,
    path: latest.path
  };
}

function hasSensitiveLiteral(value) {
  return /\b(password|token|cookie|secret|credential|api[_-]?key|authorization)\b/i.test(JSON.stringify(value));
}
