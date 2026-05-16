#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-one-time-profile-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const started = await postJson("/computer-use/sessions", {
    userRequest: "Click the current foreground app button with a one-time watch-mode profile.",
    requestedSurface: "foreground_desktop_watch",
    riskClass: "security_boundary",
    metadata: {
      requiresForeground: true
    }
  });
  assert.equal(started.ok, true);
  const sessionId = started.result.session.sessionId;

  const blocked = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    operation: {
      kind: "visual_desktop_action",
      action: {
        type: "click",
        x: 80,
        y: 120,
        button: "left"
      }
    },
    waitMs: 1000
  });
  assert.equal(blocked.ok, true);
  assert.equal(blocked.result.dagNode.status, "failed");

  const profilePayload = await postJson("/computer-use/autonomy/profiles", {
    name: "One-time foreground watch smoke",
    mode: "scoped_yolo",
    scope: "one_time",
    status: "active",
    maxUses: 1,
    grants: {
      network: false,
      networkDomains: [],
      browserAutomation: false,
      browserDomains: [],
      filesystem: { readRoots: [], writeRoots: [] },
      commands: { allowPrefixes: [], denyPatterns: [] },
      packageInstall: false,
      osMutation: false,
      generatedToolMaterialization: false,
      generatedToolExecution: false,
      generatedCode: false,
      credentialAccess: "never",
      riskClasses: ["high_risk"],
      maxRuntimeMs: 30000,
      maxOutputBytes: 2097152,
      maxIterations: 1
    }
  });
  assert.equal(profilePayload.ok, true);
  assert.equal(profilePayload.profile.scope, "one_time");
  assert.equal(profilePayload.profile.maxUses, 1);

  const attached = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/profile`, {
    profileId: profilePayload.profile.id,
    source: "smoke_computer_use_one_time_profile",
    reason: "Verify blocked run one-time profile attachment."
  });
  assert.equal(attached.ok, true);
  assert.equal(attached.session.profileId, profilePayload.profile.id);
  assert.equal(attached.session.state, "blocked");

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.bundle.session.profileId, profilePayload.profile.id);
  assert.equal(bundle.bundle.safetyDecisions.some((decision) =>
    decision?.decision === "profile_attached" &&
    decision.profileId === profilePayload.profile.id &&
    decision.profileScope === "one_time" &&
    decision.source === "smoke_computer_use_one_time_profile"
  ), true);

  const evalRun = await getJson(`/computer-use/eval/runs/${encodeURIComponent(bundle.bundle.session.evalRunId)}`);
  assert.equal(evalRun.ok, true);
  assert.equal(evalRun.steps.some((step) =>
    step.kind === "permission_profile_attached" &&
    step.status === "completed" &&
    step.output.profileScope === "one_time"
  ), true);

  console.log(`computer use one-time profile smoke ok on port ${daemon.port}`);
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
