import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFloatingSurface } from "../hooks/useFloatingSurface";

export function FloatingTooltipRoot() {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string } | null>(null);
  const floating = useFloatingSurface(Boolean(tooltip), anchorRef, { preferred: "top", offset: 7, margin: 6 });

  useEffect(() => {
    function showTooltip(event: Event) {
      const target = readTooltipTarget(event.target);
      if (!target) {
        return;
      }
      const text = target.getAttribute("data-tooltip");
      if (!text) {
        return;
      }
      anchorRef.current = target;
      setTooltip({ text });
    }

    function hideTooltip(event: Event) {
      const current = anchorRef.current;
      const relatedTarget = (event as MouseEvent | FocusEvent).relatedTarget;
      if (current && relatedTarget instanceof Node && current.contains(relatedTarget)) {
        return;
      }
      anchorRef.current = null;
      setTooltip(null);
    }

    document.addEventListener("pointerover", showTooltip, true);
    document.addEventListener("focusin", showTooltip, true);
    document.addEventListener("pointerout", hideTooltip, true);
    document.addEventListener("focusout", hideTooltip, true);
    return () => {
      document.removeEventListener("pointerover", showTooltip, true);
      document.removeEventListener("focusin", showTooltip, true);
      document.removeEventListener("pointerout", hideTooltip, true);
      document.removeEventListener("focusout", hideTooltip, true);
    };
  }, []);

  if (!tooltip) {
    return null;
  }

  return createPortal(
    <div
      ref={floating.surfaceRef}
      className={`floating-tooltip placement-${floating.placement}`}
      style={floating.floatingStyle}
      role="tooltip"
    >
      {tooltip.text}
    </div>,
    document.body
  );
}

function readTooltipTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const tooltipTarget = target.closest("[data-tooltip]");
  if (!(tooltipTarget instanceof HTMLElement)) {
    return null;
  }
  if (tooltipTarget instanceof HTMLButtonElement && tooltipTarget.disabled) {
    return null;
  }
  return tooltipTarget;
}
