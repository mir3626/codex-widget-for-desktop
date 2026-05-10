import {
  describeToolItem,
  readRecord,
  readTurnError
} from "./messageReaders.js";
import type {
  ActiveTurn,
  AppServerNotification,
  JsonRpcMessage
} from "./types.js";

export function handleAppServerNotification(input: {
  active: ActiveTurn | undefined;
  message: AppServerNotification;
  emitFileChangeArtifact: (phase: "before" | "after", message: Pick<JsonRpcMessage, "method" | "params">) => void;
}): void {
  const { active, message, emitFileChangeArtifact } = input;

  if (message.method === "item/agentMessage/delta" && active) {
    const params = readRecord(message.params);
    if (params?.turnId !== active.turnId || typeof params.delta !== "string") {
      return;
    }
    active.fullText += params.delta;
    active.emit({ type: "message.delta", id: active.widgetRequestId, text: params.delta });
    return;
  }

  if (message.method === "turn/completed" && active) {
    const params = readRecord(message.params);
    const turn = readRecord(params?.turn);
    if (turn?.id !== active.turnId) {
      return;
    }

    const status = typeof turn.status === "string" ? turn.status : "completed";
    const fullText = active.fullText;
    const emit = active.emit;
    const requestId = active.widgetRequestId;
    const resolve = active.resolve;
    const reject = active.reject;
    active.cleanup();

    if (status === "failed") {
      reject(new Error(readTurnError(turn.error) ?? "Codex app-server turn failed."));
      return;
    }
    if (status === "interrupted") {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    emit({ type: "message.completed", id: requestId, text: fullText });
    emit({ type: "session.state", state: "idle", id: requestId });
    resolve();
    return;
  }

  if (!active) {
    return;
  }

  if (message.method === "item/started") {
    const item = readRecord(readRecord(message.params)?.item);
    const tool = describeToolItem(item);
    if (tool) {
      active.emit({ type: "tool.started", id: active.widgetRequestId, tool: tool.name, label: tool.label });
    }
    return;
  }

  if (message.method === "item/completed") {
    const item = readRecord(readRecord(message.params)?.item);
    const tool = describeToolItem(item);
    if (tool) {
      active.emit({ type: "tool.completed", id: active.widgetRequestId, tool: tool.name });
    }
    if (item?.type === "fileChange") {
      emitFileChangeArtifact("after", { method: message.method, params: { item } });
    }
    return;
  }

  if (
    message.method === "item/commandExecution/outputDelta" ||
    message.method === "item/fileChange/outputDelta" ||
    message.method === "item/mcpToolCall/progress"
  ) {
    const params = readRecord(message.params);
    const chunk =
      typeof params?.delta === "string"
        ? params.delta
        : typeof params?.message === "string"
          ? params.message
          : "";
    if (chunk) {
      active.emit({ type: "tool.output", id: active.widgetRequestId, tool: message.method, chunk });
    }
  }
}
