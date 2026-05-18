import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { readExpectedBrowserBridgeBuildInfo } from "../dist/daemon/server/browser-bridge/extensionBuild.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-browser-extension-bridge-smoke");
const expectedBuild = readExpectedBrowserBridgeBuildInfo();
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const extensionRuntimeId = "abcdefghijklmnopabcdefghijklmnop";
const extensionOrigin = `chrome-extension://${extensionRuntimeId}`;
const otherExtensionOrigin = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba";
let socket = null;
const events = [];
const waiters = [];

try {
  await postHeartbeat({
    extensionVersion: "0.1.0",
    extensionBuildId: expectedBuild.extensionBuildId,
    extensionSourceHash: expectedBuild.extensionSourceHash,
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
      allowAllSites: true,
      observeBlocklist: ["https://blocked.example"],
      allowSafeReadScroll: true,
      requireApprovalForClickType: true,
      useNativeHost: true,
      pollIntervalSeconds: 10
    }
  });
  await connectBridgeSocket(extensionOrigin);
  const idle = await waitFor(
    (event) => event.type === "browserExtensionBridge.status" && event.status?.mode === "idle",
    "idle bridge heartbeat"
  );
  assertEqual(idle.status.connected, true, "idle connected");
  assertEqual(idle.status.activeTab.permission, "allowed", "allowed permission");
  assertEqual(idle.status.reloadRequired, false, "fresh extension build should not require reload");
  assertEqual(idle.status.expectedExtensionSourceHash, expectedBuild.extensionSourceHash, "expected extension source hash");

  const status = await readBridgeStatus();
  assertEqual(status.mode, "idle", "GET bridge status mode");
  assertEqual(status.activeTab.permission, "allowed", "GET bridge permission");
  assertEqual(status.settings.allowAllSites, true, "GET bridge all-sites setting");
  assertEqual(status.settings.observeBlocklist[0], "https://blocked.example", "GET bridge observe blocklist");
  await assertBridgeExtensionOriginBoundary();
  await assertBridgeCommandCorrelationRejectsUnknownPayloads();
  await drainBackgroundObserve({
    url: "https://example.test/browser-bridge",
    title: "Browser Bridge Smoke",
    tabId: 31,
    windowId: 4
  });

  await postHeartbeat({
    extensionVersion: "0.1.0",
    extensionBuildId: "0.1.0:stale",
    extensionSourceHash: "stale-source-hash",
    connected: true,
    mode: "idle",
    updatedAt: "2026-05-08T00:00:00.500Z",
    activeTab: {
      tabId: 31,
      windowId: 4,
      url: "https://example.test/browser-bridge",
      title: "Browser Bridge Smoke",
      origin: "https://example.test/*",
      permission: "allowed"
    }
  });
  const stale = await waitFor(
    (event) => event.type === "browserExtensionBridge.status" && event.status?.reloadRequired === true,
    "stale bridge build heartbeat"
  );
  assertEqual(stale.status.mode, "idle", "stale extension remains connected for diagnostics");

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
  const pollUrl = new URL(`${baseUrl}/browser-action/extension/poll`);
  pollUrl.searchParams.set("permission", "allowed");
  pollUrl.searchParams.set("mode", "browser_bridge");
  pollUrl.searchParams.set("tabId", "42");
  pollUrl.searchParams.set("windowId", "5");
  pollUrl.searchParams.set("url", "https://example.test/browser-bridge/poll");
  pollUrl.searchParams.set("title", "Browser Bridge Poll");
  const poll = await fetchBridgePoll(pollUrl);
  if (!poll.ok) {
    throw new Error(`Browser Bridge poll endpoint failed: ${poll.status}`);
  }
  const pollPayload = await poll.json();
  assertEqual(pollPayload.ok, true, "poll ok");
  assertEqual(pollPayload.command?.kind, "observe_now", "poll returns background observe command");
  assertEqual(pollPayload.command?.reason, "background", "poll observe reason");
  assertEqual(pollPayload.command?.expectedActiveTab?.url, "https://example.test/browser-bridge/poll", "poll observe targets active tab URL");
  await postObserveResult(pollPayload.command.commandId, {
    url: "https://example.test/browser-bridge/poll",
    title: "Browser Bridge Poll",
    tabId: 42,
    windowId: 5
  });
  const polledStatus = await readBridgeStatus();
  assertEqual(polledStatus.mode, "idle", "poll refreshes bridge mode");
  assertEqual(polledStatus.activeTab.url, "https://example.test/browser-bridge/poll", "poll refreshes active tab URL");
  assertEqual(String(polledStatus.activeTab.tabId), "42", "poll refreshes active tab id");

  socket.send(JSON.stringify({
    type: "browserBridge.command.poll",
    tabId: "43",
    windowId: "5",
    url: "https://example.test/browser-bridge/ws-poll",
    title: "Browser Bridge WebSocket Poll",
    permission: "allowed",
    mode: "browser_bridge"
  }));
  const wsCommand = await waitFor(
    (event) => event.type === "browserBridge.command",
    "websocket bridge command poll"
  );
  assertEqual(wsCommand.command?.kind, "observe_now", "websocket bridge command poll returns background observe");
  assertEqual(wsCommand.command?.reason, "background", "websocket bridge observe reason");
  assertEqual(wsCommand.command?.expectedActiveTab?.url, "https://example.test/browser-bridge/ws-poll", "websocket bridge observe targets active tab URL");
  await postObserveResult(wsCommand.command.commandId, {
    url: "https://example.test/browser-bridge/ws-poll",
    title: "Browser Bridge WebSocket Poll",
    tabId: 43,
    windowId: 5
  });
  const wsPolledStatus = await readBridgeStatus();
  assertEqual(wsPolledStatus.activeTab.url, "https://example.test/browser-bridge/ws-poll", "ws poll refreshes active tab URL");

  console.log(`browser extension bridge smoke ok on port ${daemon.port}`);
} finally {
  socket?.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function connectBridgeSocket(origin) {
  socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`, { headers: { Origin: origin } });
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
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

async function postHeartbeat(payload) {
  const response = await fetch(`${baseUrl}/browser-action/extension/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: extensionOrigin },
    body: JSON.stringify({
      extensionRuntimeId,
      ...payload
    })
  });
  if (!response.ok) {
    throw new Error(`Browser Bridge heartbeat failed: ${response.status}`);
  }
}

