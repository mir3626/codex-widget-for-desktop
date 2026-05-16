#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-verifier-audit-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const started = await postJson("/computer-use/sessions", {
    userRequest: "Read visible text and audit failed verifier evidence.",
    requestedSurface: "isolated_browser",
    profileId: "profile:verifier-audit-smoke"
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
  assert.equal(operation.result.job.status, "completed");

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.bundle.verifierAudit?.schemaVersion, "computer-use-verifier-audit.v1");
  assert.equal(bundle.bundle.verifierAudit.falseNegativeRecords >= 1, true);
  assert.equal(bundle.bundle.verifierAudit.audits.some((audit) =>
    audit.auditClass === "false_negative_record" &&
    audit.capabilityJobId === operation.result.job.id &&
    audit.failureClass === "verification_false_negative" &&
    audit.evidence.recoveryAttempted === true
  ), true);

  const audit = await getJson(`/computer-use/eval/verifier-audit?sessionId=${encodeURIComponent(sessionId)}`);
  assert.equal(audit.ok, true);
  assert.equal(audit.audit.runsAudited, 1);
  assert.equal(audit.audit.falseNegativeRecords >= 1, true);
  assert.equal(audit.audit.falsePositiveCandidates, 0);
  assert.equal(audit.audit.audits.some((record) =>
    record.auditClass === "false_negative_record" &&
    record.capabilityJobId === operation.result.job.id
  ), true);

  const runAudit = await getJson(`/computer-use/eval/runs/${encodeURIComponent(bundle.bundle.evalRun.id)}/verifier-audit`);
  assert.equal(runAudit.ok, true);
  assert.equal(runAudit.audit.falseNegativeRecords >= 1, true);

  const inconclusiveStarted = await postJson("/computer-use/sessions", {
    userRequest: "Audit an unsupported verifier target.",
    requestedSurface: "isolated_browser",
    profileId: "profile:verifier-audit-inconclusive-smoke"
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
  const inconclusiveAudit = await getJson(`/computer-use/eval/verifier-audit?sessionId=${encodeURIComponent(inconclusiveSessionId)}`);
  assert.equal(inconclusiveAudit.ok, true);
  assert.equal(inconclusiveAudit.audit.inconclusiveRecords >= 1, true);
  assert.equal(inconclusiveAudit.audit.audits.some((record) =>
    record.auditClass === "inconclusive_verifier" &&
    record.capabilityJobId === inconclusiveOperation.result.job.id &&
    record.evidence.taskSuccess === "failed"
  ), true);

  const readiness = await getJson("/computer-use/eval/readiness");
  assert.equal(readiness.ok, true);
  assert.equal(readiness.readiness.verifierAudit.schemaVersion, "computer-use-verifier-audit.v1");
  assert.equal(readiness.readiness.verifierAudit.falseNegativeRecords >= 1, true);
  assert.equal(readiness.readiness.verifierAudit.inconclusiveRecords >= 1, true);

  console.log(`computer use verifier audit smoke ok on port ${daemon.port}`);
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
