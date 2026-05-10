import type { ServerEvent } from "../../shared/protocol.js";
import { handleAuthServerEvent } from "./events/authEvents";
import { handleBrowserActionServerEvent } from "./events/browserActionEvents";
import { handleProviderServerEvent } from "./events/providerEvents";
import { handleRuntimeServerEvent } from "./events/runtimeEvents";
import { handleSessionServerEvent } from "./events/sessionEvents";
import type { WidgetServerEventDeps } from "./serverEventTypes";

export function handleWidgetServerEvent(event: ServerEvent, deps: WidgetServerEventDeps) {
  if (handleAuthServerEvent(event, deps)) {
    return;
  }
  if (handleSessionServerEvent(event, deps)) {
    return;
  }
  if (handleProviderServerEvent(event, deps)) {
    return;
  }
  if (handleBrowserActionServerEvent(event, deps)) {
    return;
  }
  handleRuntimeServerEvent(event, deps);
}
