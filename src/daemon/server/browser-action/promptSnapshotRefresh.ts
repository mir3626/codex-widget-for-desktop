import type { WebSocket } from "ws";
import {
  BrowserActionSessionManager,
  summarizeBrowserObservation,
  type BrowserActionResult
} from "../../browser-action/index.js";
import type { ProviderRegistry } from "../../providers/providerRegistry.js";
import type { StorageService } from "../../storage/storage.js";
import type { BrowserExtensionBridgeStore } from "../browser-bridge/store.js";
import { waitForFreshBrowserBridgeSnapshot } from "../browser-bridge/snapshotWait.js";
import { broadcast } from "../events.js";
import {
  browserActionUrlsMatch,
  recordBrowserActionAudit
} from "./helpers.js";

export async function refreshPromptBrowserActionSnapshotAfterCommand(input: {
  actionSessionId: string;
  result: BrowserActionResult;
  providers: ProviderRegistry;
  browserActions: BrowserActionSessionManager;
  browserExtensionBridge: BrowserExtensionBridgeStore;
  storage: StorageService;
  clients: Set<WebSocket>;
  sessionId: string;
}): Promise<unknown> {
  const bridgeStatus = input.browserExtensionBridge.snapshot();
  const activeUrl = bridgeStatus.activeTab?.url;
  const afterUrl = input.result.after?.url;
  const beforeUrl = input.result.before?.url;
  const afterMatchesActive = afterUrl && (!activeUrl || browserActionUrlsMatch(afterUrl, activeUrl));
  const afterMovedFromBefore = afterUrl && beforeUrl && !browserActionUrlsMatch(afterUrl, beforeUrl);
  const snapshot = afterMatchesActive || afterMovedFromBefore
    ? input.result.after
    : await waitForFreshBrowserBridgeSnapshot({
        providers: input.providers,
        browserExtensionBridge: input.browserExtensionBridge,
        storage: input.storage,
        sessionId: input.sessionId,
        minCapturedAt: readBrowserActionResultStartedAt(input.result)
      }) ?? input.result.after ?? input.providers.getDomSnapshot();

  if (snapshot) {
    const observed = input.browserActions.observe({ actionSessionId: input.actionSessionId, snapshot });
    recordBrowserActionAudit(input.storage, observed.audit);
    broadcast(input.clients, {
      type: "browserAction.observation",
      actionSessionId: input.actionSessionId,
      observationSummary: summarizeBrowserObservation(observed.observation)
    });
  }
  return snapshot;
}

function readBrowserActionResultStartedAt(result: BrowserActionResult): Date | undefined {
  const time = Date.parse(result.startedAt);
  return Number.isFinite(time) ? new Date(time) : undefined;
}