async function readBridgeStatus() {
  const response = await fetch(`${baseUrl}/browser-action/extension/status`, {
    headers: { Origin: extensionOrigin }
  });
  if (!response.ok) {
    throw new Error(`Browser Bridge status failed: ${response.status}`);
  }
  return (await response.json()).status;
}

async function postDomSnapshot() {
  const response = await fetch(`${baseUrl}/providers/dom/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: extensionOrigin },
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

async function assertBridgeExtensionOriginBoundary() {
  await expectPostStatus("/browser-action/extension/heartbeat", {
    extensionRuntimeId: "ponmlkjihgfedcbaponmlkjihgfedcba",
    connected: true,
    mode: "idle",
    updatedAt: new Date().toISOString(),
    activeTab: { permission: "allowed" }
  }, 403, "different Browser Bridge extension heartbeat", { Origin: otherExtensionOrigin });

  const deniedPoll = await fetch(`${baseUrl}/browser-action/extension/poll`, {
    headers: { Origin: otherExtensionOrigin }
  });
  assertEqual(deniedPoll.status, 403, "different Browser Bridge extension poll status");
  assertEqual((await deniedPoll.json()).ok, false, "different Browser Bridge extension poll ok flag");

  await expectPostStatus("/providers/dom/snapshot", {
    url: "https://example.test/browser-bridge/other-extension",
    title: "Other Extension DOM",
    readyState: "complete",
    text: "should be rejected",
    elements: []
  }, 403, "different Browser Bridge extension DOM snapshot", { Origin: otherExtensionOrigin });

  await assertWebSocketBridgePollDenied(otherExtensionOrigin);
}

async function assertBridgeCommandCorrelationRejectsUnknownPayloads() {
  const requestId = `spoofed-${Date.now()}`;
  await expectPostStatus("/browser-action/extension/action-ack", {
    requestId
  }, 409, "unknown Browser Action acknowledgement");
  await expectPostStatus("/browser-action/extension/result", {
    requestId,
    ok: true
  }, 409, "unknown Browser Action result");
  await expectPostStatus("/browser-action/extension/browser-chrome-result", {
    requestId: `browser-chrome:${requestId}`,
    ok: true,
    output: { tabs: [] }
  }, 409, "unknown Browser Chrome result");
  await expectPostStatus("/browser-action/extension/ack", {
    commandId: requestId,
    status: "accepted",
    receivedAt: new Date().toISOString()
  }, 409, "unknown Browser Perception acknowledgement");
  await expectPostStatus("/browser-action/extension/observe-result", {
    commandId: requestId,
    status: "succeeded",
    snapshot: createBridgeSnapshot({
      url: "https://example.test/browser-bridge/spoofed",
      title: "Spoofed Browser Bridge Result",
      tabId: 31,
      windowId: 4
    }),
    mutationRevision: "spoofed",
    mutationQuietMs: 900,
    readyState: "complete",
    metadata: { reason: "background" }
  }, 409, "unknown Browser Perception observe result");
}

async function expectPostStatus(path, payload, expectedStatus, label, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: extensionOrigin, ...headers },
    body: JSON.stringify(payload)
  });
  assertEqual(response.status, expectedStatus, `${label} status`);
  const body = await response.json();
  assertEqual(body.ok, false, `${label} ok flag`);
}

async function postObserveResult(commandId, options) {
  const response = await fetch(`${baseUrl}/browser-action/extension/observe-result`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: extensionOrigin },
    body: JSON.stringify({
      commandId,
      status: "succeeded",
      snapshot: createBridgeSnapshot(options),
      mutationRevision: "bridge-smoke",
      mutationQuietMs: 900,
      readyState: "complete",
      metadata: { reason: "background" }
    })
  });
  if (!response.ok) {
    throw new Error(`Browser Bridge observe result failed: ${response.status}`);
  }
}

function createBridgeSnapshot(options) {
  return {
    url: options.url,
    title: options.title,
    readyState: "complete",
    text: options.title,
    mutationRevision: "bridge-smoke",
    mutationQuietMs: 900,
    lastMutationAt: new Date(Date.now() - 900).toISOString(),
    bridge: {
      tabId: options.tabId,
      windowId: options.windowId,
      url: options.url,
      title: options.title,
      permission: "allowed",
      reason: "smoke"
    },
    elements: []
  };
}

async function drainBackgroundObserve(options) {
  const pollUrl = new URL(`${baseUrl}/browser-action/extension/poll`);
  pollUrl.searchParams.set("permission", "allowed");
  pollUrl.searchParams.set("mode", "browser_bridge");
  pollUrl.searchParams.set("tabId", String(options.tabId));
  pollUrl.searchParams.set("windowId", String(options.windowId));
  pollUrl.searchParams.set("url", options.url);
  pollUrl.searchParams.set("title", options.title);
  const response = await fetchBridgePoll(pollUrl);
  if (!response.ok) {
    throw new Error(`Browser Bridge drain poll failed: ${response.status}`);
  }
  const payload = await response.json();
  if (payload.command?.kind === "observe_now") {
    await postObserveResult(payload.command.commandId, options);
  }
}

async function fetchBridgePoll(url) {
  return await fetch(url, {
    headers: { Origin: extensionOrigin }
  });
}

async function assertWebSocketBridgePollDenied(origin) {
  await new Promise((resolve, reject) => {
    const deniedSocket = new WebSocket(`ws://127.0.0.1:${daemon.port}`, { headers: { Origin: origin } });
    deniedSocket.once("open", () => {
      deniedSocket.close();
      reject(new Error(`Browser Bridge websocket unexpectedly opened for ${origin}.`));
    });
    deniedSocket.once("unexpected-response", (_request, response) => {
      assertEqual(response.statusCode, 403, "different Browser Bridge extension websocket status");
      resolve();
    });
    deniedSocket.once("error", (error) => {
      if (/Unexpected server response: 403/.test(error.message)) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
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
