import { collectDomSnapshot, executeBrowserActionInPage } from "./injected-dom.js";
import {
  DEFAULT_BROWSER_ACTION_ACK_PATH,
  DEFAULT_BROWSER_ACTION_COMMAND_ACK_PATH,
  DEFAULT_BROWSER_ACTION_OBSERVE_RESULT_PATH,
  DEFAULT_BROWSER_ACTION_POLL_PATH,
  DEFAULT_BROWSER_ACTION_RESULT_PATH
} from "./config.js";
import { executeBrowserChromeCommand } from "./browser-chrome.js";
import { readError, resolveDaemonUrl } from "./settings.js";
import { setBridgeBadge } from "./badge.js";
import { readTabPermission } from "./tab-state.js";

const inFlightBrowserActionRequestIds = new Set();
const recentBrowserActionRequestIds = new Map();
const RECENT_BROWSER_ACTION_REQUEST_TTL_MS = 60_000;

export async function pollAndExecuteBrowserAction(tab, settings, options = {}) {
  if (!tab?.id) {
    return false;
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
  const waitMs = Number(options.waitMs) || 0;
  if (waitMs > 0) {
    pollUrl.searchParams.set("waitMs", String(Math.min(25_000, Math.max(0, Math.floor(waitMs)))));
  }
  const response = await fetch(pollUrl.toString(), { method: "GET", cache: "no-store", signal: options.signal });
  if (!response.ok) {
    throw new Error(`Browser Action poll failed (${response.status}).`);
  }

  const payload = await response.json();
  const command = payload?.command;
  if (command?.kind === "observe_now") {
    await executeBrowserPerceptionObserveCommand(tab, settings, permission, command);
    return true;
  }
  if (command?.kind === "browser_chrome") {
    await executeBrowserChromeCommand(tab, settings, command);
    return true;
  }
  if (!command?.requestId || !command?.action) {
    return false;
  }
  if (isDuplicateBrowserActionCommand(command.requestId)) {
    await postBrowserActionCommandAck(settings, tab, command).catch(() => undefined);
    return true;
  }

  await executePolledBrowserActionCommand(tab, settings, permission, command);
  return true;
}

export async function executePolledBrowserActionCommand(tab, settings, permission, command) {
  if (!tab?.id || !command?.requestId || !command?.action) {
    return false;
  }
  if (isDuplicateBrowserActionCommand(command.requestId)) {
    await postBrowserActionCommandAck(settings, tab, command).catch(() => undefined);
    return true;
  }

  markBrowserActionCommandInFlight(command.requestId);
  await setBridgeBadge("RUN", tab.id);
  const resultUrl = resolveDaemonUrl(settings.daemonBaseUrl, DEFAULT_BROWSER_ACTION_RESULT_PATH);
  const trace = createBridgeLatencyTrace(command);
  try {
    traceMark(trace, "ack_started");
    await postBrowserActionCommandAck(settings, tab, command);
    traceMark(trace, "ack_posted");
    const tabNavigation = isTargetlessTabNavigationAction(command.action);
    const permissionError = permission.permission === "allowed" || tabNavigation ? "" : permission.detail ?? "Site permission is required before Browser Action execution.";
    traceMark(trace, "before_snapshot_started", { lightweight: tabNavigation });
    const before = permissionError
      ? null
      : tabNavigation
        ? readLightweightTabSnapshot(tab, "before_tab_navigation")
        : await safeReadSnapshotFromTab(tab.id);
    traceMark(trace, "before_snapshot_completed", {
      lightweight: tabNavigation,
      hasSnapshot: Boolean(before),
      url: before?.url
    });
    const sourceMismatch = permissionError || detectSourceMismatch(command.expectedSource, tab, before, command.action);
    traceMark(trace, "action_started", { sourceMismatch: Boolean(sourceMismatch), action: command.action?.type });
    const result = sourceMismatch
      ? {
          ok: false,
          error: sourceMismatch,
          after: before,
          metadata: { actualUrl: tab.url ?? before?.url, actualTitle: tab.title ?? before?.title, permission: permission.permission }
        }
      : await executeBrowserActionCommand(tab, command);
    traceMark(trace, "action_completed", { ok: result.ok, metadata: result.metadata });
    traceMark(trace, "after_snapshot_started", { tabNavigation: Boolean(result.metadata?.tabNavigation) });
    const after = result.metadata?.tabNavigation && result.after
      ? result.after
      : await readPostActionSnapshot(tab.id, command.action, result.after);
    traceMark(trace, "after_snapshot_completed", {
      hasSnapshot: Boolean(after),
      url: after?.url,
      readyState: after?.readyState
    });
    const afterTab = await safeReadTab(tab.id) ?? tab;
    traceMark(trace, "result_post_started");
    await postBrowserActionResultWithRetry(resultUrl, {
      requestId: command.requestId,
      ok: result.ok,
      before,
      after,
      error: result.error,
      metadata: {
        ...result.metadata,
        actualTab: {
          tabId: afterTab.id ?? tab.id,
          windowId: afterTab.windowId ?? tab.windowId,
          url: afterTab.url ?? after?.url ?? tab.url,
          title: afterTab.title ?? after?.title ?? tab.title
        },
        permission: permission.permission,
        bridgeMode: "command_first",
        latencyTrace: finalizeBridgeLatencyTrace(trace)
      }
    });
    traceMark(trace, "result_posted");
    markBrowserActionCommandRecent(command.requestId);
    await setBridgeBadge(result.ok ? "IDLE" : "ERR", tab.id);
    return true;
  } finally {
    inFlightBrowserActionRequestIds.delete(command.requestId);
  }
}

function isDuplicateBrowserActionCommand(requestId) {
  pruneRecentBrowserActionRequestIds();
  return inFlightBrowserActionRequestIds.has(requestId) || recentBrowserActionRequestIds.has(requestId);
}

function markBrowserActionCommandInFlight(requestId) {
  pruneRecentBrowserActionRequestIds();
  inFlightBrowserActionRequestIds.add(requestId);
}

function markBrowserActionCommandRecent(requestId) {
  recentBrowserActionRequestIds.set(requestId, Date.now());
}

function pruneRecentBrowserActionRequestIds() {
  const now = Date.now();
  for (const [requestId, timestamp] of recentBrowserActionRequestIds.entries()) {
    if (now - timestamp > RECENT_BROWSER_ACTION_REQUEST_TTL_MS) {
      recentBrowserActionRequestIds.delete(requestId);
    }
  }
}

async function postBrowserActionCommandAck(settings, tab, command) {
  const ackUrl = resolveDaemonUrl(settings.daemonBaseUrl, DEFAULT_BROWSER_ACTION_COMMAND_ACK_PATH);
  await postJsonWithRetry(ackUrl, {
    requestId: command.requestId,
    action: command.action?.type,
    receivedAt: new Date().toISOString(),
    activeTab: {
      tabId: tab?.id,
      windowId: tab?.windowId,
      url: tab?.url,
      title: tab?.title
    }
  });
}

export async function executeBrowserPerceptionObserveCommand(tab, settings, permission, command) {
  const ackUrl = resolveDaemonUrl(settings.daemonBaseUrl, DEFAULT_BROWSER_ACTION_ACK_PATH);
  const resultUrl = resolveDaemonUrl(settings.daemonBaseUrl, DEFAULT_BROWSER_ACTION_OBSERVE_RESULT_PATH);
  const activeTab = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title,
    permission: permission.permission
  };
  const ackStatus = readObserveAckStatus(tab, permission, command);
  const trace = createBridgeLatencyTrace(command);
  traceMark(trace, "observe_ack_started", { ackStatus: ackStatus.status });
  await postJsonWithRetry(ackUrl, {
    commandId: command.commandId,
    status: ackStatus.status,
    activeTab,
    receivedAt: new Date().toISOString(),
    estimatedResultMs: ackStatus.status === "accepted" ? 350 : undefined,
    error: ackStatus.error,
    metadata: { latencyTrace: finalizeBridgeLatencyTrace(trace) }
  });
  traceMark(trace, "observe_ack_posted");
  if (ackStatus.status !== "accepted") {
    await postJsonWithRetry(resultUrl, {
      commandId: command.commandId,
      status: "failed",
      activeTab,
      resultPostedAt: new Date().toISOString(),
      error: ackStatus.error,
      metadata: { ackStatus: ackStatus.status, latencyTrace: finalizeBridgeLatencyTrace(trace) }
    });
    await setBridgeBadge(ackStatus.status === "missing_permission" ? "ASK" : "ERR", tab.id);
    return;
  }

  await setBridgeBadge("RUN", tab.id);
  try {
    traceMark(trace, "observe_snapshot_started", { settleQuietMs: command.settleQuietMs });
    const snapshot = await readStableSnapshotFromTab(tab.id, command);
    traceMark(trace, "observe_snapshot_completed", {
      url: snapshot?.url,
      readyState: snapshot?.readyState,
      mutationQuietMs: snapshot?.mutationQuietMs
    });
    const afterTab = await safeReadTab(tab.id) ?? tab;
    traceMark(trace, "observe_result_post_started");
    await postJsonWithRetry(resultUrl, {
      commandId: command.commandId,
      status: "succeeded",
      snapshot,
      activeTab: {
        tabId: afterTab.id ?? tab.id,
        windowId: afterTab.windowId ?? tab.windowId,
        url: afterTab.url ?? snapshot?.url ?? tab.url,
        title: afterTab.title ?? snapshot?.title ?? tab.title,
        permission: permission.permission
      },
      mutationRevision: snapshot?.mutationRevision,
      mutationQuietMs: snapshot?.mutationQuietMs,
      readyState: snapshot?.readyState,
      resultPostedAt: new Date().toISOString(),
      metadata: { bridgeMode: "perception_observe_now", reason: command.reason, latencyTrace: finalizeBridgeLatencyTrace(trace) }
    });
    traceMark(trace, "observe_result_posted");
    await setBridgeBadge("IDLE", tab.id);
  } catch (error) {
    await postJsonWithRetry(resultUrl, {
      commandId: command.commandId,
      status: "failed",
      activeTab,
      resultPostedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      metadata: { bridgeMode: "perception_observe_now", latencyTrace: finalizeBridgeLatencyTrace(trace) }
    });
    await setBridgeBadge("ERR", tab.id);
  }
}

