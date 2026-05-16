#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const pageServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <title>Computer Use Browser Parity Smoke</title>
    <main>
      <form id="search-form" onsubmit="event.preventDefault(); const q = document.querySelector('#query').value; document.querySelector('#result').textContent = 'Result for ' + q; history.pushState({}, '', '/search?q=' + encodeURIComponent(q));">
        <label for="query">Search docs</label>
        <input id="query" name="q" type="search" value="${escapeHtml(url.searchParams.get("q") ?? "")}" />
        <button id="search-button" type="submit">Search</button>
      </form>
      <p id="result">Ready</p>
    </main>`);
});

await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${pageServer.address().port}/`;
const smokeAppData = useSmokeAppData("codex-widget-computer-use-browser-parity-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const started = await postJson("/computer-use/sessions", {
    userRequest: "격리 브라우저에서 Codex CLI 문서를 검색해줘",
    requestedSurface: "isolated_browser",
    profileId: "profile:browser-parity-smoke"
  });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.selectedSurface.kind, "isolated_browser");
  const sessionId = started.result.session.sessionId;
  const actionSessionId = `computer-session-browser-action:${sessionId}`;

  const readOperation = await postBrowserAction(sessionId, {
    actionSessionId,
    adapterId: "playwright",
    source: {
      kind: "controlled_browser",
      browser: "chromium",
      url: pageUrl
    },
    action: {
      type: "read",
      reason: "Prime Browser Action observation for stale-evidence recovery smoke."
    }
  });
  assert.equal(readOperation.result.job.status, "completed");
  await new Promise((resolve) => setTimeout(resolve, 325));

  const typeOperation = await postBrowserAction(sessionId, {
    actionSessionId,
    adapterId: "playwright",
    source: {
      kind: "controlled_browser",
      browser: "chromium",
      url: pageUrl
    },
    action: {
      type: "type",
      target: { kind: "element_id", id: "query" },
      text: "Codex CLI",
      clearFirst: true
    },
    requiresFreshObservation: true,
    maxEvidenceAgeMs: 250,
    expected: [
      { type: "element_state", target: { kind: "element_id", id: "query" }, state: { value: "Codex CLI" } }
    ]
  });
  assert.equal(typeOperation.result.job.kind, "browser_action");
  assert.equal(typeOperation.result.job.status, "completed");

  const clickOperation = await postBrowserAction(sessionId, {
    actionSessionId,
    adapterId: "playwright",
    source: {
      kind: "controlled_browser",
      browser: "chromium",
      url: pageUrl
    },
    action: {
      type: "click",
      target: { kind: "element_id", id: "search-button" }
    },
    expected: [
      { type: "text_visible", value: "Result for Codex CLI" },
      { type: "url_contains", value: "q=Codex%20CLI" }
    ]
  });
  assert.equal(clickOperation.result.job.status, "completed");

  const bundle = await waitForFollowupBundle(sessionId, [typeOperation.result.dagNode.id, clickOperation.result.dagNode.id]);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.bundle.capabilityJobs.filter((job) => job.kind === "browser_action" && job.status === "completed").length >= 2, true);
  const recoveryNode = bundle.bundle.dagNodes.find((node) =>
    node.id.includes(":browser-action-reobserve:") &&
    node.kind === "observe" &&
    node.status === "completed" &&
    node.output?.postRecoveryFreshness?.status === "ok"
  );
  assert.ok(recoveryNode);
  const evalRun = await getEvalRun(bundle.bundle.evalRun.id);
  assert.equal(evalRun.steps.some((step) =>
    step.kind === "browser_action_reobserve_recovery" &&
    step.status === "completed" &&
    step.capabilityDagNodeId === recoveryNode.id
  ), true);
  assertFollowupDagNodes(bundle, typeOperation.result.dagNode.id, typeOperation.result.job.id);
  assertFollowupDagNodes(bundle, clickOperation.result.dagNode.id, clickOperation.result.job.id);
  const clickDagNode = bundle.bundle.dagNodes.find((node) => node.id === clickOperation.result.dagNode.id);
  assert.equal(clickDagNode?.input?.actionRoute?.executionMode, "dom_playwright_locator");
  assert.equal(clickDagNode?.output?.actionRoute?.executionMode, "dom_playwright_locator");
  assert.equal(clickDagNode?.output?.actionRoute?.visualFallbackUsed, false);
  assert.equal(bundle.bundle.observations.some((observation) =>
    observation.kind === "browser_dom" &&
    observation.capabilityJobId === clickOperation.result.job.id &&
    observation.metadata?.verification === "passed" &&
    observation.metadata?.observationPhase === "post_action"
  ), true);
  assert.equal(bundle.bundle.observations.some((observation) =>
    observation.kind === "browser_dom" &&
    observation.capabilityJobId === clickOperation.result.job.id &&
    observation.metadata?.observationPhase === "pre_action"
  ), true);
  const clickPreObservation = bundle.bundle.observations.find((observation) =>
    observation.kind === "browser_dom" &&
    observation.capabilityJobId === clickOperation.result.job.id &&
    observation.metadata?.observationPhase === "pre_action"
  );
  assert.equal(clickPreObservation?.metadata?.targetEvidence?.schemaVersion, "computer-session-target-evidence.v1");
  assert.equal(clickPreObservation?.metadata?.targetEvidence?.allowed, true, JSON.stringify(clickPreObservation?.metadata?.targetEvidence, null, 2));
  assert.equal(clickPreObservation?.metadata?.targetEvidence?.risk, "side_effect");
  assert.equal(clickPreObservation?.metadata?.targetEvidence?.evidenceSources?.includes("dom"), true);
  assert.equal(clickPreObservation?.metadata?.targetEvidence?.evidenceClasses?.includes("dom_selector"), true);
  assert.equal(clickPreObservation?.metadata?.targetEvidence?.arbitration?.schemaVersion, "perception-target-arbitration.v1");
  assert.equal(clickPreObservation?.metadata?.targetEvidence?.arbitration?.candidateCount >= 1, true);
  assert.equal(clickPreObservation?.metadata?.targetEvidence?.arbitration?.selectedMatchReason, "element_id");
  assert.equal(bundle.bundle.perceptionGraphs.some((graph) =>
    (graph.source === "computer_session_browser_action_pre_action" || graph.source === "computer_session_browser_action_post_action") &&
    graph.nodes.length > 0
  ), true);
  const clickPreStep = evalRun.steps.find((step) =>
    step.kind === "browser_action_pre_action_observation" &&
    step.capabilityJobId === clickOperation.result.job.id
  );
  assert.equal(clickPreStep?.output?.targetEvidence?.allowed, true, JSON.stringify(clickPreStep?.output?.targetEvidence, null, 2));
  const clickFeedback = bundle.bundle.actionFeedbacks.find((feedback) => feedback.capabilityJobId === clickOperation.result.job.id);
  assert.equal(clickFeedback?.operationKind, "browser_action");
  assert.equal(clickFeedback?.actionType, "click");
  assert.equal(clickFeedback?.status, "completed");
  assert.equal(clickFeedback?.verifierStatus, "passed");
  assert.ok(clickFeedback?.beforeObservationId);
  assert.ok(clickFeedback?.afterObservationId);
  assert.ok(clickFeedback?.perceptionGraphId);
  assert.ok(clickFeedback?.evalStepId);
  const clickFeedbackStep = evalRun.steps.find((step) =>
    step.kind === "browser_action_feedback" &&
    step.capabilityJobId === clickOperation.result.job.id
  );
  assert.equal(clickFeedbackStep?.output?.feedbackId, clickFeedback?.id);
  assert.equal(clickFeedbackStep?.output?.verifierStatus, "passed");

  const cancelled = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/cancel`, { reason: "browser_parity_smoke_cleanup" });
  assert.equal(cancelled.ok, true);
  const cleanupBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(cleanupBundle.bundle.rollbackActions.some((action) => action.kind === "close_surface" && action.status === "completed"), true);

  console.log(`computer use browser parity smoke ok on ${pageUrl}`);
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

async function postBrowserAction(sessionId, input) {
  const payload = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    operation: {
      kind: "browser_action",
      input
    },
    waitMs: 8000
  });
  if (!payload.ok) {
    throw new Error(`browser_action operation failed: ${JSON.stringify(payload, null, 2)}`);
  }
  return payload;
}

async function waitForFollowupBundle(sessionId, actionNodeIds) {
  const deadline = Date.now() + 8000;
  let lastBundle;
  while (Date.now() < deadline) {
    lastBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
    const nodes = lastBundle.bundle.dagNodes;
    const ready = actionNodeIds.every((actionNodeId) =>
      nodes.some((node) => node.id === `${actionNodeId}:verification` && node.status === "completed") &&
      nodes.some((node) => node.id === `${actionNodeId}:eval_ledger` && node.status === "completed")
    );
    if (ready) {
      return lastBundle;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for Browser parity follow-up DAG nodes: ${JSON.stringify(lastBundle?.bundle?.dagNodes ?? [], null, 2)}`);
}

async function getEvalRun(runId) {
  const response = await fetch(`${baseUrl}/computer-use/eval/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) {
    throw new Error(`eval run ${runId} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

function assertFollowupDagNodes(bundle, actionNodeId, jobId) {
  const verification = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:verification`);
  const ledger = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:eval_ledger`);
  assert.equal(verification?.kind, "verification");
  assert.equal(verification?.status, "completed");
  assert.equal(verification?.capabilityJobId, jobId);
  assert.equal(ledger?.kind, "eval_ledger");
  assert.equal(ledger?.status, "completed");
  assert.equal(ledger?.capabilityJobId, jobId);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
