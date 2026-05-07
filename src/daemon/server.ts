import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { daemonInfo, runAgentStream, type AgentSessionState } from "./agent.js";
import { CodexAppServerBridge } from "./codexAppServer.js";
import { resolveCodexExecutionContext } from "./codexRuntime.js";
import { OAuthSession } from "./oauth.js";
import { captureScreenSnapshot } from "./providers/screenCaptureProvider.js";
import { ProviderRegistry, type DomSnapshot, type ScreenSnapshot } from "./providers/providerRegistry.js";
import { subscribeTerminalSessionOutput, writeTerminalSessionInput } from "./providers/terminalSessionProvider.js";
import { createStorageService, type StorageService } from "./storage/storage.js";
import { getProviderStatuses } from "./tools.js";
import {
  BrowserActionSessionManager,
  summarizeBrowserActionResult,
  summarizeBrowserActionSession,
  summarizeBrowserObservation,
  type BrowserAction,
  type BrowserActionAuditEntry,
  type BrowserActionExecutionResult,
  type BrowserActionResult
} from "./browser-action/index.js";
import {
  VisionContextSessionManager,
  buildAppServerUserInput,
  collectAdapterObservations,
  renderVisibleUserMessage,
  summarizeCaptureSession,
  type CaptureEvent,
  type VisionContextStartInput
} from "./vision-context/index.js";
import type {
  ClientMessage,
  ExecutionPermissionSummary,
  MessageSnapshotStatus,
  RuntimeStatus,
  ScreenCrop,
  ServerEvent,
  SessionSnapshot
} from "../shared/protocol.js";

export type DaemonHandle = {
  port: number;
  close: () => Promise<void>;
};

export type DaemonOptions = {
  port?: number;
};

type RetainedMessage = {
  id: string;
  text: string;
  status: MessageSnapshotStatus;
  updatedAt: number;
};

const MAX_RETAINED_MESSAGES = 80;
const MAX_LEDGER_TOOL_OUTPUT_CHARS = 120_000;
const MAX_VISION_RECORDING_DATA_URL_CHARS = 16 * 1024 * 1024;
const CODEX_APP_SERVER_RUNTIME_PROVIDER = "codex-app-server";

export async function startDaemon(options: DaemonOptions = {}): Promise<DaemonHandle> {
  let serverRef: Server | undefined;
  const controllers = new Map<string, AbortController>();
  const retainedMessages = new Map<string, RetainedMessage>();
  const toolOutputBuffers = new Map<string, Map<string, string>>();
  const clients = new Set<WebSocket>();
  const startedAt = Date.now();
  const auth = new OAuthSession(() => (serverRef ? getServerPort(serverRef) : 0));
  const codexAppServer = new CodexAppServerBridge();
  const providers = new ProviderRegistry();
  const visionContext = new VisionContextSessionManager();
  const browserActions = new BrowserActionSessionManager();
  const storage = createStorageService();
  const requestSessions = new Map<string, string>();
  const agentSession: AgentSessionState = {};
  const unsubscribeTerminalOutput = subscribeTerminalSessionOutput((chunk) => {
    broadcast(clients, { type: "terminal.output", id: "terminal-session", chunk });
  });
  const onAuthChanged = () => {
    broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    syncCodexAppServer(auth, codexAppServer);
  };

  const server = createServer((request, response) => {
    void handleHttpRequest(request, response, auth, onAuthChanged, providers, browserActions, clients, storage);
  });
  serverRef = server;
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    clients.add(socket);
    send(socket, { type: "connected", daemon: daemonInfo(getServerPort(server), auth.getStatus()) });
    send(socket, { type: "auth.status", auth: auth.getStatus() });
    send(socket, { type: "provider.status", providers: getProviderStatuses(providers) });
    send(socket, { type: "runtime.status", status: readRuntimeStatus(startedAt, clients, controllers, codexAppServer, storage) });
    sendExecutionPermissions(socket, storage);
    sendSessionSnapshot(socket, storage);
    sendLedgerSnapshot(socket, storage);
    send(socket, { type: "session.state", state: "idle" });
    replayRetainedMessages(socket, retainedMessages);

    socket.on("message", (raw) => {
      void handleMessage(
        raw.toString(),
        socket,
        controllers,
        retainedMessages,
        toolOutputBuffers,
        auth,
        clients,
        requestSessions,
        storage,
        agentSession,
        codexAppServer,
        providers,
        visionContext,
        browserActions,
        getServerPort(server)
      );
    });

    socket.on("close", () => {
      clients.delete(socket);
    });
  });

  const requestedPort = options.port ?? Number(process.env.CODEX_WIDGET_PORT ?? 0);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  syncCodexAppServer(auth, codexAppServer);
  const runtimeStatusTimer = setInterval(() => {
    broadcast(clients, { type: "runtime.status", status: readRuntimeStatus(startedAt, clients, controllers, codexAppServer, storage) });
  }, 5_000);

  return {
    port: getServerPort(server),
    close: async () => {
      clearInterval(runtimeStatusTimer);
      unsubscribeTerminalOutput();
      await new Promise<void>((resolve, reject) => {
        for (const controller of controllers.values()) {
          controller.abort();
        }
        wss.close((wssError) => {
          if (wssError) {
            reject(wssError);
            return;
          }
          server.close((serverError) => {
            if (serverError) {
              reject(serverError);
              return;
            }
            resolve();
          });
        });
      });
      try {
        await codexAppServer.close();
      } finally {
        storage.close();
      }
    }
  };
}

