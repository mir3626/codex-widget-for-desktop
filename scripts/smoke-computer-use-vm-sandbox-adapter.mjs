#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { listVmSandboxAdapters, buildFutureVmSessionBoundary } from "../dist/daemon/computer-use/vmSandboxAdapter.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const adapters = listVmSandboxAdapters();
assert.equal(adapters.length >= 5, true);
assert.equal(adapters.some((adapter) => adapter.kind === "windows_sandbox"), true);
assert.equal(adapters.some((adapter) => adapter.kind === "hyper_v"), true);
assert.equal(adapters.some((adapter) => adapter.kind === "rdp"), true);
assert.equal(adapters.some((adapter) => adapter.kind === "cloud"), true);
assert.equal(adapters.every((adapter) => adapter.vmCreated === false && adapter.hostMutationAllowed === false), true);

const boundary = buildFutureVmSessionBoundary({
  userRequest: "Run in a future VM",
  requestedSurface: "future_vm_session",
  metadata: { vmAdapter: "hyper_v" }
});
assert.equal(boundary.schemaVersion, "future-vm-session-boundary.v1");
assert.equal(boundary.reason, "future_vm_session_backend_not_available");
assert.equal(boundary.selectedAdapter, "hyper_v");
assert.equal(boundary.vmCreated, false);
assert.equal(boundary.hostMutationAllowed, false);
assert.equal(boundary.missingPreconditions.some((item) => item.id === "vm_backend_provider"), true);

const smokeAppData = useSmokeAppData("codex-widget-vm-sandbox-adapter-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
try {
  const started = await postJson("/computer-use/sessions", {
    userRequest: "Run a risky workflow inside Hyper-V.",
    requestedSurface: "future_vm_session",
    riskClass: "security_boundary",
    metadata: { vmAdapter: "hyper_v" }
  });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.state, "blocked");
  const sessionId = started.result.session.sessionId;
  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.bundle.safetyDecisions.some((decision) =>
    decision?.vmSandboxAdapterBoundary?.selectedAdapter === "hyper_v" &&
    decision.vmSandboxAdapterBoundary.vmCreated === false
  ), true);
  assert.equal(bundle.bundle.observations.some((observation) =>
    observation.metadata?.vmSandboxAdapterBoundary?.adapters?.some((adapter) => adapter.kind === "windows_sandbox")
  ), true);
  console.log(`computer use VM sandbox adapter smoke ok on port ${daemon.port}`);
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
