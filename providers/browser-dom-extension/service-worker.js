import { collectDomSnapshot, executeBrowserActionInPage } from "./bridge/injected-dom.js";

const DEFAULT_DAEMON_BASE_URL = "http://127.0.0.1:4128";
const DEFAULT_DAEMON_DOM_SNAPSHOT_URL = `${DEFAULT_DAEMON_BASE_URL}/providers/dom/snapshot`;
const DEFAULT_BROWSER_ACTION_POLL_PATH = "/browser-action/extension/poll";
const DEFAULT_BROWSER_ACTION_RESULT_PATH = "/browser-action/extension/result";
const DEFAULT_BROWSER_ACTION_HEARTBEAT_PATH = "/browser-action/extension/heartbeat";
const DEFAULT_BROWSER_ACTION_STATUS_PATH = "/browser-action/extension/status";
const NATIVE_HOST_NAME = "com.mir3626.codex_widget_dom";
const BRIDGE_ALARM_NAME = "codex-widget-browser-bridge";
const ALL_SITE_ORIGINS = ["http://*/*", "https://*/*"];
const DEFAULT_SETTINGS = {
  daemonBaseUrl: DEFAULT_DAEMON_BASE_URL,
  daemonUrl: DEFAULT_DAEMON_DOM_SNAPSHOT_URL,
  autoConnect: true,
  autoObserve: true,
  allowAllSites: false,
  observeBlocklist: [],
  allowSafeReadScroll: true,
  requireApprovalForClickType: true,
  useNativeHost: true,
  debugSnapshot: false,
  pollIntervalSeconds: 10
};
const BADGES = {
  OFF: { text: "OFF", color: "#64748b" },
  IDLE: { text: "IDLE", color: "#0f766e" },
  RUN: { text: "RUN", color: "#2563eb" },
  ASK: { text: "ASK", color: "#b45309" },
  ERR: { text: "ERR", color: "#b91c1c" }
};

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

async function pollAndExecuteBrowserAction(tab, settings) {
  if (!tab?.id) {
    return;
  }

  const permission = await readTabPermission(tab, settings);
  const pollUrl = new URL(resolveDaemonUrl(settings.daemonBaseUrl, DEFAULT_BROWSER_ACTION_POLL_PATH));
  pollUrl.searchParams.set("tabId", String(tab.id));
  if (tab.windowId !== undefined) {
    pollUrl.searchParams.set("windowId", String(tab.windowId));
  }
  if (tab.url) {
    pollUrl.searchParams.set("url", tab.url);
  }
  if (tab.title) {
    pollUrl.searchParams.set("title", tab.title);
  }
  pollUrl.searchParams.set("permission", permission.permission);
  pollUrl.searchParams.set("mode", "browser_bridge");
  const resultUrl = resolveDaemonUrl(settings.daemonBaseUrl, DEFAULT_BROWSER_ACTION_RESULT_PATH);
  const response = await fetch(pollUrl.toString(), { method: "GET" });
  if (!response.ok) {
    throw new Error(`Browser Action poll failed (${response.status}).`);
  }

  const payload = await response.json();
  const command = payload?.command;
  if (!command?.requestId || !command?.action) {
    return;
  }

  await setBridgeBadge("RUN", tab.id);
  const permissionError = permission.permission === "allowed" ? "" : permission.detail ?? "Site permission is required before Browser Action execution.";
  const before = permissionError ? null : await safeReadSnapshotFromTab(tab.id);
  const sourceMismatch = permissionError || detectSourceMismatch(command.expectedSource, tab, before);
  const result = sourceMismatch
    ? {
        ok: false,
        error: sourceMismatch,
        after: before,
        metadata: { actualUrl: tab.url ?? before?.url, actualTitle: tab.title ?? before?.title, permission: permission.permission }
      }
    : await executeBrowserActionCommand(tab, command);
  const after = result.after ?? await safeReadSnapshotFromTab(tab.id);
  await postBrowserActionResultWithRetry(resultUrl, {
    requestId: command.requestId,
    ok: result.ok,
    before,
    after,
    error: result.error,
    metadata: {
      ...result.metadata,
      actualTab: {
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        title: tab.title
      },
      permission: permission.permission,
      bridgeMode: "command_first"
    }
  });
  await setBridgeBadge(result.ok ? "IDLE" : "ERR", tab.id);
}

function isBrowserActionPollOnlyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /^Browser Action poll failed \(\d+\)\.?$/.test(message) || /Failed to fetch/i.test(message);
}

async function executeBrowserActionCommand(tab, command) {
  try {
    assertTabCanRunBrowserAction(tab);
    if (command.action?.type === "screenshot") {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const after = await safeReadSnapshotFromTab(tab.id);
      if (after) {
        after.screenshot = { dataUrl, title: "Visible tab screenshot" };
      }
      return { ok: true, after };
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: executeBrowserActionInPage,
      args: [command]
    });

    if (!injection?.result) {
      return { ok: false, error: "No Browser Action execution result was returned." };
    }
    return injection.result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      after: await safeReadSnapshotFromTab(tab.id)
    };
  }
}

