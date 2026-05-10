import type { ServerEvent } from "../../../shared/protocol.js";
import { openExternalUrl } from "../../shell";
import type { WidgetServerEventDeps } from "../serverEventTypes";

export function handleAuthServerEvent(event: ServerEvent, deps: WidgetServerEventDeps): boolean {
  if (event.type === "connected") {
    deps.applyAuthStatus(event.daemon.auth, { quiet: true });
    deps.setStatus(event.daemon.liveModel ? "idle" : "demo");
    deps.appendLog(event.daemon.liveModel ? `${event.daemon.model} ready` : "demo stream", "muted");
    return true;
  }

  if (event.type === "auth.status") {
    deps.applyAuthStatus(event.auth);
    return true;
  }

  if (event.type === "auth.url") {
    void openExternalUrl(event.url);
    deps.appendLog("opened sign-in", "tool");
    return true;
  }

  if (event.type === "external.url") {
    void openExternalUrl(event.url);
    deps.appendLog("opened browser", "tool");
    return true;
  }

  return false;
}
