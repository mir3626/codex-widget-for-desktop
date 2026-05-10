import type { ServerEvent } from "../../../shared/protocol.js";
import type { WidgetServerEventDeps } from "../serverEventTypes";

export function handleRuntimeServerEvent(event: ServerEvent, deps: WidgetServerEventDeps): boolean {
  if (event.type === "execution.permissions") {
    deps.setExecutionPermissions(event.permissions);
    return true;
  }

  if (event.type === "execution.permission.applied") {
    deps.appendLog(`${event.decision === "allow" ? "allowed" : "denied"} ${event.action}`, "tool");
    return true;
  }

  if (event.type === "approval.required") {
    deps.appendLog(event.action, "tool");
    return true;
  }

  if (event.type === "runtime.status") {
    deps.setRuntimeStatus(event.status);
    return true;
  }

  if (event.type === "error") {
    if (event.id) {
      deps.markAssistantMessage(event.id, "error");
      if (deps.terminalRequestIdsRef.current.has(event.id)) {
        deps.appendTerminalLine("error", event.message);
        deps.terminalRequestIdsRef.current.delete(event.id);
        deps.terminalOutputRequestIdsRef.current.delete(event.id);
      }
      deps.setActiveId(null);
    }
    deps.appendLog(event.message, "error");
    return true;
  }

  return false;
}
