#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { finalizeEvalRunFromSteps } from "../dist/daemon/computer-use-eval/index.js";

const browserCorpus = "docs/dogfood/browser-action-semantic-live-corpus.jsonl";
const semanticCorpus = "docs/dogfood/semantic-trace-corpus.jsonl";
const windowsEvidence = "docs/reports/assets/windows-computer-use-high-risk-dogfood-2026-05-12/evidence.json";

const storage = createStorageService();
let imported = 0;
try {
  imported += importJsonl(browserCorpus, "browser-action-live");
  imported += importJsonl(semanticCorpus, "semantic-trace");
  if (existsSync(windowsEvidence)) {
    const evidence = JSON.parse(readFileSync(windowsEvidence, "utf8"));
    const run = storage.createComputerUseEvalRun({
      scenarioId: "windows-computer-use-high-risk-dogfood-2026-05-12",
      modalities: ["windows"],
      prompt: "Windows high-risk dogfood matrix",
      scenario: {
        id: "windows-computer-use-high-risk-dogfood-2026-05-12",
        title: "Windows high-risk dogfood matrix",
        modalities: ["windows"],
        source: windowsEvidence,
        tags: ["windows", "dogfood", "high_risk"]
      },
      metrics: {
        imported: true,
        evidenceKeys: Object.keys(evidence).length
      }
    });
    storage.appendComputerUseEvalStep({
      runId: run.id,
      kind: "windows_dogfood_import",
      phase: "completed",
      status: "completed",
      output: evidence,
      failureClass: "none"
    });
    finalizeEvalRunFromSteps({ storage, runId: run.id, taskSuccess: "passed", failureClass: "none" });
    imported += 1;
  }
  console.log(`computer use eval corpus imported: ${imported}`);
} finally {
  storage.close();
}

function importJsonl(file, source) {
  if (!existsSync(file)) return 0;
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  let count = 0;
  for (const [index, line] of lines.entries()) {
    const row = JSON.parse(line);
    const scenarioId = String(row.scenarioId ?? row.scenario ?? row.intentClass ?? `${source}-${index}`);
    const run = storage.createComputerUseEvalRun({
      scenarioId,
      modalities: ["browser"],
      prompt: String(row.prompt ?? row.redactedPrompt ?? row.utterance ?? ""),
      scenario: {
        id: scenarioId,
        title: String(row.title ?? scenarioId),
        modalities: ["browser"],
        source: file,
        tags: ["imported", source, String(row.intentClass ?? "unknown")]
      },
      metrics: {
        imported: true,
        success: row.success ?? row.taskSuccess,
        latencyMs: row.elapsedMs ?? row.latencyMs
      }
    });
    storage.appendComputerUseEvalStep({
      runId: run.id,
      kind: `${source}_import`,
      phase: "completed",
      status: row.success === false ? "failed" : "completed",
      output: row,
      elapsedMs: Number(row.elapsedMs ?? row.latencyMs ?? 0),
      failureClass: row.success === false ? "action_failed" : "none"
    });
    finalizeEvalRunFromSteps({
      storage,
      runId: run.id,
      taskSuccess: row.success === false ? "failed" : "passed",
      failureClass: row.success === false ? "action_failed" : "none"
    });
    count += 1;
  }
  return count;
}
