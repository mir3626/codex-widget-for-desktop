import {
  BRIDGE_ALARM_NAME,
  NATIVE_HOST_NAME
} from "./bridge/config.js";
import { setBridgeBadge } from "./bridge/badge.js";
import {
  DEFAULT_SETTINGS,
  configureBridgeAlarm,
  normalizeBridgeSettings,
  readBridgeSettings,
  readError,
  resolveDaemonUrl,
  sanitizeSettings,
  writeStorage
} from "./bridge/settings.js";
import {
  createBaseStatus,
  postHeartbeat,
  readActiveTab,
  readTabPermission,
  testDaemonConnection
} from "./bridge/tab-state.js";
import {
  assertTabCanRunBrowserAction,
  executeBrowserPerceptionObserveCommand,
  executePolledBrowserActionCommand,
  isBrowserActionPollOnlyError,
  pollAndExecuteBrowserAction,
  readSnapshotFromTab
} from "./bridge/action-channel.js";

const BRIDGE_COMMAND_SOCKET_KEEPALIVE_MS = 20_000;
const BRIDGE_COMMAND_SOCKET_RECONNECT_MS = 2_000;

let bridgeCommandPumpTimer = null;
let bridgeCommandPumpRunning = false;
let bridgeCommandPumpAbort = null;
let bridgeCommandSocket = null;
let bridgeCommandSocketUrl = "";
let bridgeCommandSocketReconnectTimer = null;
let bridgeCommandSocketKeepaliveTimer = null;
let bridgeCommandSocketPollRunning = false;
let bridgeCommandSocketPollQueued = false;
let activeTabGeneration = 0;
let lastActiveTabSignature = "";

chrome.runtime.onInstalled.addListener(() => {
  void initializeBridge("installed");
});

chrome.runtime.onStartup.addListener(() => {
  void initializeBridge("startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BRIDGE_ALARM_NAME) {
    void refreshBridge("alarm");
  }
});

chrome.tabs.onActivated.addListener(() => {
  void refreshActiveTabBridge("tab_activated").catch((error) => console.debug("[Codex Widget] Browser Bridge tab activation refresh failed.", error));
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab?.active || changeInfo.status !== "complete") {
    return;
  }
  void refreshActiveTabBridge("tab_complete").catch((error) => console.debug("[Codex Widget] Browser Bridge tab update refresh failed.", error));
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  void refreshActiveTabBridge("window_focused").catch((error) => console.debug("[Codex Widget] Browser Bridge window focus refresh failed.", error));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleRuntimeMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: readError(error) }));
  return true;
});

void initializeBridge("loaded");

async function initializeBridge(reason) {
  const settings = await readBridgeSettings();
  await configureBridgeAlarm(settings);
  await refreshBridge(reason);
  scheduleBridgeCommandPump("initialized");
}

async function handleRuntimeMessage(message) {
  if (message?.type === "bridge.getStatus") {
    const status = await refreshBridge("popup");
    return { ok: true, status, settings: sanitizeSettings(await readBridgeSettings()) };
  }
  if (message?.type === "bridge.saveSettings") {
    const settings = normalizeBridgeSettings(message.settings);
    await writeStorage(settings);
    await configureBridgeAlarm(settings);
    const status = await refreshBridge("settings_saved");
    return { ok: true, status, settings: sanitizeSettings(settings) };
  }
  if (message?.type === "bridge.resetSettings") {
    await writeStorage(DEFAULT_SETTINGS);
    await configureBridgeAlarm(DEFAULT_SETTINGS);
    const status = await refreshBridge("settings_reset");
    return { ok: true, status, settings: sanitizeSettings(DEFAULT_SETTINGS) };
  }
  if (message?.type === "bridge.testConnection") {
    const settings = await readBridgeSettings();
    const status = await refreshBridge("test_connection");
    return { ok: status.connected, status, settings: sanitizeSettings(settings) };
  }
  if (message?.type === "bridge.refresh") {
    const settings = await readBridgeSettings();
    const status = await refreshBridge(typeof message.reason === "string" ? message.reason : "popup_refresh");
    return { ok: true, status, settings: sanitizeSettings(settings) };
  }
  if (message?.type === "bridge.debugSnapshot") {
    const settings = await readBridgeSettings();
    if (!settings.debugSnapshot) {
      return { ok: false, error: "Debug page capture is disabled." };
    }
    const tab = await readActiveTab();
    if (!tab?.id) {
      return { ok: false, error: "No active tab is available." };
    }
    await syncActiveTabObservation(tab, settings, "debug_snapshot");
    const status = await refreshBridge("debug_snapshot");
    return { ok: true, status };
  }
  return { ok: false, error: "Unknown Browser Bridge message." };
}

