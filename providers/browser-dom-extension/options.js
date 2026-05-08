const DEFAULT_DAEMON_BASE_URL = "http://127.0.0.1:4128";

const input = document.querySelector("#daemon-url");
const allowAllSites = document.querySelector("#allow-all-sites");
const observeBlocklist = document.querySelector("#observe-blocklist");
const saveButton = document.querySelector("#save");
const resetButton = document.querySelector("#reset");
const status = document.querySelector("#status");

void loadOptions();

saveButton.addEventListener("click", () => {
  void saveOptions();
});

resetButton.addEventListener("click", () => {
  input.value = DEFAULT_DAEMON_BASE_URL;
  allowAllSites.checked = false;
  observeBlocklist.value = "";
  void saveOptions("Default URL restored.");
});

async function loadOptions() {
  const stored = await readStorage({
    daemonBaseUrl: DEFAULT_DAEMON_BASE_URL,
    daemonUrl: DEFAULT_DAEMON_BASE_URL,
    allowAllSites: false,
    observeBlocklist: []
  });
  input.value = normalizeDaemonBaseUrl(stored.daemonBaseUrl ?? stored.daemonUrl);
  allowAllSites.checked = stored.allowAllSites === true;
  observeBlocklist.value = normalizeObserveBlocklist(stored.observeBlocklist).join("\n");
}

async function saveOptions(message = "Saved.") {
  const normalized = normalizeDaemonBaseUrl(input.value);
  if (normalized !== input.value.trim()) {
    setStatus("Saved normalized local daemon base URL.");
    input.value = normalized;
  }

  const allSitesPermission = await syncAllSitesPermission(allowAllSites.checked);
  const nextAllowAllSites = allowAllSites.checked && allSitesPermission.ok;
  if (!allSitesPermission.ok && allowAllSites.checked) {
    allowAllSites.checked = false;
  }

  await writeStorage({
    daemonBaseUrl: normalized,
    daemonUrl: `${normalized}/providers/dom/snapshot`,
    allowAllSites: nextAllowAllSites,
    observeBlocklist: normalizeObserveBlocklist(observeBlocklist.value)
  });
  setStatus(allSitesPermission.ok ? message : allSitesPermission.error ?? "All-sites permission was not granted.");
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

function normalizeDaemonBaseUrl(value) {
  if (typeof value !== "string") {
    return DEFAULT_DAEMON_BASE_URL;
  }

  try {
    const url = new URL(value.trim());
    const isLocalHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const isHttp = url.protocol === "http:";
    if (isLocalHost && isHttp) {
      url.pathname = "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // Fall through to the safe local default.
  }

  return DEFAULT_DAEMON_BASE_URL;
}

function setStatus(message) {
  status.textContent = message;
}
