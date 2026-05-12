import type { BrowserAction } from "./types.js";

const BACKGROUND_SAFE_HISTORY_ADAPTERS = new Set(["extension", "cdp", "playwright"]);

export function isTargetlessTabNavigationAction(action: BrowserAction): boolean {
  return action.type === "navigate" || action.type === "back" || action.type === "forward" || action.type === "reload";
}

export function isBackgroundSafeBrowserAdapter(adapterId: string | undefined): boolean {
  return Boolean(adapterId && BACKGROUND_SAFE_HISTORY_ADAPTERS.has(adapterId));
}

export function resolveBrowserActionExecutionAdapter(input: {
  action: BrowserAction;
  requestedAdapterId?: string;
}): string | undefined {
  if (!isTargetlessTabNavigationAction(input.action)) {
    return input.requestedAdapterId;
  }
  if (isBackgroundSafeBrowserAdapter(input.requestedAdapterId)) {
    return input.requestedAdapterId;
  }
  return "extension";
}

export function describeBrowserActionRouting(input: {
  action: BrowserAction;
  requestedAdapterId?: string;
  effectiveAdapterId?: string;
}): Record<string, unknown> {
  const targetlessNavigation = isTargetlessTabNavigationAction(input.action);
  return {
    actionType: input.action.type,
    requestedAdapterId: input.requestedAdapterId,
    effectiveAdapterId: input.effectiveAdapterId,
    targetlessNavigation,
    focusPolicy: targetlessNavigation
      ? "background_tab_control_preferred"
      : input.effectiveAdapterId === "native-desktop"
        ? "native_desktop_may_require_foreground_focus"
        : "background_dom_or_controlled_browser_preferred"
  };
}
