import { collectDomSnapshot, executeBrowserActionInPage } from "./injected-dom.js";
import {
  DEFAULT_BROWSER_ACTION_ACK_PATH,
  DEFAULT_BROWSER_ACTION_OBSERVE_RESULT_PATH,
  DEFAULT_BROWSER_ACTION_POLL_PATH,
  DEFAULT_BROWSER_ACTION_RESULT_PATH
} from "./config.js";
import { resolveDaemonUrl } from "./settings.js";
import { setBridgeBadge } from "./badge.js";
import { readTabPermission } from "./tab-state.js";

export async function pollAndExecuteBrowserAction(tab, settings) {
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
  if (command?.kind === "observe_now") {
    await executeBrowserPerceptionObserveCommand(tab, settings, permission, command);
    return;
  }
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
  const after = await readPostActionSnapshot(tab.id, command.action, result.after);
  const afterTab = await safeReadTab(tab.id) ?? tab;
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
      bridgeMode: "command_first"
    }
  });
  await setBridgeBadge(result.ok ? "IDLE" : "ERR", tab.id);
}

async function executeBrowserPerceptionObserveCommand(tab, settings, permission, command) {
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
  await postJsonWithRetry(ackUrl, {
    commandId: command.commandId,
    status: ackStatus.status,
    activeTab,
    receivedAt: new Date().toISOString(),
    estimatedResultMs: ackStatus.status === "accepted" ? 350 : undefined,
    error: ackStatus.error
  });
  if (ackStatus.status !== "accepted") {
    await postJsonWithRetry(resultUrl, {
      commandId: command.commandId,
      status: "failed",
      activeTab,
      resultPostedAt: new Date().toISOString(),
      error: ackStatus.error,
      metadata: { ackStatus: ackStatus.status }
    });
    await setBridgeBadge(ackStatus.status === "missing_permission" ? "ASK" : "ERR", tab.id);
    return;
  }

  await setBridgeBadge("RUN", tab.id);
  try {
    const snapshot = await readStableSnapshotFromTab(tab.id, command);
    const afterTab = await safeReadTab(tab.id) ?? tab;
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
      metadata: { bridgeMode: "perception_observe_now", reason: command.reason }
    });
    await setBridgeBadge("IDLE", tab.id);
  } catch (error) {
    await postJsonWithRetry(resultUrl, {
      commandId: command.commandId,
      status: "failed",
      activeTab,
      resultPostedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      metadata: { bridgeMode: "perception_observe_now" }
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

async function readStableSnapshotFromTab(tabId, command) {
  const quietTarget = Math.max(0, Number(command.settleQuietMs) || 0);
  const deadline = Date.parse(command.deadlineAt || "") || Date.now() + 10_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readSnapshotFromTab(tabId);
    const quietMs = Number(latest?.mutationQuietMs);
    if (latest?.readyState === "complete" && (!quietTarget || !Number.isFinite(quietMs) || quietMs >= quietTarget)) {
      return latest;
    }
    if (quietTarget && Number.isFinite(quietMs) && quietMs >= quietTarget) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
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
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 250 : 500));
    }
    const snapshot = await safeReadSnapshotFromTab(tabId);
    if (!snapshot) {
      continue;
    }
    const urlChanged = fallbackUrl && normalizeUrlForSource(snapshot.url) !== normalizeUrlForSource(fallbackUrl);
    const waitedForClick = action?.type !== "click" || attempt >= 2;
    if (urlChanged || waitedForClick && (snapshot.readyState === "complete" || attempt >= 5)) {
      return snapshot;
    }
  }

  return fallback ?? await safeReadSnapshotFromTab(tabId);
}

function mayChangePage(action) {
  return ["click", "navigate", "back", "forward", "reload"].includes(action?.type);
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
  const expectedRouteKey = expected.routeKey || "";
  const actualRouteKey = before?.viewGraph?.identity?.routeKey || "";
  if (expectedRouteKey && actualRouteKey && expectedRouteKey === actualRouteKey) {
    return "";
  }
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
