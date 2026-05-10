import {
  BRIDGE_ALARM_NAME,
  DEFAULT_DAEMON_BASE_URL,
  DEFAULT_DAEMON_DOM_SNAPSHOT_URL
} from "./config.js";

export const DEFAULT_SETTINGS = {
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

export async function readBridgeSettings() {
  return normalizeBridgeSettings(await readStorage(DEFAULT_SETTINGS));
}

export function normalizeBridgeSettings(value) {
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

export function sanitizeSettings(settings) {
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

export function writeStorage(values) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(values, resolve);
  });
}

export async function configureBridgeAlarm(settings) {
  await chrome.alarms.clear(BRIDGE_ALARM_NAME);
  if (!settings.autoConnect) {
    return;
  }
  await chrome.alarms.create(BRIDGE_ALARM_NAME, {
    delayInMinutes: 0.1,
    periodInMinutes: Math.max(0.5, settings.pollIntervalSeconds / 60)
  });
}

export function normalizeDaemonBaseUrl(value) {
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

export function resolveDaemonUrl(baseUrl, pathname) {
  const url = new URL(normalizeDaemonBaseUrl(baseUrl));
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function readError(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function readStorage(defaults) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaults, resolve);
  });
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

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(number)));
}
