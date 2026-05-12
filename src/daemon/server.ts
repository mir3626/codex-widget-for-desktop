import { createServer, type Server } from "node:http";
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
import { readRuntimeStatus } from "./server/runtimeStatus.js";
import {
  type PendingSemanticClarification
} from "./server/browser-action/clarification.js";
import { handleHttpRequest } from "./server/http/routes.js";
import { syncCodexAppServer } from "./server/runtime/codexAppServerThread.js";
import { handleWebSocketConnection } from "./server/ws/connection.js";

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
  const capabilityRuntime = new CapabilityRuntime({
    storage,
    emit: (event) => broadcast(clients, mapCapabilityRuntimeEvent(event))
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
    void handleHttpRequest(request, response, auth, onAuthChanged, providers, browserPerception, browserActions, browserChromeCommands, browserExtensionBridge, clients, storage, capabilityRuntime, semanticMemory, browserActionCommandWaiters);
  });
  serverRef = server;
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    handleWebSocketConnection({
      socket,
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
