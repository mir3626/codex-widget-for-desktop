import {
  DEFAULT_SETTINGS,
  clampNumber,
  normalizeDaemonBaseUrl,
  normalizeObserveBlocklist,
  originPatternForUrl,
  readState,
  requestSitePermission,
  sendMessage,
  syncAllSitesPermission
} from "./popup-utils.js";

const fields = {
  badge: document.querySelector("#badge"),
  connection: document.querySelector("#connection"),
  tabState: document.querySelector("#tab-state"),
  buildState: document.querySelector("#build-state"),
  diagnostic: document.querySelector("#diagnostic"),
  daemonBaseUrl: document.querySelector("#daemon-base-url"),
  reloadExtension: document.querySelector("#reload-extension"),
  autoConnect: document.querySelector("#auto-connect"),
  autoObserve: document.querySelector("#auto-observe"),
  allowAllSites: document.querySelector("#allow-all-sites"),
  observeBlocklist: document.querySelector("#observe-blocklist"),
  toggleCurrentSiteBlock: document.querySelector("#toggle-current-site-block"),
  allowSafeReadScroll: document.querySelector("#allow-safe-read-scroll"),
  requireApprovalForClickType: document.querySelector("#require-approval-click-type"),
  nativeHost: document.querySelector("#native-host"),
  pollInterval: document.querySelector("#poll-interval"),
  debugSnapshot: document.querySelector("#debug-snapshot"),
  status: document.querySelector("#status")
};
let latestStatus = null;

document.querySelector("#save").addEventListener("click", () => {
  void saveSettings();
});

document.querySelector("#reset").addEventListener("click", () => {
  void resetSettings();
});

document.querySelector("#test-connection").addEventListener("click", () => {
  void testConnection();
});

document.querySelector("#enable-site").addEventListener("click", () => {
  void enableCurrentSite();
});

fields.reloadExtension?.addEventListener("click", () => {
  reloadExtension();
});

document.querySelector("#debug-capture").addEventListener("click", () => {
  void debugCapture();
});

fields.toggleCurrentSiteBlock.addEventListener("click", () => {
  void toggleCurrentSiteBlock();
});

void refresh();

async function refresh() {
  const response = await sendMessage({ type: "bridge.getStatus" });
  if (!response.ok) {
    setStatus(response.error ?? "Unable to read Browser Bridge status.");
    return;
  }
  const status = await readDaemonReportedStatus(response.status, response.settings);
  render(status, response.settings);
}

async function saveSettings() {
  const settings = readSettingsFromForm();
  const permission = await syncAllSitesPermission(settings.allowAllSites);
  if (!permission.ok && settings.allowAllSites) {
    settings.allowAllSites = false;
  }
  const response = await sendMessage({ type: "bridge.saveSettings", settings });
  const status = await readDaemonReportedStatus(response.status, response.settings);
  render(status, response.settings);
  setStatus(response.ok
    ? permission.ok
      ? "Saved Browser Bridge settings."
      : permission.error ?? "All-sites permission was not granted."
    : response.error ?? "Save failed.");
}

async function resetSettings() {
  const response = await sendMessage({ type: "bridge.resetSettings" });
  const status = await readDaemonReportedStatus(response.status, response.settings);
  render(status, response.settings);
  setStatus(response.ok ? "Default Browser Bridge settings restored." : response.error ?? "Reset failed.");
}

async function testConnection() {
  const response = await sendMessage({ type: "bridge.testConnection" });
  const status = await readDaemonReportedStatus(response.status, response.settings);
  render(status, response.settings);
  setStatus(response.ok ? "Widget daemon connection is OK." : status?.lastError ?? response.error ?? "Connection failed.");
}

async function enableCurrentSite() {
  const origin = readCurrentOrigin();
  if (!origin) {
    setStatus("Current page cannot grant Browser Bridge permission.");
    return;
  }

  setStatus(`Requesting Browser Bridge permission for ${origin}`);
  const permission = await requestSitePermission(origin);
  const response = await sendMessage({
    type: "bridge.refresh",
    reason: permission.ok ? "site_enabled" : "site_permission_denied"
  });
  const status = await readDaemonReportedStatus(response.status, response.settings);
  render(status, response.settings);
  setStatus(permission.ok ? "Current site enabled." : permission.error ?? "Site permission was not granted.");
}

async function toggleCurrentSiteBlock() {
  const current = readCurrentBlockPattern();
  if (!current) {
    setStatus("Current page cannot be added to the observe blocklist.");
    return;
  }
  const list = normalizeObserveBlocklist(fields.observeBlocklist.value);
  const index = list.indexOf(current);
  if (index >= 0) {
    list.splice(index, 1);
  } else {
    list.push(current);
  }
  fields.observeBlocklist.value = list.join("\n");
  await saveSettings();
  setStatus(index >= 0 ? `Removed ${current} from observe blocklist.` : `Added ${current} to observe blocklist.`);
}

async function debugCapture() {
  const response = await sendMessage({ type: "bridge.debugSnapshot" });
  const status = await readDaemonReportedStatus(response.status, response.settings);
  render(status, response.settings);
  setStatus(response.ok ? "Debug page capture sent." : response.error ?? "Debug capture failed.");
}