function readObserveAckStatus(tab, permission, command) {
  if (permission.permission === "needs_site_permission") {
    return { status: "missing_permission", error: permission.detail ?? "Site permission is required before observation." };
  }
  if (permission.permission === "restricted") {
    return { status: "restricted_page", error: permission.detail ?? "This browser page is restricted." };
  }
  if (permission.permission !== "allowed") {
    return { status: "unsupported", error: permission.detail ?? "The active tab is unavailable for observation." };
  }
  try {
    assertTabCanRunBrowserAction(tab);
  } catch (error) {
    return { status: "restricted_page", error: error instanceof Error ? error.message : String(error) };
  }
  const expected = command.expectedActiveTab;
  if (expected?.tabId !== undefined && String(expected.tabId) !== String(tab.id)) {
    return { status: "wrong_tab", error: `Active tab mismatch: expected tab ${expected.tabId}, got ${tab.id}.` };
  }
  if (expected?.windowId !== undefined && String(expected.windowId) !== String(tab.windowId)) {
    return { status: "wrong_tab", error: `Active window mismatch: expected window ${expected.windowId}, got ${tab.windowId}.` };
  }
  return { status: "accepted" };
}

export function isBrowserActionPollOnlyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /^Browser Action poll failed \(\d+\)\.?$/.test(message) || /Failed to fetch/i.test(message);
}

