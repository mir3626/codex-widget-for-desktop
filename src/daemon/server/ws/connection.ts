import type { WebSocket } from "ws";
import { daemonInfo, type AgentSessionState } from "../../agent.js";
import type { CodexAppServerBridge } from "../../codexAppServer.js";
import type { OAuthSession } from "../../oauth.js";
import type { BrowserActionSessionManager } from "../../browser-action/index.js";
import type { ProviderRegistry } from "../../providers/providerRegistry.js";
import type { SemanticMemoryStore } from "../../semantic-interface/index.js";
import type { StorageService } from "../../storage/storage.js";
import { getProviderStatuses } from "../../tools.js";
import type { VisionContextSessionManager } from "../../vision-context/index.js";
import type { BrowserActionCommandWaiter } from "../browser-action/commandWaiters.js";
import type { PendingSemanticClarification } from "../browser-action/clarification.js";
import type { BrowserExtensionBridgeStore } from "../browser-bridge/store.js";
import {
  sendBrowserActionPolicies,
  sendExecutionPermissions,
  sendLedgerSnapshot,
  sendSessionSnapshot
} from "../clientEvents.js";
import { replayRetainedMessages, send, type RetainedMessage } from "../events.js";
import { readRuntimeStatus } from "../runtimeStatus.js";
import { handleMessage } from "./messageRouter.js";

export function handleWebSocketConnection(input: {
  socket: WebSocket;
  serverPort: number;
  startedAt: number;
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
  visionContext: VisionContextSessionManager;
  browserActions: BrowserActionSessionManager;
  browserExtensionBridge: BrowserExtensionBridgeStore;
  semanticMemory: SemanticMemoryStore;
  semanticClarifications: Map<string, PendingSemanticClarification>;
  browserActionCommandWaiters: Map<string, BrowserActionCommandWaiter>;
}): void {
  const {
    socket,
    clients,
    auth,
    providers,
    startedAt,
    controllers,
    codexAppServer,
    storage,
    browserExtensionBridge,
    retainedMessages
  } = input;

  clients.add(socket);
  send(socket, { type: "connected", daemon: daemonInfo(input.serverPort, auth.getStatus()) });
  send(socket, { type: "auth.status", auth: auth.getStatus() });
  send(socket, { type: "provider.status", providers: getProviderStatuses(providers) });
  send(socket, { type: "runtime.status", status: readRuntimeStatus(startedAt, clients, controllers, codexAppServer, storage) });
  send(socket, { type: "browserExtensionBridge.status", status: browserExtensionBridge.snapshot() });
  sendExecutionPermissions(socket, storage);
  sendBrowserActionPolicies(socket, storage);
  sendSessionSnapshot(socket, storage);
  sendLedgerSnapshot(socket, storage);
  send(socket, { type: "session.state", state: "idle" });
  replayRetainedMessages(socket, retainedMessages);

  socket.on("message", (raw) => {
    void handleMessage(raw.toString(), {
      socket,
      controllers: input.controllers,
      retainedMessages,
      toolOutputBuffers: input.toolOutputBuffers,
      auth,
      clients,
      requestSessions: input.requestSessions,
      storage,
      agentSession: input.agentSession,
      codexAppServer,
      providers,
      visionContext: input.visionContext,
      browserActions: input.browserActions,
      browserExtensionBridge,
      semanticMemory: input.semanticMemory,
      semanticClarifications: input.semanticClarifications,
      browserActionCommandWaiters: input.browserActionCommandWaiters,
      daemonPort: input.serverPort
    });
  });

  socket.on("close", () => {
    clients.delete(socket);
  });
}
