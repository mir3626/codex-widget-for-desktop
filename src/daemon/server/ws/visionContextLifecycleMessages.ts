import type { ClientMessage } from "../../../shared/protocol.js";
import {
  summarizeCaptureSession,
  type VisionContextStartInput
} from "../../vision-context/index.js";
import { broadcastLedgerSnapshot } from "../clientEvents.js";
import { broadcast, send } from "../events.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import { resolveClientSessionId, resolveStreamSessionId } from "../runtime/sessionIds.js";
import { normalizeVisionContextEvent } from "../visionContextServerHelpers.js";
import type { MessageRouterContext } from "./context.js";

export async function handleVisionContextLifecycleMessage(
  message: ClientMessage,
  context: MessageRouterContext
): Promise<boolean> {
  const { socket, clients, storage, visionContext } = context;

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
    return true;
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
    return true;
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
    return true;
  }

  return false;
}
