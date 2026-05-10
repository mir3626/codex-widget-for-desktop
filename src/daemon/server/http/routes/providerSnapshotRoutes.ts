import type { IncomingMessage, ServerResponse } from "node:http";
import { getProviderStatuses } from "../../../tools.js";
import { broadcastLedgerSnapshot } from "../../clientEvents.js";
import { broadcast } from "../../events.js";
import { readRequestBody, writeJsonResponse } from "../../http.js";
import {
  summarizeDomSnapshot,
  summarizeDomSnapshotData,
  summarizeScreenSnapshot,
  summarizeVisionSnapshot
} from "../../providerSnapshots.js";
import { recordRuntimeActivity } from "../../runtimeActivity.js";
import type { HttpRouteContext } from "../context.js";

export async function handleProviderSnapshotRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: HttpRouteContext
): Promise<boolean> {
  const { browserExtensionBridge, browserPerception, clients, providers, storage } = context;

  if (request.method === "POST" && url.pathname === "/providers/dom/snapshot") {
    try {
      const snapshot = providers.setDomSnapshot(JSON.parse(await readRequestBody(request, 1024 * 1024)));
      browserPerception.ingestProviderSnapshot({
        providers,
        bridgeStatus: browserExtensionBridge.snapshot(),
        reason: "legacy_snapshot"
      });
      const sessionId = storage.ensureSessionSnapshot().activeSessionId;
      storage.recordProviderSnapshot({
        sessionId,
        provider: "dom",
        title: snapshot.title || "DOM snapshot",
        summary: summarizeDomSnapshot(snapshot),
        data: summarizeDomSnapshotData(snapshot),
        capturedAt: snapshot.capturedAt
      });
      recordRuntimeActivity(storage, sessionId, "info", "provider", "DOM snapshot captured", summarizeDomSnapshotData(snapshot));
      writeJsonResponse(response, 200, { ok: true, snapshot });
      broadcast(clients, { type: "provider.status", providers: getProviderStatuses(providers) });
      broadcastLedgerSnapshot(clients, storage, sessionId);
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid DOM snapshot."
      });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/providers/dom/snapshot") {
    writeJsonResponse(response, 200, { ok: true, snapshot: providers.getDomSnapshot() });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/providers/screen/snapshot") {
    try {
      const snapshot = providers.setScreenSnapshot(JSON.parse(await readRequestBody(request, 2 * 1024 * 1024)));
      const sessionId = storage.ensureSessionSnapshot().activeSessionId;
      const summarized = summarizeScreenSnapshot(snapshot);
      storage.recordProviderSnapshot({
        sessionId,
        provider: "vision",
        title: snapshot.title || snapshot.source || "Vision snapshot",
        summary: summarizeVisionSnapshot(snapshot),
        data: summarized,
        capturedAt: snapshot.capturedAt
      });
      recordRuntimeActivity(storage, sessionId, "info", "provider", "Vision snapshot captured", summarized);
      writeJsonResponse(response, 200, { ok: true, snapshot: summarized });
      broadcast(clients, { type: "provider.status", providers: getProviderStatuses(providers) });
      broadcastLedgerSnapshot(clients, storage, sessionId);
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid screen snapshot."
      });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/providers/screen/snapshot") {
    const snapshot = providers.getScreenSnapshot();
    writeJsonResponse(response, 200, { ok: true, snapshot: snapshot ? summarizeScreenSnapshot(snapshot) : null });
    return true;
  }

  return false;
}
