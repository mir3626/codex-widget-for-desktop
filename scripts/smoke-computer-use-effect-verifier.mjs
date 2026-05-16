#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-effect-verifier-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const started = await postJson("/computer-use/sessions", {
    userRequest: "Read the visible text and verify the expected phrase.",
    requestedSurface: "isolated_browser",
    profileId: "profile:effect-verifier-smoke"
  });
  assert.equal(started.ok, true);
  const sessionId = started.result.session.sessionId;

  const operation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    operation: {
      kind: "ocr",
      input: {
        text: "actual visible text",
        expectedOutcome: "text contains expected phrase"
      }
    },
    waitMs: 8000
  });
  assert.equal(operation.ok, true);
  assert.equal(operation.result.job.kind, "ocr");
  assert.equal(operation.result.job.status, "completed");

  const session = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}`);
  assert.equal(session.ok, true);
  assert.equal(session.session.state, "failed");
  assert.match(session.session.blockedReason, /did not contain expected text/);

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  const verifier = bundle.bundle.verifierResults.find((result) => result.capabilityJobId === operation.result.job.id);
  assert.equal(verifier?.status, "failed");
  assert.equal(verifier?.failureClass, "verification_false_negative");
  assert.equal(verifier?.recovery?.attempted, true);
  const effectStep = bundle.bundle.evalRun && await getEvalRun(bundle.bundle.evalRun.id);
  assert.equal(effectStep.steps.some((step) =>
    step.kind === "effect_verification" &&
    step.status === "failed" &&
    step.capabilityJobId === operation.result.job.id
  ), true);
  assert.equal(effectStep.steps.some((step) =>
    step.kind === "recovery_attempt" &&
    step.status === "skipped"
  ), true);
  assert.equal(bundle.bundle.dagNodes.some((node) =>
    node.kind === "fallback" &&
    node.id.includes(":recovery:") &&
    node.status === "skipped"
  ), true);
  assert.equal(bundle.bundle.failureMemory.some((record) =>
    record.failureClass === "verification_false_negative" &&
    record.provenance.capabilityJobId === operation.result.job.id &&
    record.safety.mayCompleteTask === false &&
    record.safety.proofSource === false
  ), true);

  const inconclusiveStarted = await postJson("/computer-use/sessions", {
    userRequest: "Read text and require an unsupported verifier target.",
    requestedSurface: "isolated_browser",
    profileId: "profile:effect-verifier-inconclusive-smoke"
  });
  assert.equal(inconclusiveStarted.ok, true);
  const inconclusiveSessionId = inconclusiveStarted.result.session.sessionId;
  const inconclusiveOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(inconclusiveSessionId)}/operations`, {
    operation: {
      kind: "ocr",
      input: {
        text: "actual visible text",
        expectedOutcome: "window title equals expected phrase"
      }
    },
    waitMs: 8000
  });
  assert.equal(inconclusiveOperation.ok, true);
  assert.equal(inconclusiveOperation.result.job.status, "completed");
  const inconclusiveSession = await getJson(`/computer-use/sessions/${encodeURIComponent(inconclusiveSessionId)}`);
  assert.equal(inconclusiveSession.ok, true);
  assert.equal(inconclusiveSession.session.state, "failed");
  assert.match(inconclusiveSession.session.blockedReason, /no explicit verifier proof/i);
  const inconclusiveBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(inconclusiveSessionId)}/debug-bundle`);
  assert.equal(inconclusiveBundle.ok, true);
  const inconclusiveVerifier = inconclusiveBundle.bundle.verifierResults.find((result) =>
    result.capabilityJobId === inconclusiveOperation.result.job.id
  );
  assert.equal(inconclusiveVerifier?.status, "inconclusive");
  assert.equal(inconclusiveVerifier?.failureClass, "verification_false_negative");
  assert.equal(inconclusiveBundle.bundle.evalRun.taskSuccess, "failed");
  assert.equal(inconclusiveBundle.bundle.verifierAudit.audits.some((audit) =>
    audit.auditClass === "inconclusive_verifier" &&
    audit.capabilityJobId === inconclusiveOperation.result.job.id &&
    audit.evidence.taskSuccess === "failed"
  ), true);

  console.log(`computer use effect verifier smoke ok on port ${daemon.port}`);
} finally {
  await daemon.close();
  smokeAppData.cleanup();
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function getEvalRun(runId) {
  const response = await fetch(`${baseUrl}/computer-use/eval/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) {
    throw new Error(`eval steps returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}
