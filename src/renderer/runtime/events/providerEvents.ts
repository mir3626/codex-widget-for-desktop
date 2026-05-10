import type { ServerEvent } from "../../../shared/protocol.js";
import type { WidgetServerEventDeps } from "../serverEventTypes";

export function handleProviderServerEvent(event: ServerEvent, deps: WidgetServerEventDeps): boolean {
  if (event.type === "provider.status") {
    deps.setProviderStatuses(event.providers);
    return true;
  }

  if (event.type === "provider.capture") {
    deps.appendLog(event.message, event.state === "error" ? "error" : "tool");
    return true;
  }

  if (event.type === "provider.vision") {
    deps.applyVisionProviderEvent(event);
    return true;
  }

  if (event.type === "visionContext.started") {
    deps.appendLog("Vision Context started", "tool");
    return true;
  }

  if (event.type === "visionContext.progress") {
    deps.appendLog(`Vision Context ${event.status}`, "tool");
    return true;
  }

  if (event.type === "visionContext.capsule") {
    deps.appendLog("Vision Context capsule ready", "tool");
    return true;
  }

  if (event.type === "visionContext.sent") {
    deps.appendLog("Vision Context sent to Agent", "tool");
    return true;
  }

  if (event.type === "visionContext.error") {
    deps.appendLog(event.error, "error");
    return true;
  }

  return false;
}
