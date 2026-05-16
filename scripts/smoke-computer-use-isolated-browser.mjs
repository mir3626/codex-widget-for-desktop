#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const pageServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <title>Computer Use Isolated Browser Smoke</title>
    <main>
      <button id="popular-posts" type="button" onclick="document.querySelector('#first-post').style.display='inline-block';document.querySelector('#status').textContent='popular opened'">인기글</button>
      <a id="first-post" href="#first-post-opened" style="display:none" onclick="document.querySelector('#status').textContent='first post opened'">1번째 글</a>
      <p id="status">closed</p>
    </main>`);
});

await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${pageServer.address().port}/`;
const smokeAppData = useSmokeAppData("codex-widget-computer-use-isolated-browser-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const started = await postJson("/computer-use/sessions", {
    userRequest: "격리 브라우저에서 인기글을 열고 첫 번째 글을 보여줘",
    requestedSurface: "isolated_browser",
    profileId: "profile:isolated-browser-smoke"
  });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.selectedSurface.kind, "isolated_browser");

  const sessionId = started.result.session.sessionId;
  const prompt = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/browser-action-prompt`, {
    text: "인기글 버튼을 누른 뒤 첫 번째 글 보여줘 full_control_dev",
    mode: "browser",
    source: {
      kind: "controlled_browser",
      browser: "chromium",
      url: pageUrl
    }
  });
  assert.equal(prompt.ok, true);
  assert.equal(prompt.result.plan.adapterId, "playwright");
  assert.equal(prompt.result.plan.source.kind, "controlled_browser");
  assert.equal(prompt.result.plan.steps.length, 2);
  if (prompt.result.operation.job.status !== "completed") {
    throw new Error(`Expected isolated browser prompt operation to complete: ${JSON.stringify(prompt.result, null, 2)}`);
  }

  const bundle = await waitForPromptRun(sessionId, prompt.result.promptRun.id, "completed");
  const promptRun = bundle.bundle.promptRuns.find((run) => run.id === prompt.result.promptRun.id);
  assert.equal(promptRun?.status, "completed");
  assert.equal(promptRun?.steps.length, 2);
  assert.equal(promptRun?.steps.every((step) => step.status === "completed"), true);
  assert.equal(bundle.bundle.capabilityJobs.filter((job) => job.kind === "browser_action" && job.status === "completed").length >= 2, true);

  const cancelled = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/cancel`, { reason: "isolated_browser_smoke_cleanup" });
  assert.equal(cancelled.ok, true);
  const cleanupBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(cleanupBundle.bundle.safetyDecisions.some((decision) => decision.phase === "surface_cleanup" && decision.surface === "isolated_browser"), true);
  assert.equal(cleanupBundle.bundle.rollbackActions.some((action) => action.kind === "close_surface" && action.status === "completed"), true);

  console.log(`computer use isolated browser smoke ok on ${pageUrl}`);
} finally {
  await daemon.close();
  pageServer.close();
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

async function waitForPromptRun(sessionId, promptRunId, status) {
  const deadline = Date.now() + 5000;
  let bundle;
  while (Date.now() < deadline) {
    bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
    const promptRun = bundle.bundle.promptRuns.find((candidate) => candidate.id === promptRunId);
    if (promptRun?.status === status) {
      return bundle;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for prompt run ${promptRunId} to reach ${status}: ${JSON.stringify(bundle?.bundle?.promptRuns ?? [], null, 2)}`);
}
