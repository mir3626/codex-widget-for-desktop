import assert from "node:assert/strict";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import {
  recordPromptBrowserActionEvalCheckpoint,
  recordPromptBrowserActionTimingSummary
} from "../dist/daemon/server/browser-action/promptEvalLedger.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

const smokeAppData = useSmokeAppData("codex-widget-browser-action-real-use-regressions");
const storage = createStorageService();

try {
  const session = storage.createSession({
    id: "session-real-use-smoke",
    title: "Browser Action real-use smoke"
  });
  const evalRun = storage.createComputerUseEvalRun({
    scenarioId: "browser-action:real-use-regression",
    sessionId: session.id,
    modalities: ["browser"],
    prompt: "개념글 눌러줘",
    scenario: {
      id: "browser-action:real-use-regression",
      title: "Browser Action real-use eval finalization regression",
      modalities: ["browser"],
      source: "smoke",
      expectedOutcome: [{ type: "custom", description: "Extension result updates eval run after queued command completes." }]
    },
    metrics: {
      plannedSteps: 1,
      firstAction: "click"
    }
  });
  const context = {
    evalRunId: evalRun.id,
    perceptionGraphId: "perception-graph-smoke",
    transactionId: "browser-transaction-smoke"
  };
  const plan = createPlan("paused");
  const pendingResult = createResult("pending");
  const timingSource = {
    timings: [
      { name: "transaction_started", elapsedMs: 0, at: new Date().toISOString(), phase: "perceiving" },
      { name: "plan_execution_completed", elapsedMs: 42, at: new Date().toISOString(), phase: "verifying" }
    ]
  };

  const checkpoint = recordPromptBrowserActionEvalCheckpoint({
    storage,
    sessionId: session.id,
    context,
    plan,
    results: [pendingResult],
    timingSource,
    terminal: false
  });
  assert.equal(checkpoint, undefined, "paused extension command must not finalize the eval run");
  assert.equal(storage.readComputerUseEvalRun(evalRun.id).status, "running", "eval run should remain running while extension command is pending");

  plan.status = "completed";
  plan.steps[0].status = "succeeded";
  const succeededResult = createResult("succeeded");
  const completed = recordPromptBrowserActionEvalCheckpoint({
    storage,
    sessionId: session.id,
    context,
    plan,
    results: [succeededResult],
    timingSource,
    terminal: true
  });
  assert.equal(completed?.status, "completed", "final extension success should complete the eval run");
  assert.equal(completed?.taskSuccess, "passed", "final extension success should be a passed task");
  assert.equal(completed?.failureClass, "none", "final extension success should not leave action_failed");
  assert.equal(completed?.metrics.actionCount, 1, "eval metrics should count the executed extension action");
  assert.equal(completed?.metrics.proofRecorded, true, "verification evidence should be counted as proof");

  recordPromptBrowserActionTimingSummary({
    storage,
    sessionId: session.id,
    context,
    plan,
    timingSource,
    completedEval: completed
  });
  const activities = storage.readLedgerSnapshot(session.id).activities;
  assert.equal(activities.some((activity) => activity.category === "browser-action" && activity.summary === "Browser Action timing summary"), true);

  console.log("browser action real-use regressions smoke ok");
} finally {
  storage.close();
  smokeAppData.cleanup();
}

function createPlan(status) {
  return {
    id: "browser-plan-real-use-smoke",
    actionSessionId: "browser-action-prompt-real-use-smoke",
    createdAt: new Date().toISOString(),
    goal: "개념글 눌러줘",
    status,
    confidence: 0.9,
    steps: [{
      id: "step-1",
      action: { type: "click", target: { kind: "text", role: "button", text: "개념글" } },
      targetSummary: "button: 개념글",
      status: status === "completed" ? "succeeded" : "awaiting_extension",
      resultId: "browser-result-real-use-smoke"
    }]
  };
}

function createResult(status) {
  return {
    id: "browser-result-real-use-smoke",
    actionSessionId: "browser-action-prompt-real-use-smoke",
    action: { type: "click", target: { kind: "text", role: "button", text: "개념글" } },
    startedAt: new Date().toISOString(),
    completedAt: status === "pending" ? undefined : new Date().toISOString(),
    status,
    safety: {
      decision: "allow",
      risk: "low",
      reason: "smoke",
      actionLabel: "click",
      targetSummary: "button 개념글",
      destructive: false
    },
    target: {
      id: "concept-filter",
      role: "button",
      tagName: "button",
      label: "개념글",
      text: "개념글",
      visible: true,
      enabled: true,
      confidence: 0.96,
      riskHints: []
    },
    verification: {
      status: status === "succeeded" ? "passed" : "unknown",
      reason: status === "succeeded" ? "Action changed the browser route or URL." : "Waiting for extension result."
    },
    transaction: {
      transactionId: "browser-transaction-smoke",
      candidateId: "browser-candidate-smoke"
    }
  };
}