async function handleMessage(
  raw: string,
  socket: WebSocket,
  controllers: Map<string, AbortController>,
  retainedMessages: Map<string, RetainedMessage>,
  toolOutputBuffers: Map<string, Map<string, string>>,
  auth: OAuthSession,
  clients: Set<WebSocket>,
  requestSessions: Map<string, string>,
  storage: StorageService,
  agentSession: AgentSessionState,
  codexAppServer: CodexAppServerBridge,
  providers: ProviderRegistry,
  visionContext: VisionContextSessionManager,
  browserActions: BrowserActionSessionManager,
  daemonPort: number
): Promise<void> {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    send(socket, { type: "error", message: "Invalid daemon message." });
    return;
  }

  if (message.type === "ping") {
    send(socket, { type: "pong" });
    return;
  }

  if (message.type === "auth.start") {
    try {
      const url = auth.startSignIn(() => {
        broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
        syncCodexAppServer(auth, codexAppServer);
      });
      if (url) {
        send(socket, { type: "auth.url", url });
      }
      send(socket, { type: "auth.status", auth: auth.getStatus() });
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to start OAuth sign-in."
      });
      send(socket, { type: "auth.status", auth: auth.getStatus() });
    }
    return;
  }

  if (message.type === "auth.logout") {
    auth.logout();
    resetAgentSession(agentSession);
    await codexAppServer.close();
    broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    return;
  }

  if (message.type === "auth.save-token") {
    try {
      auth.completeTokenEntry(
        new URLSearchParams({
          access_token: message.accessToken,
          proxy_url: message.proxyUrl,
          model_label: message.modelLabel ?? ""
        })
      );
      await codexAppServer.close();
      broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to save OAuth token."
      });
      send(socket, { type: "auth.status", auth: auth.getStatus() });
    }
    return;
  }

  if (message.type === "cancel") {
    const sessionId = requestSessions.get(message.id);
    controllers.get(message.id)?.abort();
    controllers.delete(message.id);
    if (sessionId) {
      storage.updateAssistantMessage({ sessionId, messageId: message.id, status: "cancelled" });
      requestSessions.delete(message.id);
    }
    retainAndBroadcast(clients, retainedMessages, { type: "session.state", state: "cancelled", id: message.id });
    return;
  }

  if (message.type === "session.reset") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.createSession(), { reset: true });
    return;
  }

  if (message.type === "session.branch") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () =>
      storage.branchSession({
        messages: message.messages ?? [],
        sourceMessageId: message.sourceMessageId,
        title: message.title,
        model: message.model,
        reasoningEffort: message.reasoningEffort,
        mode: message.mode
      })
    );
    return;
  }

  if (message.type === "session.create") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () =>
      storage.createSession({
        title: message.title,
        model: message.model,
        reasoningEffort: message.reasoningEffort,
        mode: message.mode
      })
    );
    return;
  }

  if (message.type === "session.open") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.openSession(message.sessionId));
    return;
  }

  if (message.type === "session.trash") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.trashSession(message.sessionId));
    return;
  }

  if (message.type === "session.discard") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.discardSession(message.sessionId));
    return;
  }

  if (message.type === "session.delete") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.deleteSession(message.sessionId));
    return;
  }

  if (message.type === "session.restore") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.restoreSession(message.sessionId));
    return;
  }

  if (message.type === "ledger.refresh") {
    sendLedgerSnapshot(socket, storage, message.sessionId);
    return;
  }

  if (message.type === "artifact.open") {
    try {
      const path = storage.resolveArtifactOpenPath(message.artifactFileId, message.versionId);
      if (!path) {
        throw new Error("Artifact file is no longer available.");
      }
      openPathWithSystem(path);
      sendLedgerSnapshot(socket, storage);
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to open artifact."
      });
    }
    return;
  }

  if (message.type === "interaction.respond") {
    const browserActionResponse = await browserActions.respondToInteraction({ id: message.id, decision: message.decision });
    if (browserActionResponse.handled) {
      const session = browserActionResponse.approval ? browserActions.get(browserActionResponse.approval.actionSessionId) : undefined;
      if (browserActionResponse.command && session) {
        broadcast(clients, {
          type: "browserAction.progress",
          actionSessionId: session.id,
          status: "queued",
          detail: { requestId: browserActionResponse.command.requestId, action: browserActionResponse.command.action.type }
        });
        recordRuntimeActivity(storage, resolveClientSessionId(storage, session.sessionId), "info", "browser-action", "Browser action approved and queued", {
          requestId: browserActionResponse.command.requestId,
          action: browserActionResponse.command.action.type
        });
      }
      if (browserActionResponse.result && session && !browserActionResponse.command) {
        broadcast(clients, {
          type: "browserAction.result",
          actionSessionId: session.id,
          result: summarizeBrowserActionResult(browserActionResponse.result)
        });
        recordRuntimeActivity(storage, resolveClientSessionId(storage, session.sessionId), "info", "browser-action", "Browser action approval resolved", summarizeBrowserActionResult(browserActionResponse.result));
        broadcastLedgerSnapshot(clients, storage, resolveClientSessionId(storage, session.sessionId));
      }
      return;
    }
    const result = codexAppServer.respondToInteraction(message);
    if (!result.handled) {
      send(socket, {
        type: "error",
        message: "That Codex interaction is no longer active."
      });
      return;
    }
    const action = result.action ?? message.action;
    if (result.remember && action) {
      const permissions = storage.setExecutionPermission({ action, decision: "allow" });
      broadcastExecutionPermissions(clients, permissions);
      recordRuntimeActivity(storage, storage.ensureSessionSnapshot().activeSessionId, "info", "permission", `Always allow: ${action}`, {
        action,
        decision: "allow"
      });
    }
    return;
  }

  if (message.type === "execution.permissions.refresh") {
    sendExecutionPermissions(socket, storage);
    return;
  }

  if (message.type === "execution.permission.set") {
    try {
      const permissions = storage.setExecutionPermission({
        action: message.action,
        decision: message.decision
      });
      broadcastExecutionPermissions(clients, permissions);
      recordRuntimeActivity(storage, storage.ensureSessionSnapshot().activeSessionId, "info", "permission", `Permission ${message.decision}: ${message.action}`, {
        action: message.action,
        decision: message.decision
      });
      broadcastLedgerSnapshot(clients, storage);
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to update execution permissions."
      });
    }
    return;
  }

  if (message.type === "provider.captureScreen") {
    void captureScreenFromHelper(message.description, message.crop, clients, daemonPort);
    return;
  }

  if (message.type === "provider.vision.start") {
    const sessionId = resolveClientSessionId(storage, message.sessionId);
    const guardrails = readVisionGuardrails(message.mode, {
      frameIntervalMs: message.frameIntervalMs,
      maxDurationMs: message.maxDurationMs,
      detail: message.detail
    });
    const stream = storage.createVisionStream({
      id: message.id,
      sessionId,
      mode: message.mode,
      fps: message.fps,
      frameIntervalMs: message.frameIntervalMs,
      maxDurationMs: message.maxDurationMs,
      detail: {
        source: "renderer",
        retention: message.mode === "agent_stream" ? "metadata_only" : "recording_blob",
        guardrails,
        client: readRecord(message.detail) ?? {}
      }
    });
    recordRuntimeActivity(
      storage,
      sessionId,
      "info",
      "vision",
      message.mode === "recording" ? "Vision recording started" : "Agent screen stream started",
      { streamId: stream.id, mode: stream.mode, guardrails }
    );
    broadcast(clients, {
      type: "provider.vision",
      state: "started",
      stream,
      message: message.mode === "recording" ? "WebM recording started" : "Agent screen stream started"
    });
    broadcastLedgerSnapshot(clients, storage, sessionId);
    return;
  }

  if (message.type === "provider.vision.stop") {
    try {
      const stream = storage.stopVisionStream({ id: message.id, reason: message.reason });
      const streamSessionId = resolveStreamSessionId(storage, stream);
      recordRuntimeActivity(storage, streamSessionId, "info", "vision", "Vision session stopped", {
        streamId: stream.id,
        mode: stream.mode,
        reason: message.reason
      });
      broadcast(clients, { type: "provider.vision", state: "stopped", stream, message: "Vision session stopped" });
      broadcastLedgerSnapshot(clients, storage, streamSessionId);
    } catch (error) {
      send(socket, { type: "error", message: error instanceof Error ? error.message : "Unable to stop Vision session." });
    }
    return;
  }

  if (message.type === "provider.vision.recording.complete") {
    try {
      if (message.dataUrl.length > MAX_VISION_RECORDING_DATA_URL_CHARS) {
        throw new Error("Recording exceeded the daemon ingest limit.");
      }
      const stream = storage.completeVisionRecording({
        id: message.id,
        mime: message.mime,
        dataUrl: message.dataUrl,
        durationMs: message.durationMs,
        size: message.size
      });
      const streamSessionId = resolveStreamSessionId(storage, stream);
      recordRuntimeActivity(storage, streamSessionId, "info", "vision", "Vision recording saved", {
        streamId: stream.id,
        mode: stream.mode,
        blobId: stream.recordingBlobId,
        durationMs: message.durationMs,
        size: message.size
      });
      broadcast(clients, { type: "provider.vision", state: "completed", stream, message: "WebM recording saved" });
      broadcastLedgerSnapshot(clients, storage, streamSessionId);
    } catch (error) {
      const stream = storage.stopVisionStream({ id: message.id, status: "error", reason: error instanceof Error ? error.message : "Recording failed." });
      const streamSessionId = resolveStreamSessionId(storage, stream);
      recordRuntimeActivity(storage, streamSessionId, "error", "vision", "Vision recording failed", {
        streamId: stream.id,
        error: error instanceof Error ? error.message : "Recording failed."
      });
      broadcast(clients, {
        type: "provider.vision",
        state: "error",
        stream,
        message: error instanceof Error ? error.message : "Recording failed."
      });
      broadcastLedgerSnapshot(clients, storage, streamSessionId);
    }
    return;
  }

  if (message.type === "provider.vision.error") {
    try {
      const stream = storage.stopVisionStream({ id: message.id, status: "error", reason: message.message });
      const streamSessionId = resolveStreamSessionId(storage, stream);
      recordRuntimeActivity(storage, streamSessionId, "error", "vision", message.message, { streamId: stream.id });
      broadcast(clients, { type: "provider.vision", state: "error", stream, message: message.message });
      broadcastLedgerSnapshot(clients, storage, streamSessionId);
    } catch {
      send(socket, { type: "error", message: message.message });
    }
    return;
  }

  if (message.type === "visionContext.start") {
    try {
      const sessionId = resolveClientSessionId(storage, message.sessionId);
      const session = visionContext.start({
        id: message.captureId,
        sessionId,
        source: message.source,
        retention: message.retention,
        rawMedia: message.rawMedia
      } satisfies VisionContextStartInput);
      recordRuntimeActivity(storage, sessionId, "info", "vision-context", "Vision Context session started", summarizeCaptureSession(session));
      broadcast(clients, { type: "visionContext.started", captureId: session.id });
      broadcast(clients, {
        type: "visionContext.progress",
        captureId: session.id,
        status: "started",
        detail: summarizeCaptureSession(session)
      });
      broadcastLedgerSnapshot(clients, storage, sessionId);
    } catch (error) {
      send(socket, {
        type: "visionContext.error",
        captureId: message.captureId ?? "",
        error: error instanceof Error ? error.message : "Unable to start Vision Context session."
      });
    }
    return;
  }

  if (message.type === "visionContext.event") {
    try {
      const session = visionContext.addEvent(message.captureId, normalizeVisionContextEvent(message.event));
      broadcast(clients, {
        type: "visionContext.progress",
        captureId: message.captureId,
        status: "event",
        detail: summarizeCaptureSession(session)
      });
    } catch (error) {
      send(socket, {
        type: "visionContext.error",
        captureId: message.captureId,
        error: error instanceof Error ? error.message : "Unable to record Vision Context event."
      });
    }
    return;
  }

  if (message.type === "visionContext.cancel") {
    try {
      const session = visionContext.cancel(message.captureId);
      recordRuntimeActivity(storage, resolveStreamSessionId(storage, session), "warn", "vision-context", "Vision Context session cancelled", summarizeCaptureSession(session));
      broadcast(clients, {
        type: "visionContext.progress",
        captureId: message.captureId,
        status: "cancelled",
        detail: summarizeCaptureSession(session)
      });
    } catch (error) {
      send(socket, {
        type: "visionContext.error",
        captureId: message.captureId,
        error: error instanceof Error ? error.message : "Unable to cancel Vision Context session."
      });
    }
    return;
  }

  if (message.type === "visionContext.stop") {
    try {
      const pending = visionContext.get(message.captureId);
      if (!pending) {
        throw new Error(`Vision Context session not found: ${message.captureId}`);
      }
      const observations = await collectAdapterObservations({
        captureSession: pending,
        timeRange: readVisionContextTimeRange(pending.timeline),
        activeSource: pending.source,
        hints: {
          utterance: pending.timeline.filter((event) => event.type === "speech").map((event) => event.text).join(" "),
          pointerEvents: pending.timeline.filter((event): event is Extract<CaptureEvent, { type: "pointer" }> => event.type === "pointer"),
          currentMode: "screen"
        },
        providerState: {
          screenSnapshot: providers.getScreenSnapshot(),
          domSnapshot: providers.getDomSnapshot()
        }
      });
      const completed = await visionContext.complete({ captureId: message.captureId, observations });
      const sessionId = resolveClientSessionId(storage, message.sessionId ?? completed.session.sessionId);
      const capsuleSummary = {
        id: completed.capsule.id,
        intent: completed.capsule.resolvedIntent,
        evidenceCount: completed.capsule.evidence.length,
        deletedRawMedia: completed.deletedRawMedia.length,
        userUtterance: completed.capsule.userUtterance
      };
      recordRuntimeActivity(storage, sessionId, "info", "vision-context", "Vision Context capsule created", capsuleSummary);
      broadcast(clients, { type: "visionContext.capsule", captureId: message.captureId, capsuleSummary });
      broadcastLedgerSnapshot(clients, storage, sessionId);

      if (message.sendToAgent) {
        const requestId = message.requestId?.trim() || `vision-context:${message.captureId}`;
        broadcast(clients, { type: "visionContext.sent", captureId: message.captureId, requestId });
        await runAskMessage({
          message: {
            type: "ask",
            id: requestId,
            text: renderVisibleUserMessage(completed.capsule),
            mode: "screen",
            sessionId,
            model: message.model,
            reasoningEffort: message.reasoningEffort,
            appServerInput: buildAppServerUserInput(completed.capsule)
          },
          controllers,
          retainedMessages,
          toolOutputBuffers,
          auth,
          clients,
          requestSessions,
          storage,
          agentSession,
          codexAppServer,
          providers
        });
      }
    } catch (error) {
      send(socket, {
        type: "visionContext.error",
        captureId: message.captureId,
        error: error instanceof Error ? error.message : "Unable to complete Vision Context session."
      });
    }
    return;
  }

  if (message.type === "browserAction.start") {
    try {
      const sessionId = resolveClientSessionId(storage, message.sessionId);
      const session = browserActions.start({
        id: message.actionSessionId,
        sessionId,
        mode: message.mode,
        source: message.source
      });
      recordRuntimeActivity(storage, sessionId, "info", "browser-action", "Browser Action session started", summarizeBrowserActionSession(session));
      broadcast(clients, { type: "browserAction.started", actionSessionId: session.id, summary: summarizeBrowserActionSession(session) });
      broadcastLedgerSnapshot(clients, storage, sessionId);
    } catch (error) {
      send(socket, {
        type: "browserAction.error",
        actionSessionId: message.actionSessionId ?? "",
        error: error instanceof Error ? error.message : "Unable to start Browser Action session."
      });
    }
    return;
  }

  if (message.type === "browserAction.adapters") {
    try {
      const adapters = await browserActions.getAdapterStatuses(message.actionSessionId);
      send(socket, {
        type: "browserAction.adapters",
        actionSessionId: message.actionSessionId,
        adapters
      });
    } catch (error) {
      send(socket, {
        type: "browserAction.error",
        actionSessionId: message.actionSessionId ?? "",
        error: error instanceof Error ? error.message : "Unable to read Browser Action adapter status."
      });
    }
    return;
  }

  if (message.type === "browserAction.observe") {
    try {
      const observed = message.adapterId && message.adapterId !== "extension"
        ? await browserActions.observeViaAdapter({ actionSessionId: message.actionSessionId, adapterId: message.adapterId })
        : browserActions.observe({ actionSessionId: message.actionSessionId, snapshot: providers.getDomSnapshot() });
      recordBrowserActionAudit(storage, observed.audit);
      broadcast(clients, {
        type: "browserAction.observation",
        actionSessionId: message.actionSessionId,
        observationSummary: summarizeBrowserObservation(observed.observation)
      });
      broadcastLedgerSnapshot(clients, storage, resolveClientSessionId(storage, observed.session.sessionId));
    } catch (error) {
      send(socket, {
        type: "browserAction.error",
        actionSessionId: message.actionSessionId,
        error: error instanceof Error ? error.message : "Unable to observe browser state."
      });
    }
    return;
  }

  if (message.type === "browserAction.execute") {
    try {
      const execution = await browserActions.execute({
        actionSessionId: message.actionSessionId,
        action: message.action as BrowserAction,
        snapshot: providers.getDomSnapshot(),
        adapterId: message.adapterId,
        approved: message.approved,
        targetHint: message.targetHint
      });
      recordBrowserActionAudit(storage, execution.audit);
      const sessionId = resolveClientSessionId(storage, execution.session.sessionId);
      if (execution.approval) {
        broadcast(clients, {
          type: "interaction.required",
          interaction: {
            id: execution.approval.id,
            requestId: message.requestId,
            kind: "approval",
            title: "Browser action approval",
            body: buildBrowserActionApprovalBody(execution.result),
            action: `Browser action: ${execution.result.safety.actionLabel}`
          }
        });
        broadcast(clients, {
          type: "browserAction.progress",
          actionSessionId: message.actionSessionId,
          status: "approval_required",
          detail: summarizeBrowserActionResult(execution.result)
        });
      } else if (execution.command) {
        broadcast(clients, {
          type: "browserAction.progress",
          actionSessionId: message.actionSessionId,
          status: "queued",
          detail: { requestId: execution.command.requestId, action: execution.command.action.type }
        });
      } else {
        broadcast(clients, {
          type: "browserAction.result",
          actionSessionId: message.actionSessionId,
          result: summarizeBrowserActionResult(execution.result)
        });
      }
      broadcastLedgerSnapshot(clients, storage, sessionId);
    } catch (error) {
      send(socket, {
        type: "browserAction.error",
        actionSessionId: message.actionSessionId,
        error: error instanceof Error ? error.message : "Unable to execute Browser Action."
      });
    }
    return;
  }

  if (message.type === "browserAction.cancel") {
    try {
      const session = browserActions.cancel(message.actionSessionId);
      recordRuntimeActivity(storage, resolveClientSessionId(storage, session.sessionId), "warn", "browser-action", "Browser Action session cancelled", summarizeBrowserActionSession(session));
      broadcast(clients, {
        type: "browserAction.progress",
        actionSessionId: message.actionSessionId,
        status: "cancelled",
        detail: summarizeBrowserActionSession(session)
      });
      broadcastLedgerSnapshot(clients, storage, resolveClientSessionId(storage, session.sessionId));
    } catch (error) {
      send(socket, {
        type: "browserAction.error",
        actionSessionId: message.actionSessionId,
        error: error instanceof Error ? error.message : "Unable to cancel Browser Action session."
      });
    }
    return;
  }

  if (message.type === "terminal.input") {
    try {
      if (typeof message.data !== "string" || message.data.length > 4096) {
        throw new Error("Terminal input is invalid or too large.");
      }
      writeTerminalSessionInput(message.data, message.label?.trim() || "input");
    } catch (error) {
      send(socket, {
        type: "error",
        id: message.id,
        message: error instanceof Error ? error.message : "Unable to send terminal input."
      });
    }
    return;
  }

  if (message.type !== "ask") {
    send(socket, { type: "error", message: "Unsupported daemon message." });
    return;
  }

  await runAskMessage({
    message,
    controllers,
    retainedMessages,
    toolOutputBuffers,
    auth,
    clients,
    requestSessions,
    storage,
    agentSession,
    codexAppServer,
    providers
  });
}

