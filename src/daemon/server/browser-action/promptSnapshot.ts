import { broadcastLedgerSnapshot } from "../clientEvents.js";
import {
  readBrowserBridgeSnapshotMismatch,
  waitForFreshBrowserBridgeSnapshot
} from "../browser-bridge/snapshotWait.js";
import { readHostLabel } from "./presentation.js";
import type { BrowserActionPromptInput } from "./promptTypes.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";

export async function readFreshPromptBrowserSnapshot(input: BrowserActionPromptInput, requestStartedAt: Date): Promise<{
  snapshot?: unknown;
  handled: boolean;
}> {
  const preparedSnapshot = readPreparedPromptBrowserSnapshot(input);
  if (preparedSnapshot) {
    return { snapshot: preparedSnapshot, handled: false };
  }

  const snapshot = await waitForFreshBrowserBridgeSnapshot({
    providers: input.providers,
    browserExtensionBridge: input.browserExtensionBridge,
    storage: input.storage,
    sessionId: input.sessionId,
    minCapturedAt: requestStartedAt
  });
  const staleSnapshot = readBrowserBridgeSnapshotMismatch(input.browserExtensionBridge.snapshot(), snapshot, requestStartedAt);
  if (!staleSnapshot) {
    return { snapshot, handled: false };
  }

  const korean = /[가-힣]/.test(input.message.text);
  recordRuntimeActivity(input.storage, input.sessionId, "warn", "browser-action", "Prompt Browser Action held for stale Browser Bridge snapshot", staleSnapshot);
  input.emit({
    type: "message.completed",
    id: input.message.id,
    text: korean
      ? `현재 활성 탭 관찰이 아직 갱신되지 않았습니다. Browser Bridge가 ${readHostLabel(staleSnapshot.expectedUrl) || staleSnapshot.expectedUrl} 페이지를 읽는 중입니다. 잠시 후 다시 실행해 주세요.`
      : `The current active-tab observation is still refreshing. Browser Bridge is reading ${readHostLabel(staleSnapshot.expectedUrl) || staleSnapshot.expectedUrl}; try again shortly.`
  });
  input.emit({ type: "session.state", state: "idle", id: input.message.id });
  broadcastLedgerSnapshot(input.clients, input.storage, input.sessionId);
  return { snapshot, handled: true };
}

function readPreparedPromptBrowserSnapshot(input: BrowserActionPromptInput): unknown | undefined {
  const snapshot = input.providers.getDomSnapshot();
  const observation = input.providers.getDomObservation();
  if (!snapshot || !observation?.viewGraph || observation.viewGraph.schemaVersion !== "browser-view-graph.v2") {
    return undefined;
  }
  const mismatch = readBrowserBridgeSnapshotMismatch(input.browserExtensionBridge.snapshot(), snapshot);
  if (mismatch) {
    return undefined;
  }
  if (observation.viewGraph.identity.freshness !== "fresh") {
    return undefined;
  }
  const capturedAt = Date.parse(observation.capturedAt);
  if (!Number.isFinite(capturedAt) || Date.now() - capturedAt > 10_000) {
    return undefined;
  }
  recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", "Using prepared Browser View Graph v2 for prompt Browser Action", {
    viewRevision: observation.viewGraph.identity.viewRevision,
    routeKey: observation.viewGraph.identity.routeKey,
    freshness: observation.viewGraph.identity.freshness,
    graphNodeCount: observation.viewGraph.nodes.length
  });
  return snapshot;
}
