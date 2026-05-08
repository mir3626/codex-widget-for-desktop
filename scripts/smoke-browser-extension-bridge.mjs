import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-browser-extension-bridge-smoke");
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

  await waitFor((event) => event.type === "browserExtensionBridge.status", "initial bridge status");

  await postHeartbeat({
    extensionVersion: "0.1.0",
    daemonBaseUrl: baseUrl,
    connected: true,
    mode: "idle",
    reason: "smoke",
    updatedAt: "2026-05-08T00:00:00.000Z",
    activeTab: {
      tabId: 31,
      windowId: 4,
      url: "https://example.test/browser-bridge",
      title: "Browser Bridge Smoke",
      origin: "https://example.test/*",
      permission: "allowed"
    },
    nativeHost: "enabled",
    settings: {
      daemonBaseUrl: baseUrl,
      autoConnect: true,
      autoObserve: true,
      allowSafeReadScroll: true,
      requireApprovalForClickType: true,
      useNativeHost: true,
      pollIntervalSeconds: 10
    }
  });
  const idle = await waitFor(
    (event) => event.type === "browserExtensionBridge.status" && event.status?.mode === "idle",
    "idle bridge heartbeat"
  );
  assertEqual(idle.status.connected, true, "idle connected");
  assertEqual(idle.status.activeTab.permission, "allowed", "allowed permission");

  const status = await readBridgeStatus();
  assertEqual(status.mode, "idle", "GET bridge status mode");
  assertEqual(status.activeTab.permission, "allowed", "GET bridge permission");

  await postHeartbeat({
    connected: true,
    mode: "permission_needed",
    updatedAt: "2026-05-08T00:00:01.000Z",
    activeTab: {
      tabId: 31,
      windowId: 4,
      url: "https://example.test/browser-bridge",
      title: "Browser Bridge Smoke",
      origin: "https://example.test/*",
      permission: "needs_site_permission",
      detail: "Enable this site in the Browser Bridge popup."
    },
    lastError: "Enable this site in the Browser Bridge popup."
  });
  const ask = await waitFor(
    (event) => event.type === "browserExtensionBridge.status" && event.status?.mode === "permission_needed",
    "permission-needed bridge heartbeat"
  );
  assertEqual(ask.status.activeTab.permission, "needs_site_permission", "permission-needed state");

  await postHeartbeat({
    connected: true,
    mode: "restricted",
    updatedAt: "2026-05-08T00:00:02.000Z",
    activeTab: {
      url: "chrome://extensions",
      title: "Extensions",
      permission: "restricted",
      detail: "This browser page does not allow extension page access."
    },
    lastError: "This browser page does not allow extension page access."
  });
  const restricted = await waitFor(
    (event) => event.type === "browserExtensionBridge.status" && event.status?.mode === "restricted",
    "restricted bridge heartbeat"
  );
  assertEqual(restricted.status.activeTab.permission, "restricted", "restricted state");

  await postDomSnapshot();
  const poll = await fetch(`${baseUrl}/browser-action/extension/poll?permission=allowed&mode=browser_bridge`);
  if (!poll.ok) {
    throw new Error(`Browser Bridge poll endpoint failed: ${poll.status}`);
  }
  const pollPayload = await poll.json();
  assertEqual(pollPayload.ok, true, "poll ok");

  console.log(`browser extension bridge smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function postHeartbeat(payload) {
  const response = await fetch(`${baseUrl}/browser-action/extension/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Browser Bridge heartbeat failed: ${response.status}`);
  }
}

async function readBridgeStatus() {
  const response = await fetch(`${baseUrl}/browser-action/extension/status`);
  if (!response.ok) {
    throw new Error(`Browser Bridge status failed: ${response.status}`);
  }
  return (await response.json()).status;
}

async function postDomSnapshot() {
  const response = await fetch(`${baseUrl}/providers/dom/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://example.test/browser-bridge",
      title: "Browser Bridge Smoke",
      readyState: "complete",
      text: "Browser Bridge legacy DOM provider compatibility",
      elements: []
    })
  });
  if (!response.ok) {
    throw new Error(`Legacy DOM snapshot endpoint failed: ${response.status}`);
  }
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
