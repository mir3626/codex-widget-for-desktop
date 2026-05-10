import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const date = "2026-05-10";
const reportPath = join("docs", "reports", `browser-perception-dogfood-evidence-${date}.md`);
const assetPath = join("docs", "reports", "assets", `browser-perception-${date}`, "evidence.json");
const smokeAppData = useSmokeAppData("codex-widget-browser-perception-dogfood");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
const waiters = [];
const evidence = {
  generatedAt: new Date().toISOString(),
  scenario: "request-scoped observe_now before prompt Browser Action",
  steps: [],
  result: "unknown"
};

socket.on("message", (raw) => {
  const event = JSON.parse(raw.toString());
  events.push(event);
  for (const waiter of [...waiters]) {
    if (waiter.predicate(event)) {
      clearTimeout(waiter.timeout);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(event);
    }
  }
});

try {
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const before = createSnapshot("before");
  const after = createSnapshot("after");
  const view = createSnapshot("view");
  await postHeartbeat(before.url, before.title);
  evidence.steps.push({ step: "heartbeat", url: before.url, permission: "allowed" });

  send({
    type: "ask",
    id: "browser-perception-dogfood-chain",
    text: "개념글 눌러서 재밌어보이는 글 보여줘",
    mode: "browser"
  });

  const perceptionProgress = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId.includes("browser-perception-dogfood-chain") &&
      event.status === "browser_perception_waiting",
    "perception wait progress"
  );
  const observeCommand = await pollCommand(before);
  assertEqual(observeCommand.kind, "observe_now", "first command must be observe_now");
  await postObserveAck(observeCommand.commandId, before);
  await postObserveResult(observeCommand.commandId, before);
  evidence.steps.push({
    step: "request_scoped_observe",
    commandId: observeCommand.commandId,
    progressStatus: perceptionProgress.status,
    route: before.url,
    result: "ready"
  });

  const firstActionQueued = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId.includes("browser-perception-dogfood-chain") &&
      event.status === "plan_paused_for_extension",
    "first Browser Action command"
  );
  const firstAction = await pollCommand(before);
  assertEqual(firstAction.action.type, "click", "first action type");
  await postActionResult(firstAction.requestId, true, before, after);
  evidence.steps.push({
    step: "filter_click",
    requestId: firstAction.requestId,
    expectedSource: firstAction.expectedSource?.url,
    target: firstAction.target?.label,
    afterUrl: after.url
  });

  const secondActionQueued = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId.includes("browser-perception-dogfood-chain") &&
      event.status === "plan_paused_for_extension" &&
      event.detail?.requestId !== firstActionQueued.detail?.requestId,
    "second Browser Action command"
  );
  const secondAction = await pollCommand(after);
  assertEqual(secondAction.action.type, "click", "second action type");
  await postActionResult(secondAction.requestId, true, after, view);
  evidence.steps.push({
    step: "representative_content_click",
    requestId: secondAction.requestId,
    expectedSource: secondAction.expectedSource?.url,
    target: secondAction.target?.label,
    afterUrl: view.url,
    queuedEvent: secondActionQueued.status
  });

  const answer = await waitFor(
    (event) => event.type === "message.completed" && event.id === "browser-perception-dogfood-chain",
    "final prompt answer"
  );
  if (/잠시 후 다시 실행|currently reading|try again shortly/i.test(answer.text)) {
    throw new Error(`Dogfood failed: retry-later response leaked as final answer: ${answer.text}`);
  }
  evidence.result = "pass";
  evidence.finalAnswer = answer.text;
  evidence.eventTypes = events.map((event) => event.type);
  await writeEvidence();
  console.log(`browser perception dogfood evidence written: ${reportPath}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

function createSnapshot(state) {
  const url = state === "before"
    ? "https://example.test/board/lists?id=topic"
    : state === "after"
      ? "https://example.test/board/lists?id=topic&exception_mode=recommend"
      : "https://example.test/board/view?id=topic&no=123";
  return {
    url,
    title: "Generic Dynamic Board",
    readyState: "complete",
    mutationRevision: state,
    mutationQuietMs: 900,
    viewport: { width: 1280, height: 900, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    text: state === "view"
      ? "재밌어보이는 실험 글 본문"
      : "개념글\n재밌어보이는 실험 글\n다른 게시글",
    elements: [
      {
        id: "concept-filter",
        role: "button",
        tagName: "button",
        label: "개념글",
        text: "개념글",
        selector: "button[data-filter='recommend']",
        href: "https://example.test/board/lists?id=topic&exception_mode=recommend",
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        sourceOrder: 1,
        domPathHash: "concept-filter",
        nearestLandmark: "toolbar",
        mutationRevision: state
      },
      {
        id: "interesting-post",
        role: "link",
        tagName: "a",
        label: "재밌어보이는 실험 글",
        text: "재밌어보이는 실험 글",
        selector: "main a.post",
        href: "https://example.test/board/view?id=topic&no=123",
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        sourceOrder: 2,
        domPathHash: "interesting-post",
        nearestLandmark: "main",
        listOwner: "post-list",
        mutationRevision: state
      }
    ]
  };
}

async function postHeartbeat(url, title) {
  const response = await fetch(`${baseUrl}/browser-action/extension/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      connected: true,
      mode: "idle",
      reason: "dogfood",
      updatedAt: new Date().toISOString(),
      activeTab: { tabId: 10, windowId: 20, url, title, permission: "allowed" },
      settings: { daemonBaseUrl: baseUrl, autoConnect: true, autoObserve: true, allowAllSites: true }
    })
  });
  if (!response.ok) throw new Error(`heartbeat failed: ${response.status}`);
}

