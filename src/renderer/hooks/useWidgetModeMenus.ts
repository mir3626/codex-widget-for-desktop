import { useEffect } from "react";
import type { ClientMessage, WidgetMode } from "../../shared/protocol.js";
import { useDismissableOverlay } from "./useDismissableOverlay";

type UseWidgetModeMenusInput = {
  mode: WidgetMode;
  setMode(mode: WidgetMode): void;
  showBrowserActionMenu: boolean;
  setShowBrowserActionMenu(update: boolean | ((current: boolean) => boolean)): void;
  showVisionMenu: boolean;
  setShowVisionMenu(update: boolean | ((current: boolean) => boolean)): void;
  browserActionSessionId: string | null;
  send(message: ClientMessage): boolean;
};

export function useWidgetModeMenus(input: UseWidgetModeMenusInput) {
  useDismissableOverlay({
    open: input.showBrowserActionMenu,
    safeSelector: ".mode-row, .browser-action-menu",
    onDismiss: () => input.setShowBrowserActionMenu(false)
  });

  useEffect(() => {
    if (!input.showBrowserActionMenu) {
      return;
    }
    input.send({ type: "browserAction.adapters", actionSessionId: input.browserActionSessionId ?? undefined });
  }, [input.showBrowserActionMenu, input.browserActionSessionId, input.send]);

  useDismissableOverlay({
    open: input.showVisionMenu,
    safeSelector: ".mode-row, .vision-action-wrap, .vision-action-menu",
    onDismiss: () => input.setShowVisionMenu(false)
  });

  function selectMode(nextMode: WidgetMode) {
    if (nextMode === input.mode) {
      if (nextMode === "browser") {
        input.setShowBrowserActionMenu((current) => !current);
      }
      return;
    }

    if (nextMode === "screen") {
      input.setMode("screen");
      input.setShowVisionMenu(true);
      input.setShowBrowserActionMenu(false);
      return;
    }

    if (nextMode === "browser") {
      input.setMode("browser");
      input.setShowBrowserActionMenu(true);
      input.setShowVisionMenu(false);
      return;
    }

    input.setShowVisionMenu(false);
    input.setShowBrowserActionMenu(false);
    input.setMode(nextMode);
  }

  return { selectMode };
}