export async function readSnapshotFromTab(tabId) {
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

export function assertTabCanRunBrowserAction(tab) {
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

async function executeBrowserActionCommand(tab, command) {
  try {
    const tabNavigation = await executeTabNavigationAction(tab, command.action);
    if (tabNavigation) {
      return tabNavigation;
    }
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

async function executeTabNavigationAction(tab, action) {
  if (!["navigate", "back", "forward", "reload"].includes(action?.type)) {
    return null;
  }
  if ((action.type === "back" && !chrome.tabs.goBack) || (action.type === "forward" && !chrome.tabs.goForward)) {
    return null;
  }
  if (!tab?.id) {
    return { ok: false, error: "Browser tab is unavailable for navigation.", after: null };
  }
  const before = readLightweightTabSnapshot(tab, "tab_navigation_before");
  try {
    if (action.type === "navigate") {
      if (!action.url) {
        throw new Error("Navigate action requires a URL.");
      }
      await callChromeTabApi((done) => chrome.tabs.update(tab.id, { url: action.url }, () => done()));
    } else if (action.type === "back") {
      await callChromeTabApi((done) => chrome.tabs.goBack(tab.id, () => done()));
    } else if (action.type === "forward") {
      await callChromeTabApi((done) => chrome.tabs.goForward(tab.id, () => done()));
    } else if (action.type === "reload") {
      await callChromeTabApi((done) => chrome.tabs.reload(tab.id, {}, () => done()));
    }
    const after = await readPostActionSnapshot(tab.id, action, before);
    if (requiresChangedNavigationObservation(action, before) && !hasChangedNavigationObservation(before, after)) {
      return {
        ok: false,
        error: "Browser tab navigation completed, but the changed page observation was not captured.",
        after,
        metadata: { tabNavigation: true, staleNavigationObservation: true }
      };
    }
    return { ok: true, after, metadata: { tabNavigation: true, method: readTabNavigationMethod(action.type), tabId: tab.id } };
  } catch (error) {
    const fallback = await safeReadSnapshotFromTab(tab.id);
    return { ok: false, error: error instanceof Error ? error.message : String(error), after: fallback ?? before, metadata: { tabNavigation: true } };
  }
}

function readTabNavigationMethod(type) {
  if (type === "navigate") {
    return "chrome.tabs.update";
  }
  if (type === "back") {
    return "chrome.tabs.goBack";
  }
  if (type === "forward") {
    return "chrome.tabs.goForward";
  }
  if (type === "reload") {
    return "chrome.tabs.reload";
  }
  return "unknown";
}

function isTargetlessTabNavigationAction(action) {
  return ["navigate", "back", "forward", "reload"].includes(action?.type);
}

function readLightweightTabSnapshot(tab, reason) {
  return {
    url: tab?.url ?? "",
    title: tab?.title ?? "",
    capturedAt: new Date().toISOString(),
    readyState: "complete",
    text: "",
    elements: [],
    bridge: {
      reason,
      observedAt: new Date().toISOString(),
      tabId: tab?.id,
      windowId: tab?.windowId,
      url: tab?.url,
      title: tab?.title
    }
  };
}

function callChromeTabApi(invoker) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (explicitError) => {
      if (settled) {
        return;
      }
      settled = true;
      const runtimeError = chrome.runtime?.lastError;
      const error = explicitError || (runtimeError ? new Error(runtimeError.message) : null);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    try {
      invoker(done);
    } catch (error) {
      reject(error);
    }
  });
}

async function safeReadSnapshotFromTab(tabId) {
  try {
    return await readSnapshotFromTab(tabId);
  } catch {
    return null;
  }
}

async function readStableSnapshotFromTab(tabId, command) {
  const quietTarget = Math.max(0, Number(command.settleQuietMs) || 0);
  const deadline = Date.parse(command.deadlineAt || "") || Date.now() + 10_000;
  let latest = null;
  const sleepMs = quietTarget <= 250 ? 80 : 150;
  while (Date.now() < deadline) {
    latest = await readSnapshotFromTab(tabId);
    const quietMs = Number(latest?.mutationQuietMs);
    if (latest?.readyState === "complete" && (!quietTarget || !Number.isFinite(quietMs) || quietMs >= quietTarget)) {
      return latest;
    }
    if (quietTarget && Number.isFinite(quietMs) && quietMs >= quietTarget) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
  return latest ?? await readSnapshotFromTab(tabId);
}

async function safeReadTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function readPostActionSnapshot(tabId, action, fallback) {
  if (!mayChangePage(action)) {
    return fallback ?? await safeReadSnapshotFromTab(tabId);
  }

  const fallbackUrl = fallback?.url ?? "";
  let latest = fallback ?? null;
  const maxAttempts = readPostActionSnapshotAttempts(action);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, readPostActionSnapshotDelayMs(action, attempt)));
    const snapshot = await safeReadSnapshotFromTab(tabId);
    if (!snapshot) {
      continue;
    }
    latest = snapshot;
    const urlChanged = fallbackUrl && normalizeUrlForSource(snapshot.url) !== normalizeUrlForSource(fallbackUrl);
    const routeChanged = readRouteKey(snapshot) && readRouteKey(snapshot) !== readRouteKey(fallback);
    const viewChanged = readViewRevision(snapshot) && readViewRevision(snapshot) !== readViewRevision(fallback);
    if (requiresChangedNavigationObservation(action, fallback)) {
      if (urlChanged || routeChanged || viewChanged) {
        return snapshot;
      }
      continue;
    }
    const waitedForClick = action?.type !== "click" || attempt >= 2;
    if (urlChanged || waitedForClick && (snapshot.readyState === "complete" || attempt >= 5)) {
      return snapshot;
    }
  }

  return latest ?? fallback ?? await safeReadSnapshotFromTab(tabId);
}

