#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-vm-sandbox-boundary-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const started = await postJson("/computer-use/sessions", {
    userRequest: "Run this risky Windows app workflow inside an isolated disposable VM session.",
    requestedSurface: "future_vm_session",
    riskClass: "security_boundary",
    metadata: {
      requiresVmIsolation: true,
      requiresNetwork: true
    }
  });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.selectedSurface.kind, "future_vm_session");
  assert.equal(started.result.session.state, "blocked");
  assert.equal(started.result.session.blockedReason, "future_vm_session_backend_not_available");
  assert.equal(started.result.evalRun.status, "failed");
  assert.equal(started.result.evalRun.taskSuccess, "blocked");
  assert.equal(started.result.evalRun.failureClass, "external_blocker");
  assert.equal(started.result.dagRun.status, "failed");

  const sessionId = started.result.session.sessionId;
  const surfaceNode = started.result.dagNodes.find((node) => node.id === `${sessionId}:surface_select`);
  assert.equal(surfaceNode?.kind, "setup");
  assert.equal(surfaceNode?.status, "failed");
  assert.equal(surfaceNode?.output?.reason, "future_vm_session_backend_not_available");
  assert.equal(surfaceNode?.output?.vmCreated, false);
  assert.equal(surfaceNode?.output?.hostMutationAllowed, false);
  assert.equal(surfaceNode?.output?.missingPreconditions.some((item) => item.id === "vm_backend_provider"), true);

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.bundle.capabilityJobs.length, 0);
  assert.equal(bundle.bundle.safetyDecisions.some((decision) =>
    decision?.phase === "future_vm_session_preconditions" &&
    decision.vmCreated === false &&
    decision.hostMutationAllowed === false
  ), true);
  assert.equal(bundle.bundle.observations.some((observation) =>
    observation.source === "future_vm_session_boundary" &&
    observation.metadata?.vmCreated === false &&
    observation.metadata?.hostMutationAllowed === false
  ), true);
  assert.equal(bundle.bundle.rollbackActions.some((action) =>
    action.kind === "none_available" &&
    action.status === "skipped" &&
    action.reason === "no_vm_session_was_created"
  ), true);
  assert.equal(bundle.bundle.verifierResults.some((verifier) =>
    verifier?.id === `verifier:${sessionId}:surface_select` &&
    verifier.status === "failed" &&
    verifier.vmCreated === false
  ), true);
  assert.equal(bundle.bundle.failureMemory.some((record) =>
    record.failureClass === "external_blocker" &&
    record.provenance.evalRunId === bundle.bundle.session.evalRunId &&
    record.safety.mayCompleteTask === false &&
    record.safety.proofSource === false &&
    record.calibration.abstentionTriggers?.includes("future_vm_session_backend_not_available")
  ), true);
  assert.equal(bundle.bundle.evalRun?.metrics?.vmCreated, false);
  assert.equal(bundle.bundle.evalRun?.metrics?.hostMutationAllowed, false);

  console.log(`computer use VM sandbox boundary smoke ok on port ${daemon.port}`);
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