async function runAskMessage(input: {
  message: Extract<ClientMessage, { type: "ask" }>;
  controllers: Map<string, AbortController>;
  retainedMessages: Map<string, RetainedMessage>;
  toolOutputBuffers: Map<string, Map<string, string>>;
  auth: OAuthSession;
  clients: Set<WebSocket>;
  requestSessions: Map<string, string>;
  storage: StorageService;
  agentSession: AgentSessionState;
  codexAppServer: CodexAppServerBridge;
  providers: ProviderRegistry;
}): Promise<void> {
  const {
    message,
    controllers,
    retainedMessages,
    toolOutputBuffers,
    auth,
    clients,
    requestSessions,
    storage,
    agentSession,
    codexAppServer,
    providers
  } = input;
  const controller = new AbortController();
  controllers.set(message.id, controller);
  const persistedAsk = storage.prepareAsk({
    requestId: message.id,
    sessionId: message.sessionId,
    text: message.text,
    mode: message.mode,
    model: message.model,
    reasoningEffort: message.reasoningEffort,
    replaceFromMessageId: message.regenerate?.replaceFromMessageId
  });
  requestSessions.set(message.id, persistedAsk.sessionId);
  broadcast(clients, { type: "session.snapshot", snapshot: persistedAsk.snapshot });
  broadcastLedgerSnapshot(clients, storage, persistedAsk.sessionId);

  try {
    bindCodexAppServerThread(storage, persistedAsk.sessionId, codexAppServer);
    await prepareRegeneration(message, auth, codexAppServer);
    await runAgentStream(message, (event) => {
      const ledgerChanged = persistRuntimeEvent(storage, persistedAsk.sessionId, event, {
        toolOutputBuffers,
        workspaceRoot: resolveCodexExecutionContext().workdir
      });
      retainAndBroadcast(clients, retainedMessages, event);
      if (ledgerChanged) {
        broadcastLedgerSnapshot(clients, storage, persistedAsk.sessionId);
      }
    }, controller.signal, {
      ...auth.getProxyCredentials(),
      authStatus: auth.getStatus(),
      session: agentSession,
      codexAppServer,
      providers,
      executionPermissions: {
        read: (action) => storage.readExecutionPermissionDecision(action)
      }
    });
    persistCodexAppServerThread(storage, persistedAsk.sessionId, codexAppServer);
  } catch (error) {
    persistCodexAppServerThread(storage, persistedAsk.sessionId, codexAppServer, error);
    if (controller.signal.aborted) {
      storage.updateAssistantMessage({ sessionId: persistedAsk.sessionId, messageId: message.id, status: "cancelled" });
      recordRuntimeActivity(storage, persistedAsk.sessionId, "warn", "request", "request cancelled", { requestId: message.id });
      broadcastLedgerSnapshot(clients, storage, persistedAsk.sessionId);
      retainAndBroadcast(clients, retainedMessages, { type: "session.state", state: "cancelled", id: message.id });
      return;
    }
    storage.updateAssistantMessage({ sessionId: persistedAsk.sessionId, messageId: message.id, status: "error" });
    recordRuntimeActivity(storage, persistedAsk.sessionId, "error", "request", error instanceof Error ? error.message : "Unknown daemon error.", { requestId: message.id });
    broadcastLedgerSnapshot(clients, storage, persistedAsk.sessionId);
    retainAndBroadcast(clients, retainedMessages, {
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : "Unknown daemon error."
    });
    retainAndBroadcast(clients, retainedMessages, { type: "session.state", state: "error", id: message.id });
  } finally {
    controllers.delete(message.id);
    requestSessions.delete(message.id);
  }
}

