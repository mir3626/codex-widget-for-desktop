import type { BrowserExtensionBridgeStatus } from "../../../shared/protocol.js";
import type { BrowserBridgeExpectedBuildInfo } from "./extensionBuild.js";

const BROWSER_EXTENSION_BRIDGE_STALE_MS = 90_000;

export type BrowserExtensionBridgeStore = {
  update: (status: BrowserExtensionBridgeStatus, context?: BrowserExtensionBridgeRequestContext) => BrowserExtensionBridgeStatus;
  snapshot: () => BrowserExtensionBridgeStatus;
  authorizeExtensionRequest: (context?: BrowserExtensionBridgeRequestContext & { requireTrusted?: boolean }) => BrowserExtensionBridgeTrustDecision;
};

export type BrowserExtensionBridgeRequestContext = {
  requestOrigin?: string;
};

export type BrowserExtensionBridgeTrustDecision = {
  ok: true;
} | {
  ok: false;
  status: 403;
  code: string;
  error: string;
};

export class BrowserExtensionBridgeTrustError extends Error {
  readonly status = 403;
  readonly code: string;

  constructor(decision: Exclude<BrowserExtensionBridgeTrustDecision, { ok: true }>) {
    super(decision.error);
    this.name = "BrowserExtensionBridgeTrustError";
    this.code = decision.code;
  }
}

export function createBrowserExtensionBridgeStore(input: { expectedBuild?: BrowserBridgeExpectedBuildInfo } = {}): BrowserExtensionBridgeStore {
  let trustedExtensionOrigin: string | undefined;
  let latest: BrowserExtensionBridgeStatus = {
    connected: false,
    mode: "disconnected",
    updatedAt: new Date(0).toISOString(),
    lastError: "Browser Bridge has not connected yet.",
    activeTab: { permission: "unknown" },
    expectedExtensionBuildId: input.expectedBuild?.extensionBuildId,
    expectedExtensionSourceHash: input.expectedBuild?.extensionSourceHash
  };

  return {
    update(status, context) {
      const next = normalizeBrowserExtensionBridgeStatus(status, input.expectedBuild);
      const trustDecision = registerTrustedExtensionOrigin(next, context?.requestOrigin);
      if (!trustDecision.ok) {
        throw new BrowserExtensionBridgeTrustError(trustDecision);
      }
      latest = next;
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
    },
    authorizeExtensionRequest(context) {
      return authorizeTrustedExtensionOrigin(context?.requestOrigin, context?.requireTrusted === true);
    }
  };

  function registerTrustedExtensionOrigin(
    status: BrowserExtensionBridgeStatus,
    requestOrigin: string | undefined
  ): BrowserExtensionBridgeTrustDecision {
    const origin = normalizeExtensionOrigin(requestOrigin);
    if (!origin) {
      return { ok: true };
    }
    const originRuntimeId = readExtensionOriginRuntimeId(origin);
    const statusRuntimeId = status.extensionRuntimeId?.toLowerCase();
    if (!statusRuntimeId) {
      return {
        ok: false,
        status: 403,
        code: "browser_bridge_extension_runtime_required",
        error: "Browser Bridge extension heartbeat requires extensionRuntimeId."
      };
    }
    if (originRuntimeId && statusRuntimeId !== originRuntimeId) {
      return {
        ok: false,
        status: 403,
        code: "browser_bridge_extension_origin_mismatch",
        error: "Browser Bridge extension Origin does not match extensionRuntimeId."
      };
    }
    if (trustedExtensionOrigin && trustedExtensionOrigin !== origin && !isTrustedExtensionStale()) {
      return {
        ok: false,
        status: 403,
        code: "browser_bridge_extension_origin_denied",
        error: "Browser Bridge is already enrolled to a different extension Origin."
      };
    }
    trustedExtensionOrigin = origin;
    return { ok: true };
  }

  function authorizeTrustedExtensionOrigin(
    requestOrigin: string | undefined,
    requireTrusted: boolean
  ): BrowserExtensionBridgeTrustDecision {
    const origin = normalizeExtensionOrigin(requestOrigin);
    if (!origin) {
      return { ok: true };
    }
    if (!trustedExtensionOrigin || isTrustedExtensionStale()) {
      return requireTrusted
        ? {
            ok: false,
            status: 403,
            code: "browser_bridge_extension_not_enrolled",
            error: "Browser Bridge extension must send a valid heartbeat before command routes are available."
          }
        : { ok: true };
    }
    if (trustedExtensionOrigin !== origin) {
      return {
        ok: false,
        status: 403,
        code: "browser_bridge_extension_origin_denied",
        error: "Browser Bridge command route is enrolled to a different extension Origin."
      };
    }
    return { ok: true };
  }

  function isTrustedExtensionStale(): boolean {
    return Boolean(latest.lastSeenAt && Date.now() - Date.parse(latest.lastSeenAt) > BROWSER_EXTENSION_BRIDGE_STALE_MS);
  }
}

export function isBrowserExtensionBridgeTrustError(error: unknown): error is BrowserExtensionBridgeTrustError {
  return error instanceof BrowserExtensionBridgeTrustError;
}

export function normalizeExtensionOrigin(origin: string | undefined): string | undefined {
  if (!origin) {
    return undefined;
  }
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "chrome-extension:" && parsed.protocol !== "edge-extension:" && parsed.protocol !== "moz-extension:") {
      return undefined;
    }
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}`;
  } catch {
    return undefined;
  }
}

function readExtensionOriginRuntimeId(origin: string): string | undefined {
  try {
    const parsed = new URL(origin);
    return parsed.hostname ? parsed.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeBrowserExtensionBridgeStatus(input: unknown, expectedBuild?: BrowserBridgeExpectedBuildInfo): BrowserExtensionBridgeStatus {
  const record = readRecord(input) ?? {};
  const activeTab = readRecord(record.activeTab);
  const settings = readRecord(record.settings);
  const now = new Date().toISOString();
  const mode = readBrowserExtensionBridgeMode(record.mode);
  const permission = readBrowserExtensionBridgePermission(activeTab?.permission);
  const extensionSourceHash = readOptionalString(record.extensionSourceHash);
  const extensionBuildId = readOptionalString(record.extensionBuildId);
  const expectedExtensionSourceHash = expectedBuild?.extensionSourceHash;
  const expectedExtensionBuildId = expectedBuild?.extensionBuildId;
  const reloadRequired = Boolean(
    extensionSourceHash &&
    expectedExtensionSourceHash &&
    extensionSourceHash !== expectedExtensionSourceHash
  );
  const lastError = readOptionalString(record.lastError) ?? null;
  return {
    extensionVersion: readOptionalString(record.extensionVersion),
    extensionBuildId,
    extensionSourceHash,
    extensionRuntimeId: readOptionalString(record.extensionRuntimeId),
    expectedExtensionBuildId,
    expectedExtensionSourceHash,
    reloadRequired,
    daemonBaseUrl: readOptionalString(record.daemonBaseUrl),
    connected: record.connected === true,
    mode,
    reason: readOptionalString(record.reason),
    updatedAt: readOptionalString(record.updatedAt) ?? now,
    lastSeenAt: now,
    lastObservationAt: readOptionalString(record.lastObservationAt),
    lastCommandId: readOptionalString(record.lastCommandId),
    lastError: reloadRequired
      ? "Browser Bridge extension code is stale. Reload the unpacked extension before retesting."
      : lastError,
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
