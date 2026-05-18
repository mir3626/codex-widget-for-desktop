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
import {
  recordBrowserActionCapabilityAcknowledged,
  recordBrowserActionCapabilityResult
} from "../../browser-action/capabilityMirror.js";
import { recordBrowserActionAudit } from "../../browser-action/helpers.js";
import { broadcastLedgerSnapshot } from "../../clientEvents.js";
import { broadcast } from "../../events.js";
import { readRequestBody, writeJsonResponse } from "../../http.js";
import { isBrowserExtensionBridgeTrustError } from "../../browser-bridge/store.js";
import { resolveClientSessionId } from "../../runtime/sessionIds.js";
import type { HttpRouteContext } from "../context.js";

export async function handleBrowserBridgeRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: HttpRouteContext
): Promise<boolean> {
  const { browserExtensionBridge, browserPerception, browserActions, browserChromeCommands, browserActionCommandWaiters, clients, providers, storage } = context;

  if (request.method === "POST" && url.pathname === "/browser-action/extension/heartbeat") {
    try {
      const previous = browserExtensionBridge.snapshot();
      const payload = JSON.parse(await readRequestBody(request, 128 * 1024));
      const status = browserExtensionBridge.update(payload, { requestOrigin: readRequestOrigin(request) });
      if (browserBridgeActiveTabChanged(previous, status)) {
        browserPerception.markDirty(`bridge_active_tab_changed:${status.reason ?? "heartbeat"}`);
      }
      scheduleBackgroundPerceptionObserve({ browserPerception, providers, clients, status, reason: status.reason ?? "heartbeat" });
      broadcast(clients, { type: "browserExtensionBridge.status", status });
      writeJsonResponse(response, 200, { ok: true, status });
    } catch (error) {
      writeBrowserBridgeErrorResponse(response, error, "Invalid Browser Bridge heartbeat.");
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/browser-action/extension/status") {
    const trustDecision = browserExtensionBridge.authorizeExtensionRequest({ requestOrigin: readRequestOrigin(request), requireTrusted: false });
    if (!trustDecision.ok) {
      writeBrowserBridgeTrustDenied(response, trustDecision);
      return true;
    }
    writeJsonResponse(response, 200, { ok: true, status: browserExtensionBridge.snapshot() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/browser-action/extension/poll") {
    const trustDecision = browserExtensionBridge.authorizeExtensionRequest({ requestOrigin: readRequestOrigin(request), requireTrusted: true });
    if (!trustDecision.ok) {
      writeBrowserBridgeTrustDenied(response, trustDecision);
      return true;
    }
    const previous = browserExtensionBridge.snapshot();
    const status = browserExtensionBridge.update(buildBrowserBridgePollStatus(url, previous), { requestOrigin: readRequestOrigin(request) });
    if (browserBridgeActiveTabChanged(previous, status)) {
      browserPerception.markDirty(`bridge_active_tab_changed:${status.reason ?? "poll"}`);
    }
    scheduleBackgroundPerceptionObserve({ browserPerception, providers, clients, status, reason: status.reason ?? "poll" });
    broadcast(clients, { type: "browserExtensionBridge.status", status });
    const command = await pollBrowserBridgeCommand({
      browserPerception,
      browserActions,
      browserChromeCommands,
      waitMs: readPollWaitMs(url.searchParams.get("waitMs"))
    });
    writeJsonResponse(response, 200, { ok: true, command });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/browser-action/extension/ack") {
    try {
      const trustDecision = browserExtensionBridge.authorizeExtensionRequest({ requestOrigin: readRequestOrigin(request), requireTrusted: true });
      if (!trustDecision.ok) {
        writeBrowserBridgeTrustDenied(response, trustDecision);
        return true;
      }
      const ack = browserPerception.acknowledgeObserveCommand(JSON.parse(await readRequestBody(request, 128 * 1024)));
      writeJsonResponse(response, 200, { ok: true, ack });
    } catch (error) {
      writeBrowserBridgeErrorResponse(response, error, "Invalid Browser Perception observe acknowledgement.");
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/browser-action/extension/action-ack") {
    try {
      const trustDecision = browserExtensionBridge.authorizeExtensionRequest({ requestOrigin: readRequestOrigin(request), requireTrusted: true });
      if (!trustDecision.ok) {
        writeBrowserBridgeTrustDenied(response, trustDecision);
        return true;
      }
      const payload = JSON.parse(await readRequestBody(request, 128 * 1024)) as { requestId?: string };
      const requestId = typeof payload.requestId === "string" ? payload.requestId.trim() : "";
      if (!requestId) {
        writeJsonResponse(response, 400, { ok: false, error: "Browser Action command acknowledgement requires requestId." });
        return true;
      }
      const result = browserActions.acknowledgeExtensionCommand(requestId);
      if (!result) {
        writeBrowserBridgeCommandConflict(response, `Browser Action command not pending: ${requestId}`);
        return true;
      }
      recordBrowserActionCapabilityAcknowledged({
        storage,
        clients,
        requestId,
        result
      });
      broadcast(clients, {
        type: "browserAction.progress",
        actionSessionId: result.actionSessionId,
        status: "extension_command_acknowledged",
        detail: { requestId, action: result.action.type }
      });
      writeJsonResponse(response, 200, { ok: true, acknowledged: true });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid Browser Action command acknowledgement."
      });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/browser-action/extension/observe-result") {
    try {
      const trustDecision = browserExtensionBridge.authorizeExtensionRequest({ requestOrigin: readRequestOrigin(request), requireTrusted: true });
      if (!trustDecision.ok) {
        writeBrowserBridgeTrustDenied(response, trustDecision);
        return true;
      }
      const payload = JSON.parse(await readRequestBody(request, 1024 * 1024));
      const result = browserPerception.completeObserveResult({
        providers,
        bridgeStatus: browserExtensionBridge.snapshot(),
        payload
      });
      if (result.context) {
        const shouldPersistProviderSnapshot = result.context.lastObservedReason !== "background";
        const sessionId = shouldPersistProviderSnapshot ? storage.ensureSessionSnapshot().activeSessionId : undefined;
        if (shouldPersistProviderSnapshot && sessionId) {
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
        }
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
        if (shouldPersistProviderSnapshot && sessionId) {
          broadcastLedgerSnapshot(clients, storage, resolveClientSessionId(storage, sessionId));
        }
      }
      writeJsonResponse(response, 200, { ok: true, result });
    } catch (error) {
      writeBrowserBridgeErrorResponse(response, error, "Invalid Browser Perception observe result.");
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/browser-action/extension/result") {
    try {
      const trustDecision = browserExtensionBridge.authorizeExtensionRequest({ requestOrigin: readRequestOrigin(request), requireTrusted: true });
      if (!trustDecision.ok) {
        writeBrowserBridgeTrustDenied(response, trustDecision);
        return true;
      }
      const payload = JSON.parse(await readRequestBody(request, 512 * 1024)) as BrowserActionExecutionResult;
      const completed = browserActions.completeExtensionCommand(payload);
      recordBrowserActionAudit(storage, completed.audit);
      const capabilityJob = recordBrowserActionCapabilityResult({
        storage,
        clients,
        result: completed.result,
        requestId: payload.requestId,
        sessionId: resolveClientSessionId(storage, completed.session.sessionId)
      });
      context.computerSessionRuntime.recordBrowserActionResultObservation({
        result: completed.result,
        capabilityJobId: capabilityJob.id,
        dagNodeId: readDagNodeId(capabilityJob.inputJson)
      });
      try {
        await context.computerSessionRuntime.continueBrowserActionPromptByCapabilityJob(`browser-action:${payload.requestId}`);
      } catch (error) {
        broadcast(clients, {
          type: "browserAction.progress",
          actionSessionId: completed.session.id,
          status: "computer_session_prompt_continuation_failed",
          detail: {
            requestId: payload.requestId,
            error: error instanceof Error ? error.message : "unknown_error"
          }
        });
      }
      resolveBrowserActionCommandWaiter(browserActionCommandWaiters, payload.requestId, completed.result);
      broadcast(clients, {
        type: "browserAction.result",
        actionSessionId: completed.session.id,
        result: summarizeBrowserActionResult(completed.result)
      });
      broadcastLedgerSnapshot(clients, storage, resolveClientSessionId(storage, completed.session.sessionId));
      writeJsonResponse(response, 200, { ok: true, result: summarizeBrowserActionResult(completed.result) });
    } catch (error) {
      writeBrowserBridgeErrorResponse(response, error, "Invalid browser action result.");
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/browser-action/extension/browser-chrome-result") {
    try {
      const trustDecision = browserExtensionBridge.authorizeExtensionRequest({ requestOrigin: readRequestOrigin(request), requireTrusted: true });
      if (!trustDecision.ok) {
        writeBrowserBridgeTrustDenied(response, trustDecision);
        return true;
      }
      const payload = JSON.parse(await readRequestBody(request, 512 * 1024)) as {
        requestId?: string;
        ok?: boolean;
        output?: unknown;
        error?: string;
        metadata?: Record<string, unknown>;
      };
      const requestId = typeof payload.requestId === "string" ? payload.requestId.trim() : "";
      if (!requestId) {
        writeJsonResponse(response, 400, { ok: false, error: "Browser Chrome result requires requestId." });
        return true;
      }
      const completed = browserChromeCommands.complete({
        requestId,
        ok: Boolean(payload.ok),
        output: payload.output,
        error: typeof payload.error === "string" ? payload.error : undefined,
        metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : undefined
      });
      if (!completed) {
        writeBrowserBridgeCommandConflict(response, `Browser Chrome command not pending: ${requestId}`);
        return true;
      }
      writeJsonResponse(response, 200, { ok: true, completed });
    } catch (error) {
      writeBrowserBridgeErrorResponse(response, error, "Invalid Browser Chrome result.");
    }
    return true;
  }

  return false;
}

function readDagNodeId(input: unknown): string | undefined {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return typeof record.dagNodeId === "string" ? record.dagNodeId : undefined;
}

function writeBrowserBridgeErrorResponse(response: ServerResponse, error: unknown, fallback: string): void {
  if (isBrowserExtensionBridgeTrustError(error)) {
    writeBrowserBridgeTrustDenied(response, {
      status: error.status,
      code: error.code,
      error: error.message
    });
    return;
  }
  const message = error instanceof Error ? error.message : fallback;
  if (isBrowserBridgeCommandCorrelationError(message)) {
    writeBrowserBridgeCommandConflict(response, message);
    return;
  }
  writeJsonResponse(response, 400, { ok: false, error: message });
}

function writeBrowserBridgeTrustDenied(response: ServerResponse, decision: { status: 403; code: string; error: string }): void {
  writeJsonResponse(response, decision.status, {
    ok: false,
    code: decision.code,
    error: decision.error
  });
}

function readRequestOrigin(request: IncomingMessage): string | undefined {
  const value = request.headers.origin;
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function writeBrowserBridgeCommandConflict(response: ServerResponse, error: string): void {
  writeJsonResponse(response, 409, {
    ok: false,
    code: "browser_bridge_command_not_pending",
    error
  });
}

function isBrowserBridgeCommandCorrelationError(message: string): boolean {
  return /(?:command|result) (?:not pending|not found)/i.test(message);
}

function scheduleBackgroundPerceptionObserve(input: {
  browserPerception: HttpRouteContext["browserPerception"];
  providers: HttpRouteContext["providers"];
  clients: HttpRouteContext["clients"];
  status: BrowserExtensionBridgeStatus;
  reason: string;
}): void {
  const scheduled = input.browserPerception.scheduleBackgroundObserve({
    providers: input.providers,
    bridgeStatus: input.status,
    reason: input.reason
  });
  if (!scheduled.scheduled || !scheduled.command) {
    return;
  }
  broadcast(input.clients, {
    type: "browserAction.progress",
    actionSessionId: scheduled.command.commandId,
    status: "browser_perception_waiting",
    detail: {
      status: "observe_queued",
      commandId: scheduled.command.commandId,
      reason: "background_scheduler",
      schedulerReason: scheduled.reason,
      diagnostics: scheduled.diagnostics
    }
  });
}

export function browserBridgeActiveTabChanged(
  previous: BrowserExtensionBridgeStatus,
  next: BrowserExtensionBridgeStatus
): boolean {
  return browserBridgeActiveTabSignature(previous) !== browserBridgeActiveTabSignature(next);
}

function browserBridgeActiveTabSignature(status: BrowserExtensionBridgeStatus): string {
  const active = status.activeTab;
  return [
    active?.windowId ?? "",
    active?.tabId ?? "",
    active?.url ?? "",
    active?.title ?? "",
    active?.permission ?? ""
  ].join("|");
}

export async function pollBrowserBridgeCommand(input: {
  browserPerception: HttpRouteContext["browserPerception"];
  browserActions: HttpRouteContext["browserActions"];
  browserChromeCommands: HttpRouteContext["browserChromeCommands"];
  waitMs: number;
}) {
  const immediate = input.browserActions.pollExtensionCommand() ?? input.browserChromeCommands.poll() ?? input.browserPerception.pollExtensionCommand() ?? null;
  if (immediate || input.waitMs <= 0) {
    return immediate;
  }
  const deadline = Date.now() + input.waitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const command = input.browserActions.pollExtensionCommand() ?? input.browserChromeCommands.poll() ?? input.browserPerception.pollExtensionCommand() ?? null;
    if (command) {
      return command;
    }
  }
  return null;
}

function readPollWaitMs(value: string | null): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }
  return Math.min(25_000, Math.floor(number));
}

export function buildBrowserBridgePollStatus(url: URL, previous: BrowserExtensionBridgeStatus): BrowserExtensionBridgeStatus {
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