function normalizeVisionContextEvent(input: unknown): CaptureEvent {
  const record = readRecord(input);
  if (!record || typeof record.type !== "string") {
    throw new Error("Vision Context event must include a type.");
  }
  const base = {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : cryptoRandomId(),
    t: Math.max(0, Math.floor(Number(record.t ?? 0)))
  };
  if (record.type === "speech") {
    return {
      ...base,
      type: "speech",
      text: readStringField(record.text),
      confidence: clampUnit(Number(record.confidence ?? 0.75))
    };
  }
  if (record.type === "screenshot") {
    return {
      ...base,
      type: "screenshot",
      path: readOptionalString(record.path),
      dataUrl: readOptionalString(record.dataUrl),
      cropOf: readOptionalString(record.cropOf),
      bbox: readRect(record.bbox),
      purpose: readScreenshotPurpose(record.purpose),
      perceptualHash: readOptionalString(record.perceptualHash),
      text: readOptionalString(record.text)
    };
  }
  if (record.type === "pointer") {
    return {
      ...base,
      type: "pointer",
      action: readPointerAction(record.action),
      x: Number(record.x ?? 0),
      y: Number(record.y ?? 0),
      toX: typeof record.toX === "number" ? record.toX : undefined,
      toY: typeof record.toY === "number" ? record.toY : undefined,
      bbox: readRect(record.bbox)
    };
  }
  if (record.type === "active_window") {
    return {
      ...base,
      type: "active_window",
      appName: readOptionalString(record.appName),
      windowTitle: readOptionalString(record.windowTitle),
      url: readOptionalString(record.url)
    };
  }
  if (record.type === "semantic") {
    return {
      ...base,
      type: "semantic",
      source: readObservationSource(record.source),
      kind: readObservationKind(record.kind),
      label: readOptionalString(record.label),
      text: readOptionalString(record.text),
      bbox: readRect(record.bbox),
      path: readOptionalString(record.path),
      metadata: readRecord(record.metadata),
      confidence: clampUnit(Number(record.confidence ?? 0.68))
    };
  }
  if (record.type === "keyboard") {
    return {
      ...base,
      type: "keyboard",
      action: readKeyboardAction(record.action),
      text: readOptionalString(record.text),
      key: readOptionalString(record.key)
    };
  }
  if (record.type === "scroll") {
    return {
      ...base,
      type: "scroll",
      x: typeof record.x === "number" ? record.x : undefined,
      y: typeof record.y === "number" ? record.y : undefined,
      deltaX: typeof record.deltaX === "number" ? record.deltaX : undefined,
      deltaY: typeof record.deltaY === "number" ? record.deltaY : undefined
    };
  }
  if (record.type === "artifact") {
    return {
      ...base,
      type: "artifact",
      title: readStringField(record.title),
      path: readOptionalString(record.path),
      text: readOptionalString(record.text),
      metadata: readRecord(record.metadata)
    };
  }
  throw new Error(`Unsupported Vision Context event type: ${record.type}`);
}

