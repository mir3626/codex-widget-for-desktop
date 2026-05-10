import type {
  BrowserAction,
  BrowserActionSession,
  BrowserActionSource,
  BrowserObservation,
  ElementTarget
} from "../types.js";

export const DIRECT_ACTION_TIMEOUT_MS = 12_000;
export const EXTENSION_COMMAND_PICKUP_TIMEOUT_MS = 90_000;

export function readActionTarget(action: BrowserAction): ElementTarget | undefined {
  return "target" in action ? action.target : undefined;
}

export function readExpectedSourceForCommand(session: BrowserActionSession, observation?: BrowserObservation): BrowserActionSource {
  return {
    ...session.source,
    url: observation?.url || session.source.url,
    title: observation?.title || session.source.title,
    tabId: observation?.source.tabId ?? session.source.tabId,
    windowId: observation?.source.windowId ?? session.source.windowId,
    viewRevision: observation?.viewGraph?.identity.viewRevision ?? session.source.viewRevision,
    routeKey: observation?.viewGraph?.identity.routeKey ?? session.source.routeKey,
    freshness: observation?.viewGraph?.identity.freshness ?? session.source.freshness
  };
}

export function shouldResolveTarget(action: BrowserAction, hint?: string): boolean {
  if (hint?.trim()) {
    return true;
  }
  return action.type === "click" ||
    action.type === "type" ||
    action.type === "select" ||
    action.type === "check" ||
    action.type === "evaluate" && Boolean(action.target) ||
    action.type === "scroll" && Boolean(action.target);
}

export function readActionTimeoutMs(action: BrowserAction): number {
  if (action.type === "evaluate" && action.timeoutMs) {
    return Math.max(1, Math.min(Math.floor(action.timeoutMs), 5_000));
  }
  return DIRECT_ACTION_TIMEOUT_MS;
}

export function readExtensionCommandPickupTimeoutMs(): number {
  return EXTENSION_COMMAND_PICKUP_TIMEOUT_MS;
}

export function isRetriableBrowserActionError(error: string | undefined): boolean {
  return /target|selector|stale|detached|not found|not visible|not editable/i.test(error ?? "");
}