async function pollCommand(snapshot) {
  const url = new URL(`${baseUrl}/browser-action/extension/poll`);
  url.searchParams.set("tabId", "10");
  url.searchParams.set("windowId", "20");
  url.searchParams.set("url", snapshot.url);
  url.searchParams.set("title", snapshot.title);
  url.searchParams.set("permission", "allowed");
  url.searchParams.set("mode", "browser_bridge");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`poll failed: ${response.status}`);
  const command = (await response.json()).command;
  if (!command) throw new Error("Expected a Browser Bridge command.");
  return command;
}

async function postObserveAck(commandId, snapshot) {
  const response = await fetch(`${baseUrl}/browser-action/extension/ack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      commandId,
      status: "accepted",
      activeTab: { tabId: 10, windowId: 20, url: snapshot.url, title: snapshot.title, permission: "allowed" },
      receivedAt: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(`ack failed: ${response.status}`);
}

async function postObserveResult(commandId, snapshot) {
  const response = await fetch(`${baseUrl}/browser-action/extension/observe-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      commandId,
      status: "succeeded",
      snapshot,
      activeTab: { tabId: 10, windowId: 20, url: snapshot.url, title: snapshot.title, permission: "allowed" },
      mutationRevision: snapshot.mutationRevision,
      mutationQuietMs: snapshot.mutationQuietMs,
      readyState: snapshot.readyState,
      resultPostedAt: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(`observe result failed: ${response.status}`);
}

async function postActionResult(requestId, ok, before, after, error) {
  const response = await fetch(`${baseUrl}/browser-action/extension/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, ok, before, after, error })
  });
  if (!response.ok) throw new Error(`action result failed: ${response.status}`);
}

function send(message) {
  socket.send(JSON.stringify(message));
}

function waitFor(predicate, label, timeoutMs = 15_000) {
  const existing = events.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timeout: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${label}. Events: ${events.map((event) => event.type).join(", ")}`));
      }, timeoutMs)
    };
    waiters.push(waiter);
  });
}

async function writeEvidence() {
  await mkdir(dirname(assetPath), { recursive: true });
  await writeFile(assetPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(reportPath, [
    "# Browser Perception Dogfood Evidence",
    "",
    `Generated: ${evidence.generatedAt}`,
    "",
    "## Scenario",
    "",
    "A prompt-driven Browser Action starts without a pre-existing manual snapshot. Browser Perception queues `observe_now`, receives ack/result, then continues a generic filter -> representative content flow.",
    "",
    "## Result",
    "",
    `- Status: ${evidence.result}`,
    `- Final answer avoided retry-later text: ${!/잠시 후 다시 실행|currently reading|try again shortly/i.test(evidence.finalAnswer ?? "")}`,
    `- Supporting JSON: ${assetPath}`,
    "",
    "## Steps",
    "",
    ...evidence.steps.map((step) => `- ${step.step}: ${JSON.stringify(step)}`)
  ].join("\n"), "utf8");
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
