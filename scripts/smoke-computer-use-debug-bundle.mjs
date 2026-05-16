#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-debug-bundle-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const started = await postJson("/computer-use/sessions", {
    userRequest: "Use a disposable VM to inspect an unknown Windows app and report the result.",
    requestedSurface: "future_vm_session",
    riskClass: "security_boundary",
    metadata: {
      requiresVmIsolation: true,
      debugBundleSmoke: true
    }
  });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.state, "blocked");

  const sessionId = started.result.session.sessionId;
  const response = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(response.ok, true);
  const bundle = response.bundle;

  assert.equal(bundle.schemaVersion, "computer-session-debug-bundle.v1");
  assert.equal(bundle.session.sessionId, sessionId);
  assert.equal(bundle.session.selectedSurface.kind, "future_vm_session");
  assert.equal(bundle.session.state, "blocked");
  assert.equal(bundle.evalRun.status, "failed");
  assert.equal(bundle.evalRun.taskSuccess, "blocked");
  assert.equal(bundle.dagRun.status, "failed");
  assert.equal(bundle.redaction.credentials, "redacted");
  assert.equal(bundle.redaction.browserHistory, "redacted_by_default");
  assert.equal(bundle.redaction.localPaths, "minimized");
  assert.equal(bundle.redaction.screenshots, "blob_retention_policy");

  assert.equal(Array.isArray(bundle.dagNodes), true);
  assert.equal(Array.isArray(bundle.capabilityJobs), true);
  assert.equal(Array.isArray(bundle.evalResources), true);
  assert.equal(Array.isArray(bundle.perceptionGraphs), true);
  assert.equal(Array.isArray(bundle.failureMemory), true);
  assert.equal(Array.isArray(bundle.promptRuns), true);
  assert.equal(Array.isArray(bundle.observations), true);
  assert.equal(Array.isArray(bundle.actionFeedbacks), true);
  assert.equal(Array.isArray(bundle.actionBatches), true);
  assert.equal(Array.isArray(bundle.rollbackActions), true);
  assert.equal(Array.isArray(bundle.safetyDecisions), true);
  assert.equal(Array.isArray(bundle.verifierResults), true);
  assert.ok(bundle.freshnessSummary);

  assert.equal(bundle.capabilityJobs.length, 0);
  assert.equal(bundle.dagNodes.some((node) =>
    node.kind === "setup" &&
    node.status === "failed" &&
    node.output?.reason === "future_vm_session_backend_not_available"
  ), true);
  assert.equal(bundle.dagNodes.some((node) => node.kind === "eval_ledger" && node.status === "failed"), true);
  assert.equal(bundle.safetyDecisions.some((decision) =>
    decision?.phase === "future_vm_session_preconditions" &&
    decision.vmCreated === false &&
    decision.hostMutationAllowed === false
  ), true);
  assert.equal(bundle.observations.some((observation) =>
    observation.source === "future_vm_session_boundary" &&
    observation.redaction?.screenshots === "not_stored" &&
    observation.redaction?.localPaths === "not_stored"
  ), true);
  assert.equal(bundle.rollbackActions.some((action) =>
    action.kind === "none_available" &&
    action.status === "skipped" &&
    action.reason === "no_vm_session_was_created"
  ), true);
  assert.equal(bundle.verifierResults.some((verifier) =>
    verifier?.status === "failed" &&
    verifier.vmCreated === false &&
    verifier.hostMutationAllowed === false
  ), true);
  assert.equal(bundle.failureMemory.some((record) =>
    record.failureClass === "external_blocker" &&
    record.safety.mayCompleteTask === false &&
    record.safety.proofSource === false &&
    record.calibration.abstentionTriggers?.includes("future_vm_session_backend_not_available")
  ), true);

  const serialized = JSON.stringify(bundle);
  assert.equal(serialized.includes("Use a disposable VM"), true);
  assert.equal(/password\s*[:=]/i.test(serialized), false);
  assert.equal(/api[_-]?key\s*[:=]/i.test(serialized), false);

  console.log(`computer use debug bundle smoke ok on port ${daemon.port}`);
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
