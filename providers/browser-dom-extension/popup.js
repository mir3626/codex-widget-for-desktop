const DEFAULT_SETTINGS = {
  daemonBaseUrl: "http://127.0.0.1:4128",
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

const fields = {
  badge: document.querySelector("#badge"),
  connection: document.querySelector("#connection"),
  tabState: document.querySelector("#tab-state"),
  diagnostic: document.querySelector("#diagnostic"),
  daemonBaseUrl: document.querySelector("#daemon-base-url"),
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
  render(response.status, response.settings);
}

async function saveSettings() {
  const settings = readSettingsFromForm();
  const permission = await syncAllSitesPermission(settings.allowAllSites);
  if (!permission.ok && settings.allowAllSites) {
    settings.allowAllSites = false;
  }
  const response = await sendMessage({ type: "bridge.saveSettings", settings });
  render(response.status, response.settings);
  setStatus(response.ok
    ? permission.ok
      ? "Saved Browser Bridge settings."
      : permission.error ?? "All-sites permission was not granted."
    : response.error ?? "Save failed.");
}

async function resetSettings() {
  const response = await sendMessage({ type: "bridge.resetSettings" });
  render(response.status, response.settings);
  setStatus(response.ok ? "Default Browser Bridge settings restored." : response.error ?? "Reset failed.");
}

async function testConnection() {
  const response = await sendMessage({ type: "bridge.testConnection" });
  render(response.status, response.settings);
  setStatus(response.ok ? "Widget daemon connection is OK." : response.status?.lastError ?? response.error ?? "Connection failed.");
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
  render(response.status, response.settings);
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
  render(response.status, response.settings);
  setStatus(response.ok ? "Debug page capture sent." : response.error ?? "Debug capture failed.");
}

function render(status = {}, settings = DEFAULT_SETTINGS) {
  latestStatus = status ?? {};
  const state = readState(status);
  fields.badge.textContent = state.badge;
  fields.badge.style.background = state.color;
  fields.badge.style.color = state.textColor;
  fields.connection.textContent = state.connection;
  fields.tabState.textContent = state.tab;
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

function normalizeObserveBlocklist(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\n,]/);
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    const normalized = String(item ?? "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/\/\*$/, "")
      .replace(/\/$/, "")
      .toLowerCase();
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

function readCurrentOrigin() {
  const origin = latestStatus?.activeTab?.origin || originPatternForUrl(latestStatus?.activeTab?.url);
  if (origin) {
    return origin;
  }
  return originPatternForUrl(fields.tabState.textContent);
}

function originPatternForUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return `${url.origin}/*`;
  } catch {
    return "";
  }
}

function requestSitePermission(origin) {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins: [origin] }, (granted) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, origin, error: error.message });
        return;
      }
      resolve(granted ? { ok: true, origin } : { ok: false, origin, error: "Site permission was not granted." });
    });
  });
}

async function syncAllSitesPermission(enabled) {
  if (enabled) {
    return requestAllSitesPermission();
  }
  return removeAllSitesPermission();
}

function requestAllSitesPermission() {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }, (granted) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      resolve(granted ? { ok: true } : { ok: false, error: "All-sites permission was not granted." });
    });
  });
}

function removeAllSitesPermission() {
  return new Promise((resolve) => {
    chrome.permissions.remove({ origins: ["http://*/*", "https://*/*"] }, () => {
      const error = chrome.runtime.lastError;
      resolve(error ? { ok: false, error: error.message } : { ok: true });
    });
  });
}

function readState(status) {
  if (!status.connected || status.mode === "off" || status.mode === "disconnected") {
    return {
      badge: "OFF",
      color: "#dfe8e5",
      textColor: "#263532",
      connection: "Widget disconnected",
      tab: status.lastError ?? "Start Codex Widget or check the daemon URL."
    };
  }
  if (status.mode === "permission_needed") {
    return {
      badge: "ASK",
      color: "#fde7bf",
      textColor: "#7c4a03",
      connection: "Site permission needed",
      tab: status.activeTab?.origin ?? status.activeTab?.url ?? "Enable this site to allow Browser Action."
    };
  }
  if (status.mode === "restricted" || status.mode === "error") {
    return {
      badge: "ERR",
      color: "#f6d5d5",
      textColor: "#8a1f1f",
      connection: status.mode === "restricted" ? "Restricted page" : "Bridge failed",
      tab: status.lastError ?? "Open a supported http or https page."
    };
  }
  if (status.mode === "running") {
    return {
      badge: "RUN",
      color: "#d8e8ff",
      textColor: "#194f9b",
      connection: "Browser Action running",
      tab: status.activeTab?.title ?? status.activeTab?.url ?? "Current tab"
    };
  }
  return {
    badge: "IDLE",
    color: "#d8eee7",
    textColor: "#075f53",
    connection: "Browser connected",
    tab: status.activeTab?.title ?? status.activeTab?.url ?? "Ready"
  };
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      resolve(response ?? { ok: false, error: "No Browser Bridge response." });
    });
  });
}

function normalizeDaemonBaseUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
      url.pathname = "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // Use the safe local default below.
  }
  return DEFAULT_SETTINGS.daemonBaseUrl;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function setStatus(message) {
  fields.status.textContent = message;
}