function readVisionContextTimeRange(events: CaptureEvent[]): { startMs: number; endMs: number } {
  if (events.length === 0) {
    return { startMs: 0, endMs: 0 };
  }
  const times = events.map((event) => event.t);
  return { startMs: Math.min(...times), endMs: Math.max(...times) };
}

async function captureScreenFromHelper(
  description: string | undefined,
  crop: ScreenCrop | undefined,
  clients: Set<WebSocket>,
  daemonPort: number
): Promise<void> {
  broadcast(clients, {
    type: "provider.capture",
    mode: "screen",
    state: "started",
    message: "screen capture started"
  });

  try {
    const result = await captureScreenSnapshot({ daemonPort, description, crop });
    broadcast(clients, {
      type: "provider.capture",
      mode: "screen",
      state: "completed",
      message: result.output || "screen capture completed"
    });
  } catch (error) {
    broadcast(clients, {
      type: "provider.capture",
      mode: "screen",
      state: "error",
      message: error instanceof Error ? error.message : "Screen capture failed."
    });
  }
}

function resolveClientSessionId(storage: StorageService, sessionId: string | undefined): string {
  if (sessionId) {
    const snapshot = storage.ensureSessionSnapshot();
    if (snapshot.sessions.some((session) => session.id === sessionId)) {
      return sessionId;
    }
  }
  return storage.ensureSessionSnapshot().activeSessionId;
}

function resolveStreamSessionId(storage: StorageService, stream: { sessionId?: string }): string {
  return stream.sessionId ?? storage.ensureSessionSnapshot().activeSessionId;
}

function readVisionGuardrails(
  mode: "recording" | "agent_stream",
  input: { frameIntervalMs?: number; maxDurationMs?: number; detail?: unknown } = {}
): Record<string, unknown> {
  const detail = readRecord(input.detail);
  const resource = readRecord(detail?.resource);
  const maxDurationMs = typeof input.maxDurationMs === "number" && Number.isFinite(input.maxDurationMs)
    ? input.maxDurationMs
    : 120_000;
  const frameIntervalMs = typeof input.frameIntervalMs === "number" && Number.isFinite(input.frameIntervalMs)
    ? input.frameIntervalMs
    : 1000;
  return mode === "recording"
    ? {
        format: "video/webm",
        maxIngestBytes: Math.floor(MAX_VISION_RECORDING_DATA_URL_CHARS * 0.75),
        maxDurationMs,
        localMaxBytes: normalizePositiveNumber(detail?.localMaxBytes),
        persistence: "blob"
      }
    : {
        frameIntervalMs,
        maxFps: Number((1000 / frameIntervalMs).toFixed(2)),
        maxDurationMs,
        maxFrameWidth: normalizePositiveNumber(resource?.maxFrameWidth),
        jpegQuality: normalizePositiveNumber(resource?.jpegQuality),
        overlapPolicy: typeof resource?.overlapPolicy === "string" ? resource.overlapPolicy : "drop_if_previous_frame_pending",
        persistence: "metadata_only",
        retention: "no_video_file"
      };
}

function normalizePositiveNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readStringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown): string | undefined {
  const string = readStringField(value);
  return string || undefined;
}

function readRect(value: unknown): { x: number; y: number; w: number; h: number } | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  const width = Number(record.w ?? record.width);
  const height = Number(record.h ?? record.height);
  const x = Number(record.x);
  const y = Number(record.y);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, w: width, h: height };
}

