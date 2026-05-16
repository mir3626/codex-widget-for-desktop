#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";
const ASYNC_DAG_WAIT_MS = 15_000;

const smokeAppData = useSmokeAppData("codex-widget-computer-use-http-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const beforeSnapshot = createSnapshot("before");
const afterSnapshot = createSnapshot("after");

try {
  await postJson("/providers/dom/snapshot", beforeSnapshot);
  const surfaces = await getJson("/computer-use/surfaces");
  assert.equal(surfaces.ok, true);
  assert.equal(surfaces.surfaces.some((surface) => surface.kind === "isolated_browser"), true);
  assert.equal(surfaces.surfaces.some((surface) => surface.kind === "foreground_desktop_watch"), true);

  const started = await postJson("/computer-use/sessions", {
    userRequest: "OpenAI docs 조사해서 PDF 보고서로 저장해줘",
    profileId: "profile:http-smoke",
    metadata: {
      createsLocalArtifact: true
    }
  });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.state, "completed");
  assert.equal(started.result.session.selectedSurface.kind, "tool_workspace");

  const sessionId = started.result.session.sessionId;
  const readSession = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}`);
  assert.equal(readSession.ok, true);
  assert.equal(readSession.session.sessionId, sessionId);

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.bundle.schemaVersion, "computer-session-debug-bundle.v1");
  assert.equal(bundle.bundle.dagNodes.length, 5);
  assert.equal(Array.isArray(bundle.bundle.promptRuns), true);
  assert.equal(bundle.bundle.redaction.credentials, "redacted");

  const operation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    operation: {
      kind: "browser_action",
      input: {
        action: { type: "read", reason: "http operation smoke" }
      }
    }
  });
  assert.equal(operation.ok, true);
  assert.equal(operation.result.job.kind, "browser_action");
  assert.equal(operation.result.job.status, "completed");

  const clickOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    operation: {
      kind: "browser_action",
      input: {
        action: { type: "click", target: { kind: "element_id", id: "open-details" } }
      }
    }
  });
  assert.equal(clickOperation.ok, true);
  assert.equal(clickOperation.result.job.kind, "browser_action");
  assert.equal(clickOperation.result.job.status, "queued");
  const command = await pollBrowserActionCommand();
  assert.equal(command?.requestId, clickOperation.result.job.id.replace(/^browser-action:/, ""));
  await postBrowserActionResult(command.requestId, true, beforeSnapshot, afterSnapshot);
  const completedClick = await waitForCapabilityJobStatus(clickOperation.result.job.id, "completed");
  assert.equal(completedClick.job.status, "completed");
  const postClickBundle = await waitForDagNode(sessionId, clickOperation.result.dagNode.id, "completed");
  const clickNode = postClickBundle.bundle.dagNodes.find((node) => node.id === clickOperation.result.dagNode.id);
  assert.equal(clickNode?.status, "completed");
  assert.equal(clickNode?.capabilityJobId, clickOperation.result.job.id);
  assert.equal(postClickBundle.bundle.perceptionGraphs.some((graph) =>
    graph.source === "computer_session_browser_action_pre_action" ||
    graph.source === "computer_session_browser_action_post_action"
  ), true);
  assert.equal(postClickBundle.bundle.evalResources.some((resource) => resource.role === "perception_graph"), true);
  assert.equal(postClickBundle.bundle.observations.some((observation) =>
    observation.kind === "browser_dom" &&
    observation.capabilityJobId === clickOperation.result.job.id &&
    observation.metadata?.observationPhase === "post_action" &&
    typeof observation.perceptionGraphId === "string"
  ), true);
  assert.equal(postClickBundle.bundle.observations.some((observation) =>
    observation.kind === "browser_dom" &&
    observation.capabilityJobId === clickOperation.result.job.id &&
    observation.metadata?.observationPhase === "pre_action" &&
    typeof observation.perceptionGraphId === "string"
  ), true);

  const promptOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/browser-action-prompt`, {
    text: "details 버튼 클릭",
    mode: "browser"
  });
  assert.equal(promptOperation.ok, true);
  if (promptOperation.result.operation.job.status !== "queued") {
    throw new Error(`Prompt Browser Action did not queue: ${JSON.stringify(promptOperation.result, null, 2)}`);
  }
  assert.equal(promptOperation.result.plan.steps[0].action.type, "click");
  assert.equal(promptOperation.result.operation.job.kind, "browser_action");
  assert.equal(promptOperation.result.operation.job.status, "queued");
  const promptCommand = await pollBrowserActionCommand();
  assert.equal(promptCommand?.requestId, promptOperation.result.operation.job.id.replace(/^browser-action:/, ""));
  await postBrowserActionResult(promptCommand.requestId, true, beforeSnapshot, afterSnapshot);
  const completedPromptClick = await waitForCapabilityJobStatus(promptOperation.result.operation.job.id, "completed");
  assert.equal(completedPromptClick.job.status, "completed");
  const postPromptBundle = await waitForDagNode(sessionId, promptOperation.result.operation.dagNode.id, "completed");
  const promptNode = postPromptBundle.bundle.dagNodes.find((node) => node.id === promptOperation.result.operation.dagNode.id);
  assert.equal(promptNode?.status, "completed");
  await waitForFollowupDagNodes(sessionId, promptOperation.result.operation.dagNode.id, promptOperation.result.operation.job.id);
  assert.equal(postPromptBundle.bundle.evalRun.status, "completed");
  const singleStepRun = postPromptBundle.bundle.promptRuns.find((run) => run.id === promptOperation.result.promptRun.id);
  assert.equal(singleStepRun?.status, "completed");
  assert.equal(singleStepRun?.steps.length, 1);

  const multiPromptOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/browser-action-prompt`, {
    text: "인기글 버튼을 누른 뒤 첫 번째 글 보여줘",
    mode: "browser"
  });
  assert.equal(multiPromptOperation.ok, true);
  assert.equal(multiPromptOperation.result.plan.steps.length, 2);
  assert.equal(multiPromptOperation.result.operation.job.status, "queued");
  const firstMultiCommand = await pollBrowserActionCommand();
  assert.equal(firstMultiCommand?.requestId, multiPromptOperation.result.operation.job.id.replace(/^browser-action:/, ""));
  await postBrowserActionResult(firstMultiCommand.requestId, true, beforeSnapshot, afterSnapshot);
  const secondMultiCommand = await pollBrowserActionCommand();
  assert.notEqual(secondMultiCommand?.requestId, firstMultiCommand.requestId);
  await postBrowserActionResult(secondMultiCommand.requestId, true, afterSnapshot, afterSnapshot);
  const multiPromptBundle = await waitForPromptRun(sessionId, multiPromptOperation.result.promptRun.id, "completed");
  const multiPromptRun = multiPromptBundle.bundle.promptRuns.find((run) => run.id === multiPromptOperation.result.promptRun.id);
  assert.equal(multiPromptRun?.status, "completed");
  assert.equal(multiPromptRun?.steps.length, 2);
  assert.equal(multiPromptRun?.steps.every((step) => step.status === "completed"), true);
  const multiStepNodes = multiPromptRun.steps.map((step) => step.dagNodeId).filter(Boolean);
  assert.equal(multiStepNodes.length, 2);
  for (const nodeId of multiStepNodes) {
    const step = multiPromptRun.steps.find((candidate) => candidate.dagNodeId === nodeId);
    await waitForFollowupDagNodes(sessionId, nodeId, step.capabilityJobId);
  }

  const listed = await getJson("/computer-use/sessions");
  assert.equal(listed.ok, true);
  assert.equal(listed.sessions.some((session) => session.sessionId === sessionId), true);

  const cancelled = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/cancel`, { reason: "http_smoke_cleanup" });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.session.state, "cancelled");

  console.log(`computer use session http smoke ok on port ${daemon.port}`);
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