function readPostActionSnapshotAttempts(action) {
  if (["back", "forward", "navigate", "reload"].includes(action?.type)) {
    return 10;
  }
  if (action?.type === "click") {
    return 12;
  }
  return 6;
}

function readPostActionSnapshotDelayMs(action, attempt) {
  if (["back", "forward", "navigate", "reload"].includes(action?.type)) {
    return attempt < 3 ? 80 : attempt < 7 ? 160 : 300;
  }
  if (action?.type === "click") {
    return attempt < 3 ? 120 : attempt < 8 ? 220 : 400;
  }
  return 120;
}

function mayChangePage(action) {
  return ["click", "navigate", "back", "forward", "reload"].includes(action?.type);
}

function requiresChangedNavigationObservation(action, before) {
  if (action?.type === "navigate") {
    return Boolean(action.url) && normalizeUrlForSource(action.url) !== normalizeUrlForSource(before?.url);
  }
  return ["back", "forward"].includes(action?.type);
}

function hasChangedNavigationObservation(before, after) {
  if (!before || !after) {
    return false;
  }
  return normalizeUrlForSource(before.url) !== normalizeUrlForSource(after.url) ||
    Boolean(readRouteKey(before) && readRouteKey(after) && readRouteKey(before) !== readRouteKey(after)) ||
    Boolean(readViewRevision(before) && readViewRevision(after) && readViewRevision(before) !== readViewRevision(after));
}