function readScreenshotPurpose(value: unknown): Extract<CaptureEvent, { type: "screenshot" }>["purpose"] {
  return value === "primary_media" ||
    value === "referent_crop" ||
    value === "temporal_evidence" ||
    value === "error_evidence" ||
    value === "full"
    ? value
    : "full";
}

function readPointerAction(value: unknown): Extract<CaptureEvent, { type: "pointer" }>["action"] {
  return value === "move" || value === "click" || value === "drag" || value === "circle" || value === "highlight"
    ? value
    : "click";
}

function readKeyboardAction(value: unknown): Extract<CaptureEvent, { type: "keyboard" }>["action"] {
  return value === "type" || value === "shortcut" || value === "submit" ? value : "type";
}

function readObservationSource(value: unknown): Extract<CaptureEvent, { type: "semantic" }>["source"] {
  return value === "screen" ||
    value === "ocr" ||
    value === "browser" ||
    value === "terminal" ||
    value === "ide" ||
    value === "document" ||
    value === "accessibility" ||
    value === "pointer" ||
    value === "speech"
    ? value
    : "screen";
}

function readObservationKind(value: unknown): Extract<CaptureEvent, { type: "semantic" }>["kind"] {
  return value === "image" ||
    value === "text" ||
    value === "ui_element" ||
    value === "file" ||
    value === "command" ||
    value === "error" ||
    value === "selection" ||
    value === "media" ||
    value === "page" ||
    value === "window" ||
    value === "gesture"
    ? value
    : "text";
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function persistRuntimeEvent(
  storage: StorageService,
  sessionId: string,
  event: ServerEvent,
  options: {
    toolOutputBuffers: Map<string, Map<string, string>>;
    workspaceRoot: string;
  }
): boolean {
  if (event.type === "message.delta") {
    storage.appendAssistantDelta({
      sessionId,
      messageId: event.id,
      text: event.text,
      status: "streaming"
    });
    return false;
  }

  if (event.type === "message.completed") {
    storage.updateAssistantMessage({
      sessionId,
      messageId: event.id,
      text: event.text,
      status: "done"
    });
    recordRuntimeActivity(storage, sessionId, "info", "message", "response completed", { requestId: event.id });
    return true;
  }

  if (event.type === "message.snapshot") {
    storage.updateAssistantMessage({
      sessionId,
      messageId: event.id,
      text: event.text,
      status: event.status
    });
    return false;
  }

  if (event.type === "tool.started") {
    storage.updateAssistantMessage({
      sessionId,
      messageId: event.id,
      status: "tooling"
    });
    if (isTerminalProviderTool(event.tool)) {
      storage.recordProviderSnapshot({
        sessionId,
        messageId: event.id,
        provider: "terminal",
        title: event.label || "Terminal provider",
        summary: `${terminalProviderLabel(event.tool)} started`,
        data: {
          requestId: event.id,
          tool: event.tool,
          label: event.label
        }
      });
    }
    recordRuntimeActivity(storage, sessionId, "info", "tool", event.label, { requestId: event.id, tool: event.tool });
    return true;
  }

  if (event.type === "tool.output") {
    appendToolOutputBuffer(options.toolOutputBuffers, event.id, event.tool, event.chunk);
    return false;
  }

  if (event.type === "tool.completed") {
    storage.updateAssistantMessage({
      sessionId,
      messageId: event.id,
      status: "streaming"
    });
    consumeToolOutputBuffer(options.toolOutputBuffers, event.id, event.tool);
    recordRuntimeActivity(storage, sessionId, "info", "tool", `${event.tool} completed`, { requestId: event.id, tool: event.tool });
    return true;
  }

  if (event.type === "execution.permission.applied") {
    recordRuntimeActivity(storage, sessionId, "info", "permission", `Saved permission ${event.decision}: ${event.action}`, {
      requestId: event.id,
      action: event.action,
      decision: event.decision
    });
    return true;
  }

  if (event.type === "session.state" && event.id) {
    const status = sessionStateToSnapshotStatus(event.state);
    if (status) {
      storage.updateAssistantMessage({
        sessionId,
        messageId: event.id,
        status
      });
    }
    return false;
  }

  if (event.type === "error" && event.id) {
    storage.updateAssistantMessage({
      sessionId,
      messageId: event.id,
      status: "error"
    });
    recordRuntimeActivity(storage, sessionId, "error", "request", event.message, { requestId: event.id });
    return true;
  }

  if (event.type === "artifact.fileChange") {
    storage.recordFileChangeArtifact({
      sessionId,
      messageId: event.id,
      changeId: event.changeId,
      phase: event.phase,
      title: event.title,
      operation: event.operation,
      paths: event.paths,
      workspaceRoot: options.workspaceRoot,
      detail: event.detail
    });
    recordRuntimeActivity(storage, sessionId, "info", "artifact", `${event.title} ${event.phase}`, {
      requestId: event.id,
      operation: event.operation,
      paths: event.paths
    });
    return true;
  }

  return false;
}

function resetAgentSession(agentSession: AgentSessionState): void {
  agentSession.codexThreadId = undefined;
  agentSession.proxySessionId = undefined;
}

function resetRuntimeSession(
  controllers: Map<string, AbortController>,
  retainedMessages: Map<string, RetainedMessage>,
  agentSession: AgentSessionState,
  codexAppServer: CodexAppServerBridge
): void {
  for (const controller of controllers.values()) {
    controller.abort();
  }
  controllers.clear();
  retainedMessages.clear();
  resetAgentSession(agentSession);
  codexAppServer.resetThread();
}

function syncCodexAppServer(auth: OAuthSession, codexAppServer: CodexAppServerBridge): void {
  const status = auth.getStatus();
  if (status.mode !== "codex" || !status.authenticated || process.env.CODEX_WIDGET_CODEX_RUNTIME === "exec") {
    codexAppServer.resetThread();
    return;
  }

  void codexAppServer.warm(resolveCodexExecutionContext()).catch(() => undefined);
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  auth: OAuthSession,
  onAuthChanged: () => void,
  providers: ProviderRegistry,
  browserActions: BrowserActionSessionManager,
  clients: Set<WebSocket>,
  storage: StorageService
): Promise<void> {
  if (!request.url) {
    response.writeHead(404).end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
  if (request.method === "OPTIONS" && (isProviderSnapshotPath(url.pathname) || isBrowserActionPath(url.pathname))) {
    response
      .writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "content-type"
      })
      .end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/browser-action/extension/poll") {
    writeJsonResponse(response, 200, { ok: true, command: browserActions.pollExtensionCommand() ?? null });
    return;
  }

  if (request.method === "POST" && url.pathname === "/browser-action/extension/result") {
    try {
      const completed = browserActions.completeExtensionCommand(JSON.parse(await readRequestBody(request, 512 * 1024)) as BrowserActionExecutionResult);
      recordBrowserActionAudit(storage, completed.audit);
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
    return;
  }

  if (request.method === "GET" && url.pathname === "/oauth/token") {
    auth.writeTokenEntryResponse(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/oauth/token") {
    try {
      auth.completeTokenEntry(new URLSearchParams(await readRequestBody(request)));
      auth.writeCallbackResponse(response, true, "OAuth token이 저장되었습니다. 위젯으로 돌아가 계속 사용할 수 있습니다.");
    } catch (error) {
      auth.writeCallbackResponse(
        response,
        false,
        error instanceof Error ? error.message : "OAuth token save failed."
      );
    } finally {
      onAuthChanged();
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/providers/dom/snapshot") {
    try {
      const snapshot = providers.setDomSnapshot(JSON.parse(await readRequestBody(request, 128 * 1024)));
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
    return;
  }

  if (request.method === "GET" && url.pathname === "/providers/dom/snapshot") {
    writeJsonResponse(response, 200, { ok: true, snapshot: providers.getDomSnapshot() });
    return;
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
    return;
  }

  if (request.method === "GET" && url.pathname === "/providers/screen/snapshot") {
    const snapshot = providers.getScreenSnapshot();
    writeJsonResponse(response, 200, { ok: true, snapshot: snapshot ? summarizeScreenSnapshot(snapshot) : null });
    return;
  }

  if (request.method === "GET" && url.pathname === "/storage/health") {
    writeJsonResponse(response, 200, { ok: true, storage: storage.health({ integrityCheck: true }) });
    return;
  }

  if (request.method !== "GET" || url.pathname !== "/oauth/callback") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Codex widget daemon");
    return;
  }

  try {
    await auth.completeCallback(url);
    auth.writeCallbackResponse(response, true, "위젯으로 돌아가 계속 사용할 수 있습니다.");
  } catch (error) {
    auth.writeCallbackResponse(
      response,
      false,
      error instanceof Error ? error.message : "OAuth callback failed."
    );
  } finally {
    onAuthChanged();
  }
}

async function readRequestBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function isProviderSnapshotPath(pathname: string): boolean {
  return pathname === "/providers/dom/snapshot" || pathname === "/providers/screen/snapshot";
}

function isBrowserActionPath(pathname: string): boolean {
  return pathname.startsWith("/browser-action/");
}

function recordBrowserActionAudit(storage: StorageService, audit: BrowserActionAuditEntry): void {
  recordRuntimeActivity(
    storage,
    resolveClientSessionId(storage, audit.sessionId),
    audit.level,
    "browser-action",
    audit.summary,
    audit.detail
  );
}

function buildBrowserActionApprovalBody(result: BrowserActionResult): string {
  const metadata = result.safety.metadata ?? {};
  const codePreview = typeof metadata.codePreview === "string" ? metadata.codePreview : "";
  const codeHash = typeof metadata.codeHash === "string" ? metadata.codeHash : "";
  const timeoutMs = typeof metadata.timeoutMs === "number" ? metadata.timeoutMs : undefined;
  const resultLimitBytes = typeof metadata.resultLimitBytes === "number" ? metadata.resultLimitBytes : undefined;
  return [
    result.safety.actionLabel,
    result.safety.targetSummary ? `Target: ${result.safety.targetSummary}` : "",
    `Risk: ${result.safety.risk}`,
    result.safety.reason,
    codeHash ? `Code SHA-256: ${codeHash}` : "",
    timeoutMs ? `Timeout: ${timeoutMs}ms` : "",
    resultLimitBytes ? `Result limit: ${resultLimitBytes} bytes` : "",
    codePreview ? `Code preview:\n${codePreview}` : ""
  ].filter(Boolean).join("\n");
}

function summarizeScreenSnapshot(snapshot: ScreenSnapshot): Omit<ScreenSnapshot, "imageDataUrl"> & {
  imageDataUrlLength: number;
} {
  return {
    source: snapshot.source,
    title: snapshot.title,
    description: snapshot.description,
    ocrText: snapshot.ocrText,
    imageHash: snapshot.imageHash,
    imageChanged: snapshot.imageChanged,
    imageDiffRatio: snapshot.imageDiffRatio,
    imageDiffThreshold: snapshot.imageDiffThreshold,
    imageMeaningfullyChanged: snapshot.imageMeaningfullyChanged,
    imageDataUrlLength: snapshot.imageDataUrl.length,
    capturedAt: snapshot.capturedAt
  };
}

function summarizeDomSnapshot(snapshot: DomSnapshot): string {
  const label = snapshot.title || readUrlHost(snapshot.url) || "DOM snapshot";
  const selected = snapshot.selection ? `${snapshot.selection.length} selected chars` : "";
  const text = snapshot.text ? `${snapshot.text.length} page chars` : "";
  const elements = snapshot.elements.length > 0 ? `${snapshot.elements.length} elements` : "";
  return [label, selected, text, elements].filter(Boolean).join(" · ");
}

function summarizeDomSnapshotData(snapshot: DomSnapshot): Record<string, unknown> {
  return {
    url: snapshot.url || undefined,
    title: snapshot.title || undefined,
    selectionLength: snapshot.selection.length,
    textLength: snapshot.text.length,
    elementCount: snapshot.elements.length,
    focusedElementId: snapshot.focusedElementId,
    selectionPreview: snapshot.selection ? snapshot.selection.slice(0, 240) : undefined,
    capturedAt: snapshot.capturedAt
  };
}

function summarizeVisionSnapshot(snapshot: ScreenSnapshot): string {
  const label = snapshot.title || snapshot.source || "Vision snapshot";
  const ocr = snapshot.ocrText ? `${snapshot.ocrText.length} OCR chars` : "";
  const changed = snapshot.imageHash ? `changed ${snapshot.imageMeaningfullyChanged ? "yes" : "no"}` : "";
  return [label, ocr, changed].filter(Boolean).join(" · ");
}

function readUrlHost(value: string): string {
  try {
    return value ? new URL(value).hostname : "";
  } catch {
    return value;
  }
}

async function prepareRegeneration(
  message: Extract<ClientMessage, { type: "ask" }>,
  auth: OAuthSession,
  codexAppServer: CodexAppServerBridge
): Promise<void> {
  const dropTurns = Math.floor(message.regenerate?.dropTurns ?? 0);
  if (dropTurns < 1) {
    return;
  }

  const status = auth.getStatus();
  if (status.mode === "codex" && status.authenticated && process.env.CODEX_WIDGET_CODEX_RUNTIME !== "exec") {
    await codexAppServer.rollbackThread(dropTurns);
  }
}

function bindCodexAppServerThread(
  storage: StorageService,
  sessionId: string,
  codexAppServer: CodexAppServerBridge
): void {
  const thread = storage.readRuntimeThread(sessionId, CODEX_APP_SERVER_RUNTIME_PROVIDER);
  codexAppServer.setThreadId(thread?.threadId);
}

function persistCodexAppServerThread(
  storage: StorageService,
  sessionId: string,
  codexAppServer: CodexAppServerBridge,
  error?: unknown
): void {
  const threadId = codexAppServer.getThreadId();
  if (!threadId) {
    storage.clearRuntimeThread(
      sessionId,
      CODEX_APP_SERVER_RUNTIME_PROVIDER,
      error instanceof Error ? error.message : undefined
    );
    return;
  }

  storage.writeRuntimeThread({
    sessionId,
    provider: CODEX_APP_SERVER_RUNTIME_PROVIDER,
    threadId,
    state: error ? "error" : "connected",
    lastError: error instanceof Error ? error.message : undefined
  });
}

function broadcast(clients: Set<WebSocket>, event: ServerEvent): void {
  for (const client of clients) {
    send(client, event);
  }
}

function sendSessionSnapshot(socket: WebSocket, storage: StorageService): void {
  try {
    send(socket, { type: "session.snapshot", snapshot: storage.ensureSessionSnapshot() });
  } catch (error) {
    send(socket, {
      type: "error",
      message: error instanceof Error ? error.message : "Unable to load sessions."
    });
  }
}

function sendExecutionPermissions(socket: WebSocket, storage: StorageService): void {
  try {
    send(socket, { type: "execution.permissions", permissions: storage.readExecutionPermissions() });
  } catch (error) {
    send(socket, {
      type: "error",
      message: error instanceof Error ? error.message : "Unable to load execution permissions."
    });
  }
}

function broadcastExecutionPermissions(clients: Set<WebSocket>, permissions: ExecutionPermissionSummary[]): void {
  broadcast(clients, { type: "execution.permissions", permissions });
}

function sendLedgerSnapshot(socket: WebSocket, storage: StorageService, sessionId?: string): void {
  try {
    send(socket, { type: "ledger.snapshot", snapshot: storage.readLedgerSnapshot(sessionId) });
  } catch (error) {
    send(socket, {
      type: "error",
      message: error instanceof Error ? error.message : "Unable to load artifact ledger."
    });
  }
}

function broadcastLedgerSnapshot(clients: Set<WebSocket>, storage: StorageService, sessionId?: string): void {
  try {
    broadcast(clients, { type: "ledger.snapshot", snapshot: storage.readLedgerSnapshot(sessionId) });
  } catch {
    // Ledger refresh must not interrupt streaming turns.
  }
}

function publishSessionMutation(
  socket: WebSocket,
  clients: Set<WebSocket>,
  storage: StorageService,
  mutate: () => SessionSnapshot,
  options: { reset?: boolean } = {}
): void {
  try {
    const snapshot = mutate();
    if (options.reset) {
      broadcast(clients, { type: "session.reset" });
    }
    broadcast(clients, { type: "session.snapshot", snapshot });
    broadcastLedgerSnapshot(clients, storage, snapshot.activeSessionId);
    broadcast(clients, { type: "session.state", state: "idle" });
  } catch (error) {
    send(socket, {
      type: "error",
      message: error instanceof Error ? error.message : "Unable to update sessions."
    });
  }
}

function appendToolOutputBuffer(
  buffers: Map<string, Map<string, string>>,
  requestId: string,
  tool: string,
  chunk: string
): void {
  if (!chunk) {
    return;
  }
  let byTool = buffers.get(requestId);
  if (!byTool) {
    byTool = new Map<string, string>();
    buffers.set(requestId, byTool);
  }
  const current = byTool.get(tool) ?? "";
  byTool.set(tool, `${current}${chunk}`.slice(-MAX_LEDGER_TOOL_OUTPUT_CHARS));
}

function consumeToolOutputBuffer(
  buffers: Map<string, Map<string, string>>,
  requestId: string,
  tool: string
): string {
  const byTool = buffers.get(requestId);
  const output = byTool?.get(tool) ?? "";
  byTool?.delete(tool);
  if (byTool && byTool.size === 0) {
    buffers.delete(requestId);
  }
  return output;
}

function isTerminalProviderTool(tool: string): boolean {
  return tool === "terminal" || tool.startsWith("terminal:") || tool.startsWith("terminal-session:");
}

function terminalProviderLabel(tool: string): string {
  return tool.startsWith("terminal-session:") ? "PTY" : "Terminal";
}

function recordRuntimeActivity(
  storage: StorageService,
  sessionId: string,
  level: "debug" | "info" | "warn" | "error",
  category: string,
  summary: string,
  detail?: unknown
): void {
  storage.recordActivity({
    id: cryptoRandomId(),
    sessionId,
    level,
    category,
    summary: summary.slice(0, 240),
    detail
  });
}

function cryptoRandomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function openPathWithSystem(path: string): void {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", path], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [path], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [path], { detached: true, stdio: "ignore" }).unref();
}

function retainAndBroadcast(
  clients: Set<WebSocket>,
  retainedMessages: Map<string, RetainedMessage>,
  event: ServerEvent
): void {
  retainServerEvent(retainedMessages, event);
  broadcast(clients, event);
}

function retainServerEvent(retainedMessages: Map<string, RetainedMessage>, event: ServerEvent): void {
  if (event.type === "message.delta") {
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: `${current?.text ?? ""}${event.text}`,
      status: current?.status === "tooling" ? "tooling" : "streaming",
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "message.completed") {
    retainMessage(retainedMessages, {
      id: event.id,
      text: event.text,
      status: "done",
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "session.state" && event.id) {
    const status = sessionStateToSnapshotStatus(event.state);
    if (!status) {
      return;
    }
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: current?.text ?? "",
      status,
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "tool.started" || event.type === "tool.completed") {
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: current?.text ?? "",
      status: event.type === "tool.started" ? "tooling" : "streaming",
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "error" && event.id) {
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: current?.text ?? "",
      status: "error",
      updatedAt: Date.now()
    });
  }
}

function sessionStateToSnapshotStatus(state: Extract<ServerEvent, { type: "session.state" }>["state"]): MessageSnapshotStatus | undefined {
  if (state === "idle") {
    return undefined;
  }
  if (state === "thinking" || state === "tooling" || state === "streaming" || state === "cancelled" || state === "error") {
    return state;
  }
  return undefined;
}

function retainMessage(retainedMessages: Map<string, RetainedMessage>, message: RetainedMessage): void {
  retainedMessages.set(message.id, message);
  if (retainedMessages.size <= MAX_RETAINED_MESSAGES) {
    return;
  }

  const oldest = [...retainedMessages.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0];
  if (oldest) {
    retainedMessages.delete(oldest.id);
  }
}

function replayRetainedMessages(socket: WebSocket, retainedMessages: Map<string, RetainedMessage>): void {
  for (const message of [...retainedMessages.values()].sort((left, right) => left.updatedAt - right.updatedAt)) {
    send(socket, {
      type: "message.snapshot",
      id: message.id,
      text: message.text,
      status: message.status
    });
  }
}

function writeJsonResponse(response: ServerResponse, status: number, body: unknown): void {
  response
    .writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type"
    })
    .end(JSON.stringify(body));
}

function send(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function getServerPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    return 0;
  }
  return address.port;
}

function readRuntimeStatus(
  startedAt: number,
  clients: Set<WebSocket>,
  controllers: Map<string, AbortController>,
  codexAppServer: CodexAppServerBridge,
  storage: StorageService
): RuntimeStatus {
  const storageHealth = storage.health({ integrityCheck: false });
  return {
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    clients: clients.size,
    activeRequests: controllers.size,
    storage: {
      state: storageHealth.state,
      databasePath: storageHealth.databasePath,
      blobDir: storageHealth.blobDir,
      schemaVersion: storageHealth.schemaVersion,
      latestSchemaVersion: storageHealth.latestSchemaVersion,
      migrationsApplied: storageHealth.migrationsApplied,
      tableCount: storageHealth.tableCount,
      journalMode: storageHealth.journalMode,
      foreignKeys: storageHealth.foreignKeys,
      integrity: storageHealth.integrity
    },
    codexAppServer: codexAppServer.getStatus()
  };
}
