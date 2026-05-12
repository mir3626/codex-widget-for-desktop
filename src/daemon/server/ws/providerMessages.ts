import type { ClientMessage } from "../../../shared/protocol.js";
import {
  captureScreenFromHelper,
  readVisionGuardrails
} from "../visionContextServerHelpers.js";
import { broadcastLedgerSnapshot } from "../clientEvents.js";
import { broadcast, send } from "../events.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import { resolveClientSessionId, resolveStreamSessionId } from "../runtime/sessionIds.js";
import type { MessageRouterContext } from "./context.js";

const MAX_VISION_RECORDING_DATA_URL_CHARS = 16 * 1024 * 1024;

export async function handleProviderMessage(message: ClientMessage, context: MessageRouterContext): Promise<boolean> {
  const { socket, clients, storage, daemonPort, capabilityRuntime } = context;

  if (message.type === "provider.captureScreen") {
    void captureScreenFromHelper(message.description, message.crop, clients, daemonPort, capabilityRuntime);
    return true;
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
        client: typeof message.detail === "object" && message.detail !== null ? message.detail as Record<string, unknown> : {}
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }

  return false;
}
