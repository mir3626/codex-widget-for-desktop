export const DEFAULT_SETTINGS = {
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

export function normalizeObserveBlocklist(value) {
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

export function originPatternForUrl(value) {
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

export function requestSitePermission(origin) {
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

export async function syncAllSitesPermission(enabled) {
  if (enabled) {
    return requestAllSitesPermission();
  }
  return removeAllSitesPermission();
}

export function readState(status) {
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

export function sendMessage(message) {
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

export function normalizeDaemonBaseUrl(value) {
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

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(number)));
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
