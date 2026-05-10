import type { WebSocket } from "ws";
import { runAgentStream, type AgentSessionState } from "../../agent.js";
import type { CodexAppServerBridge } from "../../codexAppServer.js";
import { resolveCodexExecutionContext } from "../../codexRuntime.js";
import type { OAuthSession } from "../../oauth.js";
import type { ProviderRegistry } from "../../providers/providerRegistry.js";
import type { StorageService } from "../../storage/storage.js";
import type { BrowserActionSessionManager } from "../../browser-action/index.js";
import type { ClientMessage, ServerEvent } from "../../../shared/protocol.js";
import type { BrowserExtensionBridgeStore } from "../browser-bridge/store.js";
import type { BrowserActionCommandWaiter } from "../browser-action/commandWaiters.js";
import type { PendingSemanticClarification } from "../browser-action/clarification.js";
import type { RetainedMessage } from "../events.js";
import { broadcast, retainAndBroadcast } from "../events.js";
import { broadcastLedgerSnapshot } from "../clientEvents.js";
import { persistRuntimeEvent } from "../runtimeEventPersistence.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import {
  bindCodexAppServerThread,
  persistCodexAppServerThread,
  prepareRegeneration
} from "../runtime/codexAppServerThread.js";
import { tryRunBrowserActionPrompt } from "../browser-action/promptRunner.js";

export async function runAskMessage(input: {
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
  browserActions: BrowserActionSessionManager;
  browserExtensionBridge: BrowserExtensionBridgeStore;
  semanticClarifications: Map<string, PendingSemanticClarification>;
  browserActionCommandWaiters: Map<string, BrowserActionCommandWaiter>;
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
    providers,
    browserActions,
    browserExtensionBridge,
    semanticClarifications,
    browserActionCommandWaiters
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
  const emitRuntimeEvent = (event: ServerEvent) => {
    const ledgerChanged = persistRuntimeEvent(storage, persistedAsk.sessionId, event, {
      toolOutputBuffers,
      workspaceRoot: resolveCodexExecutionContext().workdir
    });
    retainAndBroadcast(clients, retainedMessages, event);
    if (ledgerChanged) {
      broadcastLedgerSnapshot(clients, storage, persistedAsk.sessionId);
    }
  };

  try {
    const browserActionHandled = await tryRunBrowserActionPrompt({
      message,
      sessionId: persistedAsk.sessionId,
      emit: emitRuntimeEvent,
      clients,
      storage,
      providers,
      browserActions,
      browserExtensionBridge,
      semanticClarifications,
      browserActionCommandWaiters
    });
    if (browserActionHandled) {
      return;
    }
    bindCodexAppServerThread(storage, persistedAsk.sessionId, codexAppServer);
    await prepareRegeneration(message, auth, codexAppServer);
    await runAgentStream(message, emitRuntimeEvent, controller.signal, {
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
