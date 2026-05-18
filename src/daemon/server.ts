import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentSessionState } from "./agent.js";
import { CodexAppServerBridge } from "./codexAppServer.js";
import { OAuthSession } from "./oauth.js";
import { ProviderRegistry } from "./providers/providerRegistry.js";
import { subscribeTerminalSessionOutput } from "./providers/terminalSessionProvider.js";
import { createStorageService } from "./storage/storage.js";
import { BrowserActionSessionManager } from "./browser-action/index.js";
import { BrowserChromeCommandBridge } from "./browser-chrome/index.js";
import { BrowserPerceptionService } from "./browser-perception/index.js";
import { CapabilityRuntime, mapCapabilityRuntimeEvent } from "./capability-runtime/index.js";
import { CapabilityDagRuntime } from "./capability-dag/index.js";
import { ComputerSessionRuntime } from "./computer-use/index.js";
import { VisionContextSessionManager } from "./vision-context/index.js";
import { createSemanticMemoryStore } from "./semantic-interface/index.js";
import { registerDaemonCapabilities } from "./capabilities/registerCapabilities.js";
import { createBrowserExtensionBridgeStore } from "./server/browser-bridge/store.js";
import { readExpectedBrowserBridgeBuildInfo } from "./server/browser-bridge/extensionBuild.js";
import {
  clearBrowserActionCommandWaiters,
  type BrowserActionCommandWaiter
} from "./server/browser-action/commandWaiters.js";
import { broadcast, type RetainedMessage } from "./server/events.js";
import { getServerPort } from "./server/http.js";
import { createDaemonLocalAuth } from "./server/localAuth.js";
import { readRuntimeStatus } from "./server/runtimeStatus.js";
import {
  type PendingSemanticClarification
} from "./server/browser-action/clarification.js";
import { handleHttpRequest } from "./server/http/routes.js";
import { syncCodexAppServer } from "./server/runtime/codexAppServerThread.js";
import { handleWebSocketConnection } from "./server/ws/connection.js";
import { recordBrowserActionAudit, buildBrowserActionApprovalBody } from "./server/browser-action/helpers.js";
import { broadcastLedgerSnapshot } from "./server/clientEvents.js";
import {
  recordBrowserActionCapabilityApproval,
  recordBrowserActionCapabilityCommandQueued,
  recordBrowserActionCapabilityResult
} from "./server/browser-action/capabilityMirror.js";
import { applyEvaluateCredentialAccess, summarizeBrowserActionResult, type BrowserAction } from "./browser-action/index.js";
import { readAutonomyPermissionModeCapabilities } from "./scoped-autonomy/permissionProfile.js";

export type DaemonHandle = {
  port: number;
  close: () => Promise<void>;
};