function readRouteKey(snapshot) {
  return snapshot?.viewGraph?.identity?.routeKey || snapshot?.routeKey || "";
}

function readViewRevision(snapshot) {
  return snapshot?.viewGraph?.identity?.viewRevision || snapshot?.viewRevision || snapshot?.mutationRevision || "";
}

async function postBrowserActionResultWithRetry(url, payload) {
  return postJsonWithRetry(url, payload);
}

async function postJsonWithRetry(url, payload) {
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
      lastError = new Error(`Browser Bridge result post failed (${post.status}).`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("Browser Bridge result post failed.");
}

function detectSourceMismatch(expected, tab, before, action) {
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
  const expectedRouteKey = expected.routeKey || "";
  const actualRouteKey = before?.viewGraph?.identity?.routeKey || "";
  if (isHistoryNavigationAction(action)) {
    return "";
  }
  if (expectedRouteKey && actualRouteKey && expectedRouteKey === actualRouteKey) {
    return "";
  }
  if (expectedUrl && actualUrl && normalizeUrlForSource(expectedUrl) !== normalizeUrlForSource(actualUrl)) {
    return `Active tab URL changed before Browser Action execution: expected ${expectedUrl}, got ${actualUrl}.`;
  }
  return "";
}

function isHistoryNavigationAction(action) {
  return action?.type === "back" || action?.type === "forward" || action?.type === "reload";
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

function createBridgeLatencyTrace(command) {
  const startedAt = Date.now();
  return {
    schemaVersion: "browser-bridge-latency.v1",
    commandId: command?.commandId,
    requestId: command?.requestId,
    action: command?.action?.type,
    startedAt,
    events: [
      { name: "extension_command_received", at: new Date(startedAt).toISOString(), elapsedMs: 0 }
    ]
  };
}

function traceMark(trace, name, detail) {
  const now = Date.now();
  trace.events.push({
    name,
    at: new Date(now).toISOString(),
    elapsedMs: Math.max(0, now - trace.startedAt),
    ...(detail && typeof detail === "object" ? { detail } : {})
  });
}

function finalizeBridgeLatencyTrace(trace) {
  return {
    schemaVersion: trace.schemaVersion,
    commandId: trace.commandId,
    requestId: trace.requestId,
    action: trace.action,
    totalElapsedMs: Math.max(0, Date.now() - trace.startedAt),
    events: trace.events
  };
}
