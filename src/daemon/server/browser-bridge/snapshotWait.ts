import type { BrowserExtensionBridgeStatus } from "../../../shared/protocol.js";
import type { DomSnapshot, ProviderRegistry } from "../../providers/providerRegistry.js";
import type { StorageService } from "../../storage/storage.js";
import type { BrowserExtensionBridgeStore } from "./store.js";
import { browserActionUrlsMatch } from "../browser-action/helpers.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";

const BROWSER_BRIDGE_FRESH_SNAPSHOT_WAIT_MS = 35_000;
const BROWSER_BRIDGE_FRESH_SNAPSHOT_POLL_MS = 250;

export type BrowserBridgeSnapshotMismatch = {
  reason: "url_mismatch" | "snapshot_older_than_request";
  expectedUrl: string;
  actualUrl?: string;
  capturedAt?: string;
  minCapturedAt?: string;
};

export async function waitForFreshBrowserBridgeSnapshot(input: {
  providers: ProviderRegistry;
  browserExtensionBridge: BrowserExtensionBridgeStore;
  storage: StorageService;
  sessionId: string;
  minCapturedAt?: Date;
  timeoutMs?: number;
}): Promise<DomSnapshot | null> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(500, input.timeoutMs ?? BROWSER_BRIDGE_FRESH_SNAPSHOT_WAIT_MS);
  const initialSnapshot = input.providers.getDomSnapshot();
  const initialMismatch = readBrowserBridgeSnapshotMismatch(input.browserExtensionBridge.snapshot(), initialSnapshot, input.minCapturedAt);
  if (!initialMismatch) {
    return initialSnapshot;
  }

  recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", "Waiting for fresh Browser Bridge snapshot", initialMismatch);
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(BROWSER_BRIDGE_FRESH_SNAPSHOT_POLL_MS);
    const latestSnapshot = input.providers.getDomSnapshot();
    const mismatch = readBrowserBridgeSnapshotMismatch(input.browserExtensionBridge.snapshot(), latestSnapshot, input.minCapturedAt);
    if (!mismatch) {
      recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", "Fresh Browser Bridge snapshot received", {
        waitedMs: Date.now() - startedAt,
        url: latestSnapshot?.url
      });
      return latestSnapshot;
    }
  }
  const latestSnapshot = input.providers.getDomSnapshot();
  recordRuntimeActivity(input.storage, input.sessionId, "warn", "browser-action", "Browser Bridge snapshot stayed stale after wait", {
    waitedMs: Date.now() - startedAt,
    ...readBrowserBridgeSnapshotMismatch(input.browserExtensionBridge.snapshot(), latestSnapshot, input.minCapturedAt)
  });
  return latestSnapshot;
}

export function readBrowserBridgeSnapshotMismatch(
  status: BrowserExtensionBridgeStatus,
  snapshot: DomSnapshot | null,
  minCapturedAt?: Date
): BrowserBridgeSnapshotMismatch | undefined {
  const expectedUrl = status.activeTab?.url?.trim();
  if (!status.connected || status.activeTab?.permission !== "allowed" || !expectedUrl || !/^https?:\/\//i.test(expectedUrl)) {
    return undefined;
  }
  if (snapshot?.url && browserActionUrlsMatch(snapshot.url, expectedUrl)) {
    if (minCapturedAt && snapshot.capturedAt && Date.parse(snapshot.capturedAt) < minCapturedAt.getTime()) {
      return {
        reason: "snapshot_older_than_request",
        expectedUrl,
        actualUrl: snapshot.url,
        capturedAt: snapshot.capturedAt,
        minCapturedAt: minCapturedAt.toISOString()
      };
    }
    return undefined;
  }
  return {
    reason: "url_mismatch",
    expectedUrl,
    actualUrl: snapshot?.url
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
