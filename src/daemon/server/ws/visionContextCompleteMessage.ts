import type { ClientMessage } from "../../../shared/protocol.js";
import {
  buildAppServerUserInput,
  collectAdapterObservations,
  renderVisibleUserMessage,
  type CaptureEvent
} from "../../vision-context/index.js";
import { runAskMessage } from "../ask/runAskMessage.js";
import { broadcastLedgerSnapshot } from "../clientEvents.js";
import { broadcast, send } from "../events.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import { resolveClientSessionId } from "../runtime/sessionIds.js";
import { readVisionContextTimeRange } from "../visionContextServerHelpers.js";
import type { MessageRouterContext } from "./context.js";

export async function handleVisionContextCompleteMessage(
  message: ClientMessage,
  context: MessageRouterContext
): Promise<boolean> {
  if (message.type !== "visionContext.stop") {
    return false;
  }

  const {
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
    browserPerception,
    visionContext,
    browserActions,
    browserChromeCommands,
    browserExtensionBridge,
    semanticClarifications,
    browserActionCommandWaiters
  } = context;

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
        providers,
        browserPerception,
        browserActions,
        browserChromeCommands,
        browserExtensionBridge,
        semanticClarifications,
        browserActionCommandWaiters
      });
    }
  } catch (error) {
    send(socket, {
      type: "visionContext.error",
      captureId: message.captureId,
      error: error instanceof Error ? error.message : "Unable to complete Vision Context session."
    });
  }
  return true;
}
