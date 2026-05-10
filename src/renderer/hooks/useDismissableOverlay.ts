import { useEffect } from "react";

type UseDismissableOverlayInput = {
  open: boolean;
  safeSelector: string;
  onDismiss(): void;
};

export function useDismissableOverlay({
  open,
  safeSelector,
  onDismiss
}: UseDismissableOverlayInput) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function dismissFromOutside(event: MouseEvent | globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(safeSelector)) {
        return;
      }
      onDismiss();
    }

    function dismissFromEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onDismiss();
      }
    }

    document.addEventListener("pointerdown", dismissFromOutside, true);
    document.addEventListener("keydown", dismissFromEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissFromOutside, true);
      document.removeEventListener("keydown", dismissFromEscape);
    };
  }, [open, safeSelector, onDismiss]);
}
