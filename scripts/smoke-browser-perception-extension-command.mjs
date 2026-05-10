import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-browser-perception-extension-command-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
const waiters = [];

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
  await postHeartbeat("https://example.test/perception-live");
  socket.send(JSON.stringify({
    type: "ask",
    id: "browser-perception-fresh-context",
    text: "현재 페이지 읽어줘",
    mode: "browser"
  }));
  const progress = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId.includes("browser-perception-fresh-context") &&
      event.status === "browser_perception_waiting",
    "perception waiting progress"
  );
  socket.send(JSON.stringify({
    type: "browserBridge.command.poll",
    tabId: 99,
    windowId: 5,
    url: "https://example.test/perception-live",
    title: "Browser Perception Live Page",
    permission: "allowed",
    mode: "browser_bridge",
    reason: "smoke_ws_observe_wakeup"
  }));
  const commandEvent = await waitFor(
    (event) => event.type === "browserBridge.command" && event.command?.kind === "observe_now",
    "websocket observe command"
  );
  const command = commandEvent.command;
  assertEqual(command?.kind, "observe_now", "observe command kind");
  assertEqual(command?.commandId, progress.detail?.commandId, "progress command id");
  await postAck(command.commandId, "accepted");
  await postObserveResult(command.commandId, createSnapshot("https://example.test/perception-live"));
  const answer = await waitFor(
    (event) => event.type === "message.completed" && event.id === "browser-perception-fresh-context",
    "prompt answer after perception"
  );
  if (/잠시 후 다시 실행|try again shortly|currently reading/i.test(answer.text)) {
    throw new Error(`Browser Perception returned retry-later as final answer: ${answer.text}`);
  }
  if (!answer.text.includes("Browser Perception Live Page")) {
    throw new Error(`Prompt answer did not use observed page: ${answer.text}`);
  }
  const plan = await waitFor(
    (event) => event.type === "browserAction.plan" && event.actionSessionId.includes("browser-perception-fresh-context"),
    "browser action plan after perception"
  );
  assertEqual(plan.plan.status, "completed", "read plan completed");

  console.log(`browser perception extension command smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function postHeartbeat(url) {
  const response = await fetch(`${baseUrl}/browser-action/extension/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      extensionVersion: "0.1.0",
      daemonBaseUrl: baseUrl,
      connected: true,
      mode: "idle",
      reason: "smoke",
      updatedAt: new Date().toISOString(),
      activeTab: {
        tabId: 99,
        windowId: 5,
        url,
        title: "Browser Perception Live Page",
        origin: "https://example.test/*",
        permission: "allowed"
      },
      settings: { daemonBaseUrl: baseUrl, autoConnect: true, autoObserve: true, allowAllSites: true }
    })
  });
  if (!response.ok) {
    throw new Error(`heartbeat failed: ${response.status}`);
  }
}

async function postAck(commandId, status) {
  const response = await fetch(`${baseUrl}/browser-action/extension/ack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      commandId,
      status,
      activeTab: { tabId: 99, windowId: 5, url: "https://example.test/perception-live", title: "Browser Perception Live Page", permission: "allowed" },
      receivedAt: new Date().toISOString(),
      estimatedResultMs: 20
    })
  });
  if (!response.ok) {
    throw new Error(`ack failed: ${response.status}`);
  }
}

async function postObserveResult(commandId, snapshot) {
  const response = await fetch(`${baseUrl}/browser-action/extension/observe-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      commandId,
      status: "succeeded",
      snapshot,
      activeTab: { tabId: 99, windowId: 5, url: snapshot.url, title: snapshot.title, permission: "allowed" },
      mutationRevision: snapshot.mutationRevision,
      mutationQuietMs: snapshot.mutationQuietMs,
      readyState: snapshot.readyState,
      resultPostedAt: new Date().toISOString()
    })
  });
  if (!response.ok) {
    throw new Error(`observe result failed: ${response.status}`);
  }
}

function createSnapshot(url) {
  return {
    url,
    title: "Browser Perception Live Page",
    readyState: "complete",
    mutationRevision: "smoke-1",
    mutationQuietMs: 900,
    text: "Browser Perception Live Page\nThis page was observed through observe_now.",
    elements: [
      {
        id: "read-heading",
        role: "heading",
        tagName: "h1",
        label: "Browser Perception Live Page",
        text: "Browser Perception Live Page",
        visible: true,
        enabled: true,
        confidence: 0.9,
        sourceOrder: 1,
        domPathHash: "heading"
      }
    ]
  };
}

function waitFor(predicate, label, timeoutMs = 10_000) {
  const existing = events.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timeout: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        reject(new Error(`Timed out waiting for ${label}. Events: ${events.map((event) => event.type).join(", ")}`));
      }, timeoutMs)
    };
    waiters.push(waiter);
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
