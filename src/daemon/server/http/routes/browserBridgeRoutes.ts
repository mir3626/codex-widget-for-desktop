import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  BrowserExtensionBridgePermission,
  BrowserExtensionBridgeStatus
} from "../../../../shared/protocol.js";
import {
  summarizeBrowserActionResult,
  type BrowserActionExecutionResult
} from "../../../browser-action/index.js";
import { resolveBrowserActionCommandWaiter } from "../../browser-action/commandWaiters.js";
import { recordBrowserActionAudit } from "../../browser-action/helpers.js";
import { broadcastLedgerSnapshot } from "../../clientEvents.js";
import { broadcast } from "../../events.js";
import { readRequestBody, writeJsonResponse } from "../../http.js";
import { resolveClientSessionId } from "../../runtime/sessionIds.js";
import type { HttpRouteContext } from "../context.js";

export async function handleBrowserBridgeRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: HttpRouteContext
): Promise<boolean> {
  const { browserExtensionBridge, browserPerception, browserActions, browserActionCommandWaiters, clients, providers, storage } = context;

  if (request.method === "POST" && url.pathname === "/browser-action/extension/heartbeat") {
    try {
      const status = browserExtensionBridge.update(JSON.parse(await readRequestBody(request, 128 * 1024)));
      broadcast(clients, { type: "browserExtensionBridge.status", status });
      writeJsonResponse(response, 200, { ok: true, status });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid Browser Bridge heartbeat."
      });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/browser-action/extension/status") {
    writeJsonResponse(response, 200, { ok: true, status: browserExtensionBridge.snapshot() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/browser-action/extension/poll") {
    const status = browserExtensionBridge.update(buildBrowserBridgePollStatus(url, browserExtensionBridge.snapshot()));
    broadcast(clients, { type: "browserExtensionBridge.status", status });
    const command = browserPerception.pollExtensionCommand() ?? browserActions.pollExtensionCommand() ?? null;
    writeJsonResponse(response, 200, { ok: true, command });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/browser-action/extension/ack") {
    try {
      const ack = browserPerception.acknowledgeObserveCommand(JSON.parse(await readRequestBody(request, 128 * 1024)));
      writeJsonResponse(response, 200, { ok: true, ack });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid Browser Perception observe acknowledgement."
      });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/browser-action/extension/observe-result") {
    try {
      const payload = JSON.parse(await readRequestBody(request, 512 * 1024));
      const result = browserPerception.completeObserveResult({
        providers,
        bridgeStatus: browserExtensionBridge.snapshot(),
        payload
      });
      if (result.context) {
        const sessionId = storage.ensureSessionSnapshot().activeSessionId;
        storage.recordProviderSnapshot({
          sessionId,
          provider: "dom",
          title: result.context.snapshot.title || "Browser Perception observation",
          summary: `Browser Perception ${result.status}: ${result.context.snapshot.title || result.context.snapshot.url || "active tab"}`,
          data: {
            url: result.context.snapshot.url,
            title: result.context.snapshot.title,
            capturedAt: result.context.snapshot.capturedAt,
            viewRevision: result.context.viewRevision,
            routeKey: result.context.routeKey,
            freshness: result.context.freshness,
            stability: result.context.stability
          },
          capturedAt: result.context.snapshot.capturedAt
        });
        broadcast(clients, { type: "provider.status", providers: context.providers.getStatuses() });
        broadcast(clients, {
          type: "browserAction.progress",
          actionSessionId: result.context.contextId,
          status: "browser_perception_ready",
          detail: {
            commandId: result.commandId,
            freshness: result.context.freshness,
            stability: result.context.stability,
            routeKey: result.context.routeKey,
            viewRevision: result.context.viewRevision
          }
        });
        broadcastLedgerSnapshot(clients, storage, resolveClientSessionId(storage, sessionId));
      }
      writeJsonResponse(response, 200, { ok: true, result });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid Browser Perception observe result."
      });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/browser-action/extension/result") {
    try {
      const payload = JSON.parse(await readRequestBody(request, 512 * 1024)) as BrowserActionExecutionResult;
      const completed = browserActions.completeExtensionCommand(payload);
      recordBrowserActionAudit(storage, completed.audit);
      resolveBrowserActionCommandWaiter(browserActionCommandWaiters, payload.requestId, completed.result);
      broadcast(clients, {
        type: "browserAction.result",
        actionSessionId: completed.session.id,
        result: summarizeBrowserActionResult(completed.result)
      });
      broadcastLedgerSnapshot(clients, storage, resolveClientSessionId(storage, completed.session.sessionId));
      writeJsonResponse(response, 200, { ok: true, result: summarizeBrowserActionResult(completed.result) });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid browser action result."
      });
    }
    return true;
  }

  return false;
}

function buildBrowserBridgePollStatus(url: URL, previous: BrowserExtensionBridgeStatus): BrowserExtensionBridgeStatus {
  const permission = readBridgePollPermission(url.searchParams.get("permission"));
  return {
    ...previous,
    connected: true,
    mode: permission === "allowed"
      ? "idle"
      : permission === "needs_site_permission"
        ? "permission_needed"
        : permission === "restricted"
          ? "restricted"
          : previous.mode,
    reason: url.searchParams.get("mode") || "browser_action_poll",
    updatedAt: new Date().toISOString(),
    lastError: permission === "allowed" ? null : previous.lastError,
    activeTab: {
      ...(previous.activeTab ?? {}),
      tabId: readBridgePollId(url.searchParams.get("tabId")) ?? previous.activeTab?.tabId,
      windowId: readBridgePollId(url.searchParams.get("windowId")) ?? previous.activeTab?.windowId,
      url: url.searchParams.get("url") || previous.activeTab?.url,
      title: url.searchParams.get("title") || previous.activeTab?.title,
      permission
    }
  };
}

function readBridgePollPermission(value: string | null): BrowserExtensionBridgePermission {
  return value === "allowed" ||
    value === "needs_site_permission" ||
    value === "restricted" ||
    value === "unavailable" ||
    value === "unknown"
    ? value
    : "unknown";
}

function readBridgePollId(value: string | null): string | number | undefined {
  if (!value) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}
