import type { ServerEvent } from "../../../shared/protocol.js";
import {
  isTerminalToolEvent,
  terminalToolLabel
} from "../../utils/terminal";
import type { WidgetServerEventDeps } from "../serverEventTypes";

export function handleSessionServerEvent(event: ServerEvent, deps: WidgetServerEventDeps): boolean {
  if (event.type === "session.snapshot") {
    deps.applySessionSnapshot(event.snapshot);
    return true;
  }

  if (event.type === "ledger.snapshot") {
    if (
      deps.trashArtifactSessionIdRef.current &&
      event.snapshot.sessionId === deps.trashArtifactSessionIdRef.current &&
      event.snapshot.sessionId !== deps.activeSessionIdRef.current
    ) {
      deps.setTrashLedger(event.snapshot);
      return true;
    }
    deps.setLedger(event.snapshot);
    return true;
  }

  if (event.type === "artifact.fileChange") {
    deps.appendLog(`${event.title} ${event.phase}`, "tool");
    return true;
  }

  if (event.type === "session.state") {
    deps.setStatus(event.state);
    if (event.state === "idle") {
      deps.setActiveId(null);
    } else if (event.state === "cancelled") {
      deps.setActiveId(null);
      if (event.id) {
        deps.markAssistantMessage(event.id, "cancelled");
        if (deps.terminalRequestIdsRef.current.has(event.id)) {
          deps.appendTerminalLine("system", "terminal request cancelled");
          deps.terminalRequestIdsRef.current.delete(event.id);
          deps.terminalOutputRequestIdsRef.current.delete(event.id);
        }
      }
    } else if (event.state === "error") {
      deps.setActiveId(null);
      if (event.id) {
        deps.markAssistantMessage(event.id, "error");
        if (deps.terminalRequestIdsRef.current.has(event.id)) {
          deps.appendTerminalLine("error", "terminal request failed");
          deps.terminalRequestIdsRef.current.delete(event.id);
          deps.terminalOutputRequestIdsRef.current.delete(event.id);
        }
      }
    } else if (event.id) {
      deps.markAssistantMessage(event.id, event.state === "tooling" ? "tooling" : event.state === "thinking" ? "thinking" : "streaming");
    }
    return true;
  }

  if (event.type === "message.delta") {
    deps.appendAssistantDelta(event.id, event.text);
    return true;
  }

  if (event.type === "message.completed") {
    deps.completeAssistantMessage(event.id, event.text);
    deps.completeTerminalRequest(event.id, event.text);
    deps.setActiveId(null);
    return true;
  }

  if (event.type === "message.snapshot") {
    deps.applyAssistantSnapshot(event.id, event.text, event.status);
    return true;
  }

  if (event.type === "tool.started") {
    deps.markAssistantMessage(event.id, "tooling");
    if (isTerminalToolEvent(event.tool)) {
      deps.registerTerminalRequest(event.id, event.label, false);
      deps.appendTerminalLine("system", `${terminalToolLabel(event.tool)} started`);
    }
    deps.appendLog(`${event.label}`, "tool");
    return true;
  }

  if (event.type === "tool.output") {
    if (isTerminalToolEvent(event.tool) || deps.terminalRequestIdsRef.current.has(event.id)) {
      deps.appendTerminalOutput(event.id, event.chunk);
    }
    deps.appendLog(event.chunk, "muted");
    return true;
  }

  if (event.type === "tool.completed") {
    deps.markAssistantMessage(event.id, "streaming");
    if (isTerminalToolEvent(event.tool) || deps.terminalRequestIdsRef.current.has(event.id)) {
      deps.appendTerminalLine("system", `${terminalToolLabel(event.tool)} completed`);
    }
    deps.appendLog(`${event.tool} done`, "tool");
    return true;
  }

  if (event.type === "interaction.required") {
    deps.addInteraction(event.interaction);
    deps.appendLog(event.interaction.title, "tool");
    return true;
  }

  if (event.type === "session.reset") {
    deps.resetVisibleSession(false);
    deps.appendLog("new chat", "tool");
    return true;
  }

  if (event.type === "terminal.output") {
    deps.appendTerminalOutput(event.id, event.chunk);
    return true;
  }

  return false;
}
