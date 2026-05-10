import type { ClientMessage } from "../../../shared/protocol.js";
import { send, retainAndBroadcast } from "../events.js";
import { sendLedgerSnapshot, publishSessionMutation } from "../clientEvents.js";
import { openPathWithSystem } from "../systemOpen.js";
import { resetRuntimeSession } from "../runtime/sessionReset.js";
import type { MessageRouterContext } from "./context.js";

export async function handleSessionMessage(message: ClientMessage, context: MessageRouterContext): Promise<boolean> {
  const { socket, controllers, retainedMessages, clients, requestSessions, storage, agentSession, codexAppServer } = context;

  if (message.type === "cancel") {
    const sessionId = requestSessions.get(message.id);
    controllers.get(message.id)?.abort();
    controllers.delete(message.id);
    if (sessionId) {
      storage.updateAssistantMessage({ sessionId, messageId: message.id, status: "cancelled" });
      requestSessions.delete(message.id);
    }
    retainAndBroadcast(clients, retainedMessages, { type: "session.state", state: "cancelled", id: message.id });
    return true;
  }

  if (message.type === "session.reset") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.createSession(), { reset: true });
    return true;
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
    return true;
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
    return true;
  }

  if (message.type === "session.open") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.openSession(message.sessionId));
    return true;
  }

  if (message.type === "session.trash") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.trashSession(message.sessionId));
    return true;
  }

  if (message.type === "session.discard") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.discardSession(message.sessionId));
    return true;
  }

  if (message.type === "session.delete") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.deleteSession(message.sessionId));
    return true;
  }

  if (message.type === "session.restore") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    publishSessionMutation(socket, clients, storage, () => storage.restoreSession(message.sessionId));
    return true;
  }

  if (message.type === "ledger.refresh") {
    sendLedgerSnapshot(socket, storage, message.sessionId);
    return true;
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
    return true;
  }

  return false;
}