async function refreshBridge(reason) {
  const settings = await readBridgeSettings();
  const tab = await readActiveTab();
  const daemonBaseUrl = settings.daemonBaseUrl;
  const status = createBaseStatus({ settings, tab, reason });

  if (!settings.autoConnect) {
    closeBridgeCommandSocket("auto_connect_disabled");
    status.connected = false;
    status.mode = "off";
    status.lastError = "Auto-connect is disabled.";
    await setBridgeBadge("OFF");
    return status;
  }

  const health = await testDaemonConnection(daemonBaseUrl);
  status.connected = health.ok;
  if (!health.ok) {
    closeBridgeCommandSocket("daemon_disconnected");
    status.mode = "disconnected";
    status.lastError = health.error;
    await setBridgeBadge("OFF");
    return status;
  }
  scheduleBridgeCommandSocket(settings, reason, 0);

  status.activeTab = {
    ...status.activeTab,
    ...(await readTabPermission(tab, settings))
  };
  const nextSignature = readActiveTabSignature(tab, status.activeTab.permission);
  const activeTabChanged = nextSignature !== lastActiveTabSignature;
  if (activeTabChanged) {
    lastActiveTabSignature = nextSignature;
    activeTabGeneration += 1;
    abortBridgeCommandPump(`active_tab_changed:${reason}`);
  }
  if (status.activeTab.permission === "restricted") {
    status.mode = "restricted";
    status.lastError = status.activeTab.detail ?? "This browser page is restricted.";
    await postHeartbeat(daemonBaseUrl, status);
    await setBridgeBadge("ERR", tab?.id);
    return status;
  }
  if (status.activeTab.permission === "needs_site_permission") {
    status.mode = "permission_needed";
    status.lastError = "Enable this site in the Browser Bridge popup.";
    await postHeartbeat(daemonBaseUrl, status);
    await setBridgeBadge("ASK", tab?.id);
    return status;
  }

  status.mode = "idle";
  status.lastError = null;
  await postHeartbeat(daemonBaseUrl, status);
  await setBridgeBadge("IDLE", tab?.id);

  try {
    const handledCommand = await pollAndExecuteBrowserAction(tab, settings, { waitMs: 0 });
    if (handledCommand) {
      scheduleBridgeCommandPump("refresh_command", 25, { force: true });
      return status;
    }
  } catch (error) {
    if (!isBrowserActionPollOnlyError(error)) {
      status.mode = "error";
      status.lastError = readError(error);
      await setBridgeBadge("ERR", tab?.id);
      await postHeartbeat(daemonBaseUrl, status);
      return status;
    }
  }

  if (settings.autoObserve && tab?.id) {
    try {
      await syncActiveTabObservation(tab, settings, "auto_observe");
      status.lastObservationAt = new Date().toISOString();
      await postHeartbeat(daemonBaseUrl, { ...status, reason: `${reason}:observed` });
    } catch (error) {
      status.lastError = readError(error);
      await setBridgeBadge("ERR", tab.id);
      await postHeartbeat(daemonBaseUrl, { ...status, mode: "error" });
      return status;
    }
  }

  try {
    await pollAndExecuteBrowserAction(tab, settings, { waitMs: shouldLongPollFromRefresh(reason) ? 15_000 : 0 });
    scheduleBridgeCommandPump("refresh");
  } catch (error) {
    if (!isBrowserActionPollOnlyError(error)) {
      status.mode = "error";
      status.lastError = readError(error);
      await setBridgeBadge("ERR", tab?.id);
      await postHeartbeat(daemonBaseUrl, status);
    }
  }

  return status;
}