async function safeReadSnapshotFromTab(tabId) {
  try {
    return await readSnapshotFromTab(tabId);
  } catch {
    return null;
  }
}

async function readSnapshotFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  assertTabCanRunBrowserAction(tab);
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectDomSnapshot
  });

  if (!injection?.result) {
    throw new Error("No DOM snapshot was returned from the active tab.");
  }
  return injection.result;
}

async function postBrowserActionResultWithRetry(url, payload) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const post = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, metadata: { ...(payload.metadata ?? {}), postAttempt: attempt } })
      });
      if (post.ok) {
        return;
      }
      lastError = new Error(`Browser Action result post failed (${post.status}).`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("Browser Action result post failed.");
}

function detectSourceMismatch(expected, tab, before) {
  if (!expected) {
    return "";
  }
  const expectedTabId = expected.tabId ? String(expected.tabId) : "";
  if (expectedTabId && expectedTabId !== String(tab.id)) {
    return `Active tab mismatch: expected tab ${expectedTabId}, got ${tab.id}.`;
  }
  const expectedWindowId = expected.windowId ? String(expected.windowId) : "";
  if (expectedWindowId && expectedWindowId !== String(tab.windowId)) {
    return `Active window mismatch: expected window ${expectedWindowId}, got ${tab.windowId}.`;
  }
  const expectedUrl = expected.url || "";
  const actualUrl = tab.url || before?.url || "";
  if (expectedUrl && actualUrl && normalizeUrlForSource(expectedUrl) !== normalizeUrlForSource(actualUrl)) {
    return `Active tab URL changed before Browser Action execution: expected ${expectedUrl}, got ${actualUrl}.`;
  }
  return "";
}

function normalizeUrlForSource(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return String(value || "").replace(/#.*$/, "");
  }
}

function assertTabCanRunBrowserAction(tab) {
  const url = tab?.url || "";
  if (!url) {
    throw new Error("Browser Action cannot run because the active tab URL is unavailable.");
  }
  if (/^(chrome|edge|brave|vivaldi|opera|about|devtools):/i.test(url)) {
    throw new Error(`Browser Action is not available on restricted browser pages (${url.split(":")[0]}://).`);
  }
  if (/^chrome-extension:/i.test(url)) {
    throw new Error("Browser Action is not available on extension pages.");
  }
  if (/chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons/i.test(url)) {
    throw new Error("Browser Action is not available on browser extension store pages.");
  }
}

async function setBridgeBadge(state, tabId) {
  const badge = BADGES[state] ?? BADGES.ERR;
  const input = tabId ? { tabId, text: badge.text } : { text: badge.text };
  await chrome.action.setBadgeText(input);
  await chrome.action.setBadgeBackgroundColor(tabId ? { tabId, color: badge.color } : { color: badge.color });
}

async function readBridgeSettings() {
  return normalizeBridgeSettings(await readStorage(DEFAULT_SETTINGS));
}

function normalizeBridgeSettings(value) {
  const record = value && typeof value === "object" ? value : {};
  const daemonBaseUrl = normalizeDaemonBaseUrl(record.daemonBaseUrl ?? record.daemonUrl);
  return {
    daemonBaseUrl,
    daemonUrl: resolveDaemonUrl(daemonBaseUrl, "/providers/dom/snapshot"),
    autoConnect: record.autoConnect !== false,
    autoObserve: record.autoObserve !== false,
    allowAllSites: record.allowAllSites === true,
    observeBlocklist: normalizeObserveBlocklist(record.observeBlocklist),
    allowSafeReadScroll: record.allowSafeReadScroll !== false,
    requireApprovalForClickType: record.requireApprovalForClickType !== false,
    useNativeHost: record.useNativeHost !== false,
    debugSnapshot: record.debugSnapshot === true,
    pollIntervalSeconds: clampNumber(record.pollIntervalSeconds, 5, 120, DEFAULT_SETTINGS.pollIntervalSeconds)
  };
}

function sanitizeSettings(settings) {
  return {
    daemonBaseUrl: settings.daemonBaseUrl,
    autoConnect: settings.autoConnect,
    autoObserve: settings.autoObserve,
    allowAllSites: settings.allowAllSites,
    observeBlocklist: settings.observeBlocklist,
    allowSafeReadScroll: settings.allowSafeReadScroll,
    requireApprovalForClickType: settings.requireApprovalForClickType,
    useNativeHost: settings.useNativeHost,
    debugSnapshot: settings.debugSnapshot,
    pollIntervalSeconds: settings.pollIntervalSeconds
  };
}

function readStorage(defaults) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaults, resolve);
  });
}

function writeStorage(values) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(values, resolve);
  });
}

async function configureBridgeAlarm(settings) {
  await chrome.alarms.clear(BRIDGE_ALARM_NAME);
  if (!settings.autoConnect) {
    return;
  }
  await chrome.alarms.create(BRIDGE_ALARM_NAME, {
    delayInMinutes: 0.1,
    periodInMinutes: Math.max(0.5, settings.pollIntervalSeconds / 60)
  });
}