async function pollBrowserActionCommand() {
  const response = await fetch(`${baseUrl}/browser-action/extension/poll`);
  if (!response.ok) {
    throw new Error(`Browser Action poll failed (${response.status}): ${await response.text()}`);
  }
  const payload = await response.json();
  return payload.command ?? null;
}

async function postBrowserActionResult(requestId, ok, before, after, error) {
  const response = await fetch(`${baseUrl}/browser-action/extension/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, ok, before, after, error })
  });
  if (!response.ok) {
    throw new Error(`Browser Action result POST failed (${response.status}): ${await response.text()}`);
  }
}

async function waitForDagNode(sessionId, nodeId, status) {
  const deadline = Date.now() + ASYNC_DAG_WAIT_MS;
  let bundle;
  while (Date.now() < deadline) {
    bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
    const node = bundle.bundle.dagNodes.find((candidate) => candidate.id === nodeId);
    if (node?.status === status) {
      return bundle;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for DAG node ${nodeId} to reach ${status}: ${JSON.stringify(bundle?.bundle?.dagNodes ?? [], null, 2)}`);
}

async function waitForPromptRun(sessionId, promptRunId, status) {
  const deadline = Date.now() + ASYNC_DAG_WAIT_MS;
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

async function waitForCapabilityJobStatus(jobId, status) {
  const deadline = Date.now() + ASYNC_DAG_WAIT_MS;
  let job;
  while (Date.now() < deadline) {
    job = await getJson(`/capabilities/jobs/${encodeURIComponent(jobId)}`);
    if (job.job?.status === status) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for capability job ${jobId} to reach ${status}: ${JSON.stringify(job?.job ?? null, null, 2)}`);
}

function createSnapshot(state) {
  return {
    url: `https://example.test/computer-use/${state}`,
    title: "Computer Use Session HTTP Smoke",
    readyState: "complete",
    viewport: { width: 1280, height: 720, scrollX: 0, scrollY: state === "after" ? 120 : 0, devicePixelRatio: 1 },
    focusedElementId: "search-box",
    selection: "",
    text: state === "after" ? "Details opened after safe click" : "Computer use test page with controls",
    elements: [
      {
        id: "search-box",
        role: "textbox",
        tagName: "input",
        label: "Search docs",
        value: "",
        selector: "#search",
        bbox: { x: 20, y: 20, w: 260, h: 36 },
        visible: true,
        enabled: true,
        editable: true,
        inputType: "search",
        confidence: 0.96,
        riskHints: []
      },
      {
        id: "open-details",
        role: "button",
        tagName: "button",
        label: "details",
        text: "details",
        selector: "#open-details",
        bbox: { x: 20, y: 84, w: 140, h: 40 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      },
      {
        id: "popular-posts",
        role: "button",
        tagName: "button",
        label: "인기글",
        text: "인기글",
        selector: "#popular-posts",
        bbox: { x: 180, y: 84, w: 140, h: 40 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      },
      {
        id: "first-post",
        role: "link",
        tagName: "a",
        label: "1번째 글",
        text: "1번째 글",
        selector: "#first-post",
        bbox: { x: 20, y: 144, w: 220, h: 34 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      }
    ]
  };
}

async function waitForFollowupDagNodes(sessionId, actionNodeId, jobId) {
  const deadline = Date.now() + ASYNC_DAG_WAIT_MS;
  let bundle;
  while (Date.now() < deadline) {
    bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
    if (hasFollowupDagNodes(bundle, actionNodeId, jobId)) {
      return bundle;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for follow-up DAG nodes for ${actionNodeId}: ${JSON.stringify(bundle?.bundle?.dagNodes ?? [], null, 2)}`);
}

function hasFollowupDagNodes(bundle, actionNodeId, jobId) {
  const verification = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:verification`);
  const ledger = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:eval_ledger`);
  return verification?.kind === "verification" &&
    verification.status === "completed" &&
    verification.capabilityJobId === jobId &&
    ledger?.kind === "eval_ledger" &&
    ledger.status === "completed" &&
    ledger.capabilityJobId === jobId;
}