async function refreshActiveTabBridge(reason) {
  activeTabGeneration += 1;
  abortBridgeCommandPump(reason);
  const status = await refreshBridge(reason);
  scheduleBridgeCommandPump(reason, 25, { force: true });
  return status;
}

function shouldLongPollFromRefresh(reason) {
  return !/popup|test_connection|settings|debug_snapshot|tab_|window_|observed/i.test(String(reason ?? ""));
}

function scheduleBridgeCommandPump(reason, delayMs = 250, options = {}) {
  if (bridgeCommandPumpTimer !== null) {
    if (!options.force) {
      return;
    }
    clearTimeout(bridgeCommandPumpTimer);
    bridgeCommandPumpTimer = null;
  }
  bridgeCommandPumpTimer = setTimeout(() => {
    bridgeCommandPumpTimer = null;
    void runBridgeCommandPump(reason);
  }, delayMs);
}

function scheduleBridgeCommandSocket(settings, reason, delayMs = BRIDGE_COMMAND_SOCKET_RECONNECT_MS) {
  if (!settings.autoConnect) {
    closeBridgeCommandSocket("auto_connect_disabled");
    return;
  }
  if (bridgeCommandSocketReconnectTimer !== null) {
    clearTimeout(bridgeCommandSocketReconnectTimer);
    bridgeCommandSocketReconnectTimer = null;
  }
  bridgeCommandSocketReconnectTimer = setTimeout(() => {
    bridgeCommandSocketReconnectTimer = null;
    void ensureBridgeCommandSocket(settings, reason);
  }, Math.max(0, delayMs));
}

async function ensureBridgeCommandSocket(settings, reason) {
  const url = resolveBridgeCommandSocketUrl(settings.daemonBaseUrl);
  if (bridgeCommandSocket && bridgeCommandSocketUrl === url && (bridgeCommandSocket.readyState === WebSocket.OPEN || bridgeCommandSocket.readyState === WebSocket.CONNECTING)) {
    if (bridgeCommandSocket.readyState === WebSocket.OPEN) {
      await sendBridgeCommandSocketPoll(`ensure:${reason}`);
    }
    return;
  }
  closeBridgeCommandSocket("reconnect");
  bridgeCommandSocketUrl = url;
  const socket = new WebSocket(url);
  bridgeCommandSocket = socket;
  socket.addEventListener("open", () => {
    void sendBridgeCommandSocketPoll(`open:${reason}`);
    scheduleBridgeCommandSocketKeepalive();
  });
  socket.addEventListener("message", (event) => {
    void handleBridgeCommandSocketMessage(event.data).catch((error) => {
      console.debug("[Codex Widget] Browser Bridge command socket message failed.", error);
    });
  });
  socket.addEventListener("close", () => {
    if (bridgeCommandSocket === socket) {
      bridgeCommandSocket = null;
      bridgeCommandSocketUrl = "";
      clearBridgeCommandSocketKeepalive();
      void readBridgeSettings().then((nextSettings) => scheduleBridgeCommandSocket(nextSettings, "socket_closed"));
    }
  });
  socket.addEventListener("error", () => {
    if (bridgeCommandSocket === socket) {
      closeBridgeCommandSocket("socket_error");
      void readBridgeSettings().then((nextSettings) => scheduleBridgeCommandSocket(nextSettings, "socket_error"));
    }
  });
}