function normalizeDaemonBaseUrl(value) {
  if (typeof value !== "string") {
    return DEFAULT_DAEMON_BASE_URL;
  }

  try {
    const url = new URL(value.trim());
    const isLocalHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const isHttp = url.protocol === "http:";
    if (!isLocalHost || !isHttp) {
      return DEFAULT_DAEMON_BASE_URL;
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_DAEMON_BASE_URL;
  }
}

function resolveDaemonUrl(baseUrl, pathname) {
  const url = new URL(normalizeDaemonBaseUrl(baseUrl));
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function readActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs[0]) {
    return tabs[0];
  }
  const fallback = await chrome.tabs.query({ active: true, currentWindow: true });
  return fallback[0] ?? null;
}

function createBaseStatus({ settings, tab, reason }) {
  const manifest = chrome.runtime.getManifest();
  return {
    extensionVersion: manifest.version,
    daemonBaseUrl: settings.daemonBaseUrl,
    connected: false,
    mode: "checking",
    reason,
    updatedAt: new Date().toISOString(),
    activeTab: {
      tabId: tab?.id,
      windowId: tab?.windowId,
      url: tab?.url,
      title: tab?.title,
      permission: "unknown"
    },
    nativeHost: settings.useNativeHost ? "enabled" : "disabled",
    settings: sanitizeSettings(settings),
    lastError: null
  };
}

async function testDaemonConnection(baseUrl) {
  try {
    const response = await fetch(resolveDaemonUrl(baseUrl, "/storage/health"), { method: "GET" });
    return response.ok
      ? { ok: true }
      : { ok: false, error: `Widget daemon health check failed (${response.status}).` };
  } catch (error) {
    return { ok: false, error: readError(error) };
  }
}

async function postHeartbeat(baseUrl, status) {
  try {
    const response = await fetch(resolveDaemonUrl(baseUrl, DEFAULT_BROWSER_ACTION_HEARTBEAT_PATH), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(status)
    });
    if (!response.ok) {
      throw new Error(`Browser Bridge heartbeat failed (${response.status}).`);
    }
  } catch (error) {
    console.debug("[Codex Widget] Browser Bridge heartbeat failed.", error);
  }
}

async function readTabPermission(tab, settings) {
  if (!tab?.url) {
    return { permission: "unavailable", detail: "No active tab URL is available." };
  }
  if (isRestrictedTabUrl(tab.url)) {
    return { permission: "restricted", detail: "This browser page does not allow extension page access." };
  }
  const origin = originPatternForTab(tab);
  if (!origin) {
    return { permission: "restricted", detail: "Only http and https pages are supported." };
  }
  const blocked = readObserveBlocklistMatch(tab, settings?.observeBlocklist);
  if (blocked) {
    return { permission: "restricted", origin, detail: `Current site is blocked by Browser Bridge observe blocklist: ${blocked}` };
  }
  if (settings?.allowAllSites) {
    const allAllowed = await chrome.permissions.contains({ origins: ALL_SITE_ORIGINS });
    return allAllowed
      ? { permission: "allowed", origin: "<all_urls>" }
      : { permission: "needs_site_permission", origin: "<all_urls>", detail: "Allow all sites in the Browser Bridge popup or disable all-sites access." };
  }
  const allowed = await chrome.permissions.contains({ origins: [origin] });
  return allowed
    ? { permission: "allowed", origin }
    : { permission: "needs_site_permission", origin, detail: "Enable this site in the Browser Bridge popup." };
}

function normalizeObserveBlocklist(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(/[\n,]/);
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    const normalized = normalizeObserveBlockPattern(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    list.push(normalized);
    if (list.length >= 100) {
      break;
    }
  }
  return list;
}

function normalizeObserveBlockPattern(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\/\*$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function readObserveBlocklistMatch(tab, blocklist) {
  if (!Array.isArray(blocklist) || blocklist.length === 0) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(tab?.url ?? "");
  } catch {
    return "";
  }
  const href = parsed.href.toLowerCase();
  const origin = parsed.origin.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  for (const pattern of blocklist) {
    if (!pattern) {
      continue;
    }
    if (pattern === "<all_urls>") {
      return pattern;
    }
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      if (host === suffix || host.endsWith(`.${suffix}`)) {
        return pattern;
      }
      continue;
    }
    if (pattern.includes("*")) {
      const regex = new RegExp(`^${escapeRegExp(pattern).replace(/\\\*/g, ".*")}$`, "i");
      if (regex.test(href) || regex.test(origin) || regex.test(host)) {
        return pattern;
      }
      continue;
    }
    if (pattern.includes("://")) {
      if (href.startsWith(pattern) || origin === pattern) {
        return pattern;
      }
      continue;
    }
    if (host === pattern || host.endsWith(`.${pattern}`)) {
      return pattern;
    }
  }
  return "";
}

function originPatternForTab(tab) {
  try {
    const url = new URL(tab?.url ?? "");
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return `${url.origin}/*`;
  } catch {
    return "";
  }
}

function isRestrictedTabUrl(value) {
  return /^(chrome|edge|brave|vivaldi|opera|about|devtools|chrome-extension):/i.test(value) ||
    /chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons/i.test(value);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function escapeRegExp(value) {
  return String(value).replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function readError(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}
