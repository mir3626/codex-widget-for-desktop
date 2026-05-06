import { CSSProperties, useLayoutEffect, useRef, useState } from "react";

export type FloatingPlacement =
  | "top"
  | "bottom"
  | "top-start"
  | "top-end"
  | "bottom-start"
  | "bottom-end";

type FloatingLayout = {
  left: number;
  top: number;
  placement: FloatingPlacement;
  transformOrigin: string;
};

type FloatingSurfaceOptions = {
  preferred?: FloatingPlacement;
  offset?: number;
  margin?: number;
};

export type FloatingSurfaceStyle = CSSProperties & {
  "--floating-origin"?: string;
};

export function useFloatingSurface<T extends HTMLElement>(
  open: boolean,
  anchorRef: { current: T | null },
  options: FloatingSurfaceOptions = {}
) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<FloatingLayout | null>(null);
  const preferred = options.preferred ?? "bottom-end";
  const offset = options.offset ?? 6;
  const margin = options.margin ?? 8;

  useLayoutEffect(() => {
    if (!open) {
      setLayout(null);
      return;
    }

    let frameId = 0;
    const update = () => {
      const anchor = anchorRef.current;
      const surface = surfaceRef.current;
      if (!anchor || !surface) {
        return;
      }
      const next = calculateFloatingLayout(anchor.getBoundingClientRect(), surface.getBoundingClientRect(), {
        preferred,
        offset,
        margin
      });
      setLayout((current) =>
        current &&
        current.left === next.left &&
        current.top === next.top &&
        current.placement === next.placement &&
        current.transformOrigin === next.transformOrigin
          ? current
          : next
      );
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(update);
    };

    update();
    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleUpdate);
    };
  }, [anchorRef, margin, offset, open, preferred]);

  const style: FloatingSurfaceStyle = layout
    ? {
        position: "fixed",
        left: layout.left,
        top: layout.top,
        "--floating-origin": layout.transformOrigin
      }
    : {
        position: "fixed",
        left: -10_000,
        top: -10_000,
        visibility: "hidden"
      };

  return {
    surfaceRef,
    floatingStyle: style,
    placement: layout?.placement ?? preferred
  };
}

function calculateFloatingLayout(
  anchor: DOMRect,
  surface: DOMRect,
  options: Required<FloatingSurfaceOptions>
): FloatingLayout {
  const placements = readFloatingFallbacks(options.preferred);
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const viewportLeft = window.visualViewport?.offsetLeft ?? 0;
  const viewportTop = window.visualViewport?.offsetTop ?? 0;
  const bounds = {
    left: viewportLeft + options.margin,
    top: viewportTop + options.margin,
    right: viewportLeft + viewportWidth - options.margin,
    bottom: viewportTop + viewportHeight - options.margin
  };

  const candidates = placements.map((placement) => ({
    placement,
    ...readFloatingCoordinates(anchor, surface, placement, options.offset)
  }));
  const candidate =
    candidates.find(
      (item) =>
        item.left >= bounds.left &&
        item.top >= bounds.top &&
        item.left + surface.width <= bounds.right &&
        item.top + surface.height <= bounds.bottom
    ) ?? candidates[0];
  const maxLeft = Math.max(bounds.left, bounds.right - surface.width);
  const maxTop = Math.max(bounds.top, bounds.bottom - surface.height);
  const left = Math.round(Math.min(Math.max(bounds.left, candidate.left), maxLeft));
  const top = Math.round(Math.min(Math.max(bounds.top, candidate.top), maxTop));
  return {
    left,
    top,
    placement: candidate.placement,
    transformOrigin: readFloatingTransformOrigin(candidate.placement)
  };
}

function readFloatingFallbacks(preferred: FloatingPlacement): FloatingPlacement[] {
  const vertical = preferred.startsWith("top") ? ["top", "bottom"] : ["bottom", "top"];
  const align = preferred.endsWith("start") ? "start" : preferred.endsWith("end") ? "end" : "center";
  const alternateAligns =
    align === "end" ? ["end", "start", "center"] : align === "start" ? ["start", "end", "center"] : ["center", "end", "start"];
  const placements: FloatingPlacement[] = [];
  for (const side of vertical) {
    for (const nextAlign of alternateAligns) {
      placements.push(nextAlign === "center" ? (side as FloatingPlacement) : (`${side}-${nextAlign}` as FloatingPlacement));
    }
  }
  return Array.from(new Set([preferred, ...placements]));
}

function readFloatingCoordinates(anchor: DOMRect, surface: DOMRect, placement: FloatingPlacement, offset: number) {
  const side = placement.startsWith("top") ? "top" : "bottom";
  const align = placement.endsWith("start") ? "start" : placement.endsWith("end") ? "end" : "center";
  const top = side === "top" ? anchor.top - surface.height - offset : anchor.bottom + offset;
  let left = anchor.left + anchor.width / 2 - surface.width / 2;
  if (align === "start") {
    left = anchor.left;
  } else if (align === "end") {
    left = anchor.right - surface.width;
  }
  return { left, top };
}

function readFloatingTransformOrigin(placement: FloatingPlacement): string {
  const y = placement.startsWith("top") ? "bottom" : "top";
  const x = placement.endsWith("start") ? "left" : placement.endsWith("end") ? "right" : "center";
  return `${x} ${y}`;
}