function resolveBridgeCommandSocketUrl(daemonBaseUrl) {
  const url = new URL(resolveDaemonUrl(daemonBaseUrl, "/"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function closeBridgeCommandSocket(reason) {
  if (bridgeCommandSocketReconnectTimer !== null) {
    clearTimeout(bridgeCommandSocketReconnectTimer);
    bridgeCommandSocketReconnectTimer = null;
  }
  clearBridgeCommandSocketKeepalive();
  const socket = bridgeCommandSocket;
  bridgeCommandSocket = null;
  bridgeCommandSocketUrl = "";
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    return;
  }
  try {
    socket.close(1000, String(reason ?? "closing").slice(0, 120));
  } catch {
    socket.close();
  }
}

function scheduleBridgeCommandSocketKeepalive() {
  clearBridgeCommandSocketKeepalive();
  bridgeCommandSocketKeepaliveTimer = setTimeout(() => {
    bridgeCommandSocketKeepaliveTimer = null;
    if (bridgeCommandSocket?.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      bridgeCommandSocket.send(JSON.stringify({ type: "ping" }));
    } catch {
      // The close/error handlers handle reconnect.
    }
    void sendBridgeCommandSocketPoll("keepalive");
    scheduleBridgeCommandSocketKeepalive();
  }, BRIDGE_COMMAND_SOCKET_KEEPALIVE_MS);
}

function clearBridgeCommandSocketKeepalive() {
  if (bridgeCommandSocketKeepaliveTimer !== null) {
    clearTimeout(bridgeCommandSocketKeepaliveTimer);
    bridgeCommandSocketKeepaliveTimer = null;
  }
}

async function sendBridgeCommandSocketPoll(reason) {
  if (bridgeCommandSocket?.readyState !== WebSocket.OPEN) {
    return;
  }
  if (bridgeCommandSocketPollRunning) {
    bridgeCommandSocketPollQueued = true;
    return;
  }
  bridgeCommandSocketPollRunning = true;
  try {
    const settings = await readBridgeSettings();
    const tab = await readActiveTab();
    if (!settings.autoConnect || !tab?.id) {
      return;
    }
    const permission = await readTabPermission(tab, settings);
    bridgeCommandSocket.send(JSON.stringify({
      type: "browserBridge.command.poll",
      reason,
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title,
      permission: permission.permission,
      mode: "browser_bridge"
    }));
  } finally {
    bridgeCommandSocketPollRunning = false;
    if (bridgeCommandSocketPollQueued) {
      bridgeCommandSocketPollQueued = false;
      setTimeout(() => {
        void sendBridgeCommandSocketPoll(`coalesced:${reason}`);
      }, 25);
    }
  }
}

async function handleBridgeCommandSocketMessage(raw) {
  const message = JSON.parse(typeof raw === "string" ? raw : String(raw ?? "{}"));
  if (isBridgeCommandWakeEvent(message)) {
    const reason = String(message.status ?? "queued");
    await sendBridgeCommandSocketPoll(reason);
    scheduleBridgeCommandSocketWakeRetries(reason);
    return;
  }
  if (message?.type !== "browserBridge.command" || !message.command) {
    return;
  }
  const settings = await readBridgeSettings();
  const tab = await readActiveTab();
  if (!tab?.id) {
    return;
  }
  const permission = await readTabPermission(tab, settings);
  if (message.command.kind === "observe_now") {
    await executeBrowserPerceptionObserveCommand(tab, settings, permission, message.command);
  } else {
    await executePolledBrowserActionCommand(tab, settings, permission, message.command);
  }
  await sendBridgeCommandSocketPoll("after_command");
}

function scheduleBridgeCommandSocketWakeRetries(reason) {
  for (const delayMs of [900, 1_800, 3_000]) {
    setTimeout(() => {
      void sendBridgeCommandSocketPoll(`wake_retry:${reason}:${delayMs}`);
    }, delayMs);
  }
}

function isBridgeCommandWakeEvent(message) {
  if (message?.type !== "browserAction.progress") {
    return false;
  }
  if (message.status === "queued") {
    return true;
  }
  if (message.status === "plan_paused_for_extension") {
    return Boolean(message.detail?.requestId && message.detail?.action);
  }
  if (message.status === "clarification_selected_queued") {
    return Boolean(message.detail?.requestId && message.detail?.action);
  }
  return message.status === "browser_perception_waiting" && message.detail?.status === "observe_queued";
}

async function runBridgeCommandPump(reason) {
  if (bridgeCommandPumpRunning) {
    scheduleBridgeCommandPump(`pump_busy:${reason}`, 250);
    return;
  }
  bridgeCommandPumpRunning = true;
  const generation = activeTabGeneration;
  const abortController = new AbortController();
  bridgeCommandPumpAbort = abortController;
  let shouldContinue = false;
  try {
    const settings = await readBridgeSettings();
    if (!settings.autoConnect) {
      return;
    }
    const tab = await readActiveTab();
    if (!tab?.id) {
      return;
    }
    const health = await testDaemonConnection(settings.daemonBaseUrl);
    if (!health.ok) {
      await setBridgeBadge("OFF", tab.id);
      return;
    }
    const permission = await readTabPermission(tab, settings);
    if (permission.permission !== "allowed") {
      await setBridgeBadge(permission.permission === "needs_site_permission" ? "ASK" : "ERR", tab.id);
      return;
    }
    shouldContinue = true;
    await pollAndExecuteBrowserAction(tab, settings, { waitMs: 25_000, signal: abortController.signal });
  } catch (error) {
    if (abortController.signal.aborted) {
      shouldContinue = false;
    } else if (!isBrowserActionPollOnlyError(error)) {
      console.debug("[Codex Widget] Browser Bridge long-poll command pump failed.", error);
    }
  } finally {
    if (bridgeCommandPumpAbort === abortController) {
      bridgeCommandPumpAbort = null;
    }
    bridgeCommandPumpRunning = false;
    if (shouldContinue && generation === activeTabGeneration) {
      scheduleBridgeCommandPump(`long_poll:${reason}`, 250);
    }
  }
}

function abortBridgeCommandPump(reason) {
  if (!bridgeCommandPumpAbort) {
    return;
  }
  try {
    bridgeCommandPumpAbort.abort(reason);
  } catch {
    bridgeCommandPumpAbort.abort();
  }
}

function readActiveTabSignature(tab, permission) {
  return [
    tab?.windowId ?? "",
    tab?.id ?? "",
    tab?.url ?? "",
    tab?.title ?? "",
    permission ?? ""
  ].join("|");
}

async function syncActiveTabObservation(tab, settings, reason) {
  if (!tab?.id) {
    throw new Error("No active tab is available for Browser Bridge observation.");
  }
  assertTabCanRunBrowserAction(tab);
  const permission = await readTabPermission(tab, settings);
  if (permission.permission !== "allowed") {
    throw new Error(permission.detail ?? "Site permission is required before Browser Bridge observation.");
  }
  await setBridgeBadge("RUN", tab.id);
  const snapshot = await readSnapshotFromTab(tab.id);
  snapshot.bridge = {
    reason,
    observedAt: new Date().toISOString(),
    permission: permission.permission,
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title
  };
  const snapshotUrl = resolveDaemonUrl(settings.daemonBaseUrl, "/providers/dom/snapshot");
  const httpResult = await tryPostSnapshotToDaemon(snapshot, snapshotUrl);
  if (!httpResult.ok) {
    const nativeResult = settings.useNativeHost
      ? await trySendNativeSnapshot(snapshot, snapshotUrl)
      : { ok: false, error: "Native host fallback is disabled." };
    if (!nativeResult.ok) {
      throw new Error(`Browser Bridge observation failed. HTTP: ${readError(httpResult.error)} Native: ${readError(nativeResult.error)}`);
    }
  }
  await setBridgeBadge("IDLE", tab.id);
}

async function tryPostSnapshotToDaemon(snapshot, daemonUrl) {
  try {
    await postSnapshotToDaemon(snapshot, daemonUrl);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

async function trySendNativeSnapshot(snapshot, daemonUrl) {
  try {
    const response = await sendNativeMessage({
      type: "domSnapshot",
      daemonUrl,
      snapshot
    });
    if (response?.ok === true) {
      return { ok: true };
    }
    return { ok: false, error: response?.error ?? "Native host did not accept the snapshot." };
  } catch (error) {
    console.debug("[Codex Widget] Native messaging unavailable; falling back to HTTP.", error);
    return { ok: false, error };
  }
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

async function postSnapshotToDaemon(snapshot, daemonUrl) {
  const response = await fetch(daemonUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot)
  });

  if (!response.ok) {
    throw new Error(`Daemon rejected DOM snapshot (${response.status}).`);
  }
}
