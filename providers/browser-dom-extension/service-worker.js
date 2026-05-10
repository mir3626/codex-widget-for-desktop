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
  isBrowserActionPollOnlyError,
  pollAndExecuteBrowserAction,
  readSnapshotFromTab
} from "./bridge/action-channel.js";

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
  void refreshBridge("tab_activated").catch((error) => console.debug("[Codex Widget] Browser Bridge tab activation refresh failed.", error));
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab?.active || changeInfo.status !== "complete") {
    return;
  }
  void refreshBridge("tab_complete").catch((error) => console.debug("[Codex Widget] Browser Bridge tab update refresh failed.", error));
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  void refreshBridge("window_focused").catch((error) => console.debug("[Codex Widget] Browser Bridge window focus refresh failed.", error));
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
    status.connected = false;
    status.mode = "off";
    status.lastError = "Auto-connect is disabled.";
    await setBridgeBadge("OFF");
    return status;
  }

  const health = await testDaemonConnection(daemonBaseUrl);
  status.connected = health.ok;
  if (!health.ok) {
    status.mode = "disconnected";
    status.lastError = health.error;
    await setBridgeBadge("OFF");
    return status;
  }

  status.activeTab = {
    ...status.activeTab,
    ...(await readTabPermission(tab, settings))
  };
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

  if (settings.autoObserve && tab?.id) {
    try {
      await syncActiveTabObservation(tab, settings, "auto_observe");
      status.lastObservationAt = new Date().toISOString();
    } catch (error) {
      status.lastError = readError(error);
      await setBridgeBadge("ERR", tab.id);
      await postHeartbeat(daemonBaseUrl, { ...status, mode: "error" });
      return status;
    }
  }

  try {
    await pollAndExecuteBrowserAction(tab, settings);
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
    permission: permission.permission
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
