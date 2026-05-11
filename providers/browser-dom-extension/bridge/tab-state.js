import {
  ALL_SITE_ORIGINS,
  BRIDGE_SOURCE_HASH_FILES,
  DEFAULT_BROWSER_ACTION_HEARTBEAT_PATH
} from "./config.js";
import {
  readError,
  resolveDaemonUrl,
  sanitizeSettings
} from "./settings.js";

let cachedBuildInfo = null;

export async function readActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs[0]) {
    return tabs[0];
  }
  const fallback = await chrome.tabs.query({ active: true, currentWindow: true });
  return fallback[0] ?? null;
}

export function createBaseStatus({ settings, tab, reason, buildInfo }) {
  const manifest = chrome.runtime.getManifest();
  return {
    extensionVersion: manifest.version,
    extensionBuildId: buildInfo?.extensionBuildId,
    extensionSourceHash: buildInfo?.extensionSourceHash,
    extensionRuntimeId: chrome.runtime.id,
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

export async function readExtensionBuildInfo() {
  if (cachedBuildInfo) {
    return cachedBuildInfo;
  }
  const manifest = chrome.runtime.getManifest();
  try {
    const hash = await hashExtensionSources(BRIDGE_SOURCE_HASH_FILES);
    cachedBuildInfo = {
      extensionVersion: manifest.version,
      extensionSourceHash: hash,
      extensionBuildId: `${manifest.version}:${hash.slice(0, 12)}`
    };
  } catch (error) {
    console.debug("[Codex Widget] Browser Bridge source hash failed.", error);
    cachedBuildInfo = {
      extensionVersion: manifest.version,
      extensionBuildId: `${manifest.version}:unhashed`
    };
  }
  return cachedBuildInfo;
}

async function hashExtensionSources(files) {
  const chunks = [];
  for (const relativePath of files) {
    const response = await fetch(chrome.runtime.getURL(relativePath), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Unable to read extension resource ${relativePath} (${response.status}).`);
    }
    chunks.push(relativePath, "\0", await response.text(), "\0");
  }
  const bytes = new TextEncoder().encode(chunks.join(""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function testDaemonConnection(baseUrl) {
  try {
    const response = await fetch(resolveDaemonUrl(baseUrl, "/storage/health"), { method: "GET" });
    return response.ok
      ? { ok: true }
      : { ok: false, error: `Widget daemon health check failed (${response.status}).` };
  } catch (error) {
    return { ok: false, error: readError(error) };
  }
}

export async function postHeartbeat(baseUrl, status) {
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

export async function readTabPermission(tab, settings) {
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

function escapeRegExp(value) {
  return String(value).replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
