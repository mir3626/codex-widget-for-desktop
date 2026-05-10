import type { ServerEvent } from "../../../shared/protocol.js";
import type { WidgetServerEventDeps } from "../serverEventTypes";

export function handleBrowserActionServerEvent(event: ServerEvent, deps: WidgetServerEventDeps): boolean {
  if (event.type === "browserAction.started") {
    deps.setBrowserAction((current) => ({
      ...current,
      actionSessionId: event.actionSessionId,
      progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: "started", detail: event.summary }],
      error: null
    }));
    deps.appendLog("Browser Action started", "tool");
    return true;
  }

  if (event.type === "browserAction.observation") {
    deps.setBrowserAction((current) => ({
      ...current,
      actionSessionId: event.actionSessionId,
      observationSummary: event.observationSummary,
      progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: "observed", detail: event.observationSummary }],
      error: null
    }));
    deps.appendLog("Browser Action observation ready", "tool");
    return true;
  }

  if (event.type === "browserAction.progress") {
    deps.setBrowserAction((current) => ({
      ...current,
      actionSessionId: event.actionSessionId,
      progress: [...current.progress.slice(-7), { id: crypto.randomUUID(), status: event.status, detail: event.detail }],
      error: null
    }));
    deps.appendLog(`Browser Action ${event.status}`, "tool");
    return true;
  }

  if (event.type === "browserAction.adapters") {
    const ready = event.adapters.filter((adapter) => adapter.state === "ready").map((adapter) => adapter.id).join(", ") || "none";
    deps.setBrowserAction((current) => ({
      ...current,
      actionSessionId: event.actionSessionId ?? current.actionSessionId,
      adapters: event.adapters,
      progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: "adapters", detail: { ready } }],
      error: null
    }));
    deps.appendLog(`Browser Action adapters ready: ${ready}`, "tool");
    return true;
  }

  if (event.type === "browserExtensionBridge.status") {
    deps.setBrowserAction((current) => ({
      ...current,
      bridgeStatus: event.status
    }));
    if (event.status.mode === "permission_needed") {
      deps.appendLog("Browser Bridge needs site permission", "tool");
    } else if (event.status.mode === "disconnected") {
      deps.appendLog("Browser Bridge disconnected", "muted");
    } else if (event.status.mode === "restricted" || event.status.mode === "error") {
      deps.appendLog(event.status.lastError ?? "Browser Bridge unavailable", "error");
    }
    return true;
  }

  if (event.type === "browserAction.plan") {
    deps.setBrowserAction((current) => ({
      ...current,
      actionSessionId: event.actionSessionId,
      planSummary: event.plan,
      progress: [...current.progress.slice(-7), { id: crypto.randomUUID(), status: "plan", detail: event.plan }],
      error: null
    }));
    deps.appendLog("Browser Action plan updated", "tool");
    return true;
  }

  if (event.type === "browserAction.policies") {
    deps.setBrowserAction((current) => ({
      ...current,
      policies: event.policies
    }));
    return true;
  }

  if (event.type === "browserAction.result") {
    deps.setBrowserAction((current) => ({
      ...current,
      actionSessionId: event.actionSessionId,
      resultSummary: event.result,
      progress: [...current.progress.slice(-7), { id: crypto.randomUUID(), status: "result", detail: event.result }],
      error: null
    }));
    deps.appendLog("Browser Action result ready", "tool");
    return true;
  }

  if (event.type === "browserAction.error") {
    deps.setBrowserAction((current) => ({
      ...current,
      actionSessionId: event.actionSessionId || current.actionSessionId,
      error: event.error,
      progress: [...current.progress.slice(-7), { id: crypto.randomUUID(), status: "error", detail: event.error }]
    }));
    deps.appendLog(event.error, "error");
    return true;
  }

  return false;
}