export type DaemonOptions = {
  port?: number;
};

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
  const browserPerception = new BrowserPerceptionService();
  const visionContext = new VisionContextSessionManager();
  const browserExtensionBridge = createBrowserExtensionBridgeStore({
    expectedBuild: readExpectedBrowserBridgeBuildInfo()
  });
  const storage = createStorageService();
  const semanticMemory = createSemanticMemoryStore();
  const browserActions = new BrowserActionSessionManager(undefined, semanticMemory);
  const browserChromeCommands = new BrowserChromeCommandBridge();
  const localAuth = createDaemonLocalAuth();
  const capabilityRuntime = new CapabilityRuntime({
    storage,
    emit: (event) => broadcast(clients, mapCapabilityRuntimeEvent(event))
  });
  const capabilityDagRuntime = new CapabilityDagRuntime(storage, capabilityRuntime);
  const computerSessionRuntime = new ComputerSessionRuntime({
    storage,
    capabilityRuntime,
    dagRuntime: capabilityDagRuntime,
    executors: {
      browserAction: async ({ session, operation, evalRunId, dagRunId, dagNodeId }) => {
        const input = operation.kind === "browser_action" ? operation.input : {};
        const actionSessionId = typeof input.actionSessionId === "string" && input.actionSessionId.trim()
          ? input.actionSessionId.trim()
          : `computer-session-browser-action:${session.sessionId}`;
        if (!browserActions.get(actionSessionId)) {
          browserActions.start({
            id: actionSessionId,
            sessionId: session.sessionId,
            mode: input.mode === "read_only" || input.mode === "ask_before_action" || input.mode === "auto_safe_actions" || input.mode === "full_control_dev"
              ? input.mode
              : "auto_safe_actions",
            source: input.source && typeof input.source === "object" ? input.source as never : undefined
          });
        }
        const adapterId = typeof input.adapterId === "string" ? input.adapterId : undefined;
        if (adapterId && adapterId !== "extension") {
          const observed = await browserActions.observeViaAdapter({
            actionSessionId,
            adapterId,
            providerState: input.source && typeof input.source === "object" ? input.source : undefined
          });
          recordBrowserActionAudit(storage, observed.audit);
        }
        const execution = await browserActions.execute({
          actionSessionId,
          action: applyComputerSessionPermissionModeToBrowserAction(
            storage,
            session.profileId,
            readComputerSessionBrowserAction(input.action)
          ),
          snapshot: providers.getDomSnapshot(),
          adapterId,
          approved: false,
          targetHint: typeof input.targetHint === "string" ? input.targetHint : undefined,
          policies: storage.readBrowserActionPolicies()
        });
        recordBrowserActionAudit(storage, execution.audit);
        if (execution.approval) {
          const job = recordBrowserActionCapabilityApproval({
            storage,
            clients,
            requestId: typeof input.requestId === "string" ? input.requestId : execution.approval.id,
            actionSessionId,
            sessionId: session.sessionId,
            evalRunId,
            dagRunId,
            dagNodeId,
            action: execution.approval.action,
            result: execution.result,
            approvalId: execution.approval.id
          });
          broadcast(clients, {
            type: "interaction.required",
            interaction: {
              id: execution.approval.id,
              requestId: typeof input.requestId === "string" ? input.requestId : undefined,
              kind: "approval",
              title: "Browser action approval",
              body: buildBrowserActionApprovalBody(execution.result),
              action: `Browser action: ${execution.result.safety.actionLabel}`
            }
          });
          broadcast(clients, {
            type: "browserAction.progress",
            actionSessionId,
            status: "approval_required",
            detail: summarizeBrowserActionResult(execution.result)
          });
          broadcastLedgerSnapshot(clients, storage, session.sessionId);
          return {
            status: "awaiting_approval",
            capabilityJob: job,
            output: summarizeBrowserActionResult(execution.result),
            summary: "Browser Action operation requires approval."
          };
        }
        if (execution.command) {
          const job = recordBrowserActionCapabilityCommandQueued({
            storage,
            clients,
            command: execution.command,
            sessionId: session.sessionId,
            evalRunId,
            dagRunId,
            dagNodeId,
            result: execution.result
          });
          broadcast(clients, {
            type: "browserAction.progress",
            actionSessionId,
            status: "queued",
            detail: { requestId: execution.command.requestId, action: execution.command.action.type }
          });
          broadcastLedgerSnapshot(clients, storage, session.sessionId);
          return {
            status: "running",
            capabilityJob: job,
            output: {
              result: summarizeBrowserActionResult(execution.result),
              command: {
                requestId: execution.command.requestId,
                resultId: execution.command.resultId,
                action: execution.command.action.type
              }
            },
            summary: "Browser Action operation queued for Browser Bridge execution."
          };
        }
        const job = recordBrowserActionCapabilityResult({
          storage,
          clients,
          result: execution.result,
          requestId: typeof input.requestId === "string" ? input.requestId : undefined,
          sessionId: session.sessionId,
          evalRunId,
          dagRunId,
          dagNodeId
        });
        computerSessionRuntime.recordBrowserActionResultObservation({
          result: execution.result,
          capabilityJobId: job.id,
          dagNodeId
        });
        broadcast(clients, {
          type: "browserAction.result",
          actionSessionId,
          result: summarizeBrowserActionResult(execution.result)
        });
        broadcastLedgerSnapshot(clients, storage, session.sessionId);
        return {
          status: execution.result.status === "succeeded" ? "completed" : execution.result.status === "cancelled" ? "cancelled" : "failed",
          capabilityJob: job,
          output: summarizeBrowserActionResult(execution.result),
          summary: `Browser Action operation ${execution.result.status}.`,
          error: execution.result.error
        };
      }
    },
    emit: (event) => broadcast(clients, event)
  });
  const semanticClarifications = new Map<string, PendingSemanticClarification>();
  const browserActionCommandWaiters = new Map<string, BrowserActionCommandWaiter>();
  const requestSessions = new Map<string, string>();
  const agentSession: AgentSessionState = {};
  const unsubscribeTerminalOutput = subscribeTerminalSessionOutput((chunk) => {
    broadcast(clients, { type: "terminal.output", id: "terminal-session", chunk });
  });
  const onAuthChanged = () => {
    broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    syncCodexAppServer(auth, codexAppServer);
  };
  registerDaemonCapabilities({
    capabilityRuntime,
    browserChromeCommands,
    getDaemonPort: () => (serverRef ? getServerPort(serverRef) : 0)
  });
  const server = createServer((request, response) => {
    void handleHttpRequest(request, response, auth, onAuthChanged, providers, browserPerception, browserActions, browserChromeCommands, browserExtensionBridge, clients, storage, capabilityRuntime, computerSessionRuntime, semanticMemory, browserActionCommandWaiters, localAuth);
  });
  serverRef = server;
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const authDecision = localAuth.authorizeWebSocketUpgrade(request);
    if (!authDecision.ok) {
      rejectWebSocketUpgrade(socket, authDecision.status, authDecision.error, authDecision.code);
      return;
    }
    const bridgeDecision = browserExtensionBridge.authorizeExtensionRequest({
      requestOrigin: readRequestOrigin(request),
      requireTrusted: true
    });
    if (!bridgeDecision.ok) {
      rejectWebSocketUpgrade(socket, bridgeDecision.status, bridgeDecision.error, bridgeDecision.code);
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request);
    });
  });

  wss.on("connection", (socket, request) => {
    handleWebSocketConnection({
      socket,
      requestOrigin: readRequestOrigin(request),
      serverPort: getServerPort(server),
      startedAt,
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
      browserPerception,
      visionContext,
      capabilityRuntime,
      browserActions,
      browserChromeCommands,
      browserExtensionBridge,
      semanticMemory,
      semanticClarifications,
      browserActionCommandWaiters
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
  capabilityRuntime.reconcileStartup();
  syncCodexAppServer(auth, codexAppServer);
  const runtimeStatusTimer = setInterval(() => {
    broadcast(clients, { type: "runtime.status", status: readRuntimeStatus(startedAt, clients, controllers, codexAppServer, storage) });
  }, 5_000);

  return {
    port: getServerPort(server),
    close: async () => {
      clearInterval(runtimeStatusTimer);
      await capabilityRuntime.shutdown();
      browserChromeCommands.cancelAll("daemon_shutdown");
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
        try {
          storage.close();
        } finally {
          clearBrowserActionCommandWaiters(browserActionCommandWaiters);
          semanticMemory.close();
        }
      }
    }
  };
}

function rejectWebSocketUpgrade(socket: Duplex, status: number, error: string, code: string): void {
  const body = JSON.stringify({ ok: false, error, code });
  socket.write([
    `HTTP/1.1 ${status} ${error}`,
    "Connection: close",
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body
  ].join("\r\n"));
  socket.destroy();
}

function readRequestOrigin(request: IncomingMessage): string | undefined {
  const value = request.headers.origin;
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function readComputerSessionBrowserAction(input: unknown): BrowserAction {
  return input && typeof input === "object" && typeof (input as Record<string, unknown>).type === "string"
    ? input as BrowserAction
    : { type: "read", reason: "Computer Session Browser Action operation did not include an action payload." };
}

function applyComputerSessionPermissionModeToBrowserAction(
  storage: ReturnType<typeof createStorageService>,
  profileId: string | undefined,
  action: BrowserAction
): BrowserAction {
  const safeAction = applyEvaluateCredentialAccess(action, false);
  if (safeAction.type !== "evaluate") {
    return safeAction;
  }
  const profile = profileId ? storage.readAutonomyPermissionProfile(profileId) : null;
  const modeCapabilities = readAutonomyPermissionModeCapabilities(profile);
  return modeCapabilities.credentialCookieCaptchaUnlocked
    ? applyEvaluateCredentialAccess(safeAction, true)
    : safeAction;
}
