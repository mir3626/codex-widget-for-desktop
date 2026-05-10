import type { ServerEvent } from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";
import { sessionStateToSnapshotStatus } from "./events.js";
import { recordRuntimeActivity } from "./runtimeActivity.js";
import { appendToolOutputBuffer, consumeToolOutputBuffer } from "./toolOutputBuffers.js";

export function persistRuntimeEvent(
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

function isTerminalProviderTool(tool: string): boolean {
  return tool === "terminal" || tool.startsWith("terminal:") || tool.startsWith("terminal-session:");
}

function terminalProviderLabel(tool: string): string {
  return tool.startsWith("terminal-session:") ? "PTY" : "Terminal";
}