async function readDaemonReportedStatus(status = {}, settings = DEFAULT_SETTINGS) {
  try {
    const baseUrl = normalizeDaemonBaseUrl(settings?.daemonBaseUrl ?? status?.daemonBaseUrl ?? fields.daemonBaseUrl?.value);
    const url = new URL(baseUrl);
    url.pathname = "/browser-action/extension/status";
    url.search = "";
    url.hash = "";
    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) {
      return status;
    }
    const payload = await response.json().catch(() => null);
    if (!payload?.status || typeof payload.status !== "object") {
      return status;
    }
    return mergeStatus(status, payload.status);
  } catch {
    return status;
  }
}

function mergeStatus(target = {}, source = {}) {
  return {
    ...target,
    ...source,
    activeTab: {
      ...(target.activeTab && typeof target.activeTab === "object" ? target.activeTab : {}),
      ...(source.activeTab && typeof source.activeTab === "object" ? source.activeTab : {})
    },
    settings: {
      ...(target.settings && typeof target.settings === "object" ? target.settings : {}),
      ...(source.settings && typeof source.settings === "object" ? source.settings : {})
    }
  };
}

function render(status = {}, settings = DEFAULT_SETTINGS) {
  latestStatus = status ?? {};
  const state = readState(status);
  fields.badge.textContent = state.badge;
  fields.badge.style.background = state.color;
  fields.badge.style.color = state.textColor;
  fields.connection.textContent = state.connection;
  fields.tabState.textContent = state.tab;
  fields.buildState.textContent = summarizeBuildState(status);
  if (fields.reloadExtension) {
    fields.reloadExtension.hidden = !isReloadRequired(status);
  }
  fields.diagnostic.textContent = status.lastError ?? status.reason ?? "";

  fields.daemonBaseUrl.value = settings.daemonBaseUrl ?? DEFAULT_SETTINGS.daemonBaseUrl;
  fields.autoConnect.checked = settings.autoConnect !== false;
  fields.autoObserve.checked = settings.autoObserve !== false;
  fields.allowAllSites.checked = settings.allowAllSites === true;
  fields.observeBlocklist.value = normalizeObserveBlocklist(settings.observeBlocklist).join("\n");
  const currentBlock = readCurrentBlockPattern();
  fields.toggleCurrentSiteBlock.textContent = currentBlock && normalizeObserveBlocklist(settings.observeBlocklist).includes(currentBlock)
    ? "Unblock current site"
    : "Block current site";
  fields.allowSafeReadScroll.checked = settings.allowSafeReadScroll !== false;
  fields.requireApprovalForClickType.checked = settings.requireApprovalForClickType !== false;
  fields.nativeHost.checked = settings.useNativeHost !== false;
  fields.debugSnapshot.checked = settings.debugSnapshot === true;
  fields.pollInterval.value = String(settings.pollIntervalSeconds ?? DEFAULT_SETTINGS.pollIntervalSeconds);
}

function summarizeBuildState(status) {
  const buildId = status.extensionBuildId || status.extensionVersion || "unknown";
  return isReloadRequired(status)
    ? `Build: ${buildId} · reload required. Use Reload bridge after saving diagnostics.`
    : `Build: ${buildId}`;
}

function isReloadRequired(status) {
  if (status?.reloadRequired === true) {
    return true;
  }
  return Boolean(
    status?.extensionSourceHash &&
    status?.expectedExtensionSourceHash &&
    status.extensionSourceHash !== status.expectedExtensionSourceHash
  );
}

function reloadExtension() {
  setStatus("Reloading Browser Bridge...");
  chrome.runtime.reload();
}

function readSettingsFromForm() {
  return {
    daemonBaseUrl: normalizeDaemonBaseUrl(fields.daemonBaseUrl.value),
    autoConnect: fields.autoConnect.checked,
    autoObserve: fields.autoObserve.checked,
    allowAllSites: fields.allowAllSites.checked,
    observeBlocklist: normalizeObserveBlocklist(fields.observeBlocklist.value),
    allowSafeReadScroll: fields.allowSafeReadScroll.checked,
    requireApprovalForClickType: fields.requireApprovalForClickType.checked,
    useNativeHost: fields.nativeHost.checked,
    debugSnapshot: fields.debugSnapshot.checked,
    pollIntervalSeconds: clampNumber(fields.pollInterval.value, 5, 120, DEFAULT_SETTINGS.pollIntervalSeconds)
  };
}

function readCurrentBlockPattern() {
  try {
    const url = new URL(String(latestStatus?.activeTab?.url ?? "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.origin.toLowerCase();
  } catch {
    return "";
  }
}

function readCurrentOrigin() {
  const origin = latestStatus?.activeTab?.origin || originPatternForUrl(latestStatus?.activeTab?.url);
  if (origin) {
    return origin;
  }
  return originPatternForUrl(fields.tabState.textContent);
}

function setStatus(message) {
  fields.status.textContent = message;
}
