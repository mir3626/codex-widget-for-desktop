import type { BrowserExtensionBridgeStatus } from "../../../shared/protocol.js";

const BROWSER_EXTENSION_BRIDGE_STALE_MS = 90_000;

export type BrowserExtensionBridgeStore = {
  update: (status: BrowserExtensionBridgeStatus) => BrowserExtensionBridgeStatus;
  snapshot: () => BrowserExtensionBridgeStatus;
};

export function createBrowserExtensionBridgeStore(): BrowserExtensionBridgeStore {
  let latest: BrowserExtensionBridgeStatus = {
    connected: false,
    mode: "disconnected",
    updatedAt: new Date(0).toISOString(),
    lastError: "Browser Bridge has not connected yet.",
    activeTab: { permission: "unknown" }
  };

  return {
    update(status) {
      latest = normalizeBrowserExtensionBridgeStatus(status);
      return latest;
    },
    snapshot() {
      if (latest.lastSeenAt && Date.now() - Date.parse(latest.lastSeenAt) > BROWSER_EXTENSION_BRIDGE_STALE_MS) {
        return {
          ...latest,
          connected: false,
          mode: "disconnected",
          lastError: "Browser Bridge heartbeat is stale."
        };
      }
      return latest;
    }
  };
}

function normalizeBrowserExtensionBridgeStatus(input: unknown): BrowserExtensionBridgeStatus {
  const record = readRecord(input) ?? {};
  const activeTab = readRecord(record.activeTab);
  const settings = readRecord(record.settings);
  const now = new Date().toISOString();
  const mode = readBrowserExtensionBridgeMode(record.mode);
  const permission = readBrowserExtensionBridgePermission(activeTab?.permission);
  return {
    extensionVersion: readOptionalString(record.extensionVersion),
    daemonBaseUrl: readOptionalString(record.daemonBaseUrl),
    connected: record.connected === true,
    mode,
    reason: readOptionalString(record.reason),
    updatedAt: readOptionalString(record.updatedAt) ?? now,
    lastSeenAt: now,
    lastObservationAt: readOptionalString(record.lastObservationAt),
    lastCommandId: readOptionalString(record.lastCommandId),
    lastError: readOptionalString(record.lastError) ?? null,
    nativeHost: readBrowserExtensionNativeHost(record.nativeHost),
    activeTab: {
      tabId: readId(activeTab?.tabId),
      windowId: readId(activeTab?.windowId),
      url: readOptionalString(activeTab?.url),
      title: readOptionalString(activeTab?.title),
      origin: readOptionalString(activeTab?.origin),
      permission,
      detail: readOptionalString(activeTab?.detail)
    },
    settings: settings
      ? {
          daemonBaseUrl: readOptionalString(settings.daemonBaseUrl),
          autoConnect: readOptionalBoolean(settings.autoConnect),
          autoObserve: readOptionalBoolean(settings.autoObserve),
          allowAllSites: readOptionalBoolean(settings.allowAllSites),
          observeBlocklist: readOptionalStringList(settings.observeBlocklist),
          allowSafeReadScroll: readOptionalBoolean(settings.allowSafeReadScroll),
          requireApprovalForClickType: readOptionalBoolean(settings.requireApprovalForClickType),
          useNativeHost: readOptionalBoolean(settings.useNativeHost),
          debugSnapshot: readOptionalBoolean(settings.debugSnapshot),
          pollIntervalSeconds: readOptionalNumber(settings.pollIntervalSeconds)
        }
      : undefined
  };
}

function readBrowserExtensionBridgeMode(value: unknown): BrowserExtensionBridgeStatus["mode"] {
  return value === "off" ||
    value === "checking" ||
    value === "disconnected" ||
    value === "idle" ||
    value === "running" ||
    value === "permission_needed" ||
    value === "restricted" ||
    value === "error"
    ? value
    : "disconnected";
}

function readBrowserExtensionBridgePermission(value: unknown): NonNullable<BrowserExtensionBridgeStatus["activeTab"]>["permission"] {
  return value === "allowed" ||
    value === "needs_site_permission" ||
    value === "restricted" ||
    value === "unavailable" ||
    value === "unknown"
    ? value
    : "unknown";
}

function readBrowserExtensionNativeHost(value: unknown): BrowserExtensionBridgeStatus["nativeHost"] {
  return value === "enabled" ||
    value === "disabled" ||
    value === "available" ||
    value === "unavailable" ||
    value === "unknown"
    ? value
    : "unknown";
}

function readId(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return readOptionalString(value);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readOptionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item) => readOptionalString(item))
    .filter((item): item is string => Boolean(item));
}
