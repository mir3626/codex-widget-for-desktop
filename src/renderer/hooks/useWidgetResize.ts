import {
  PointerEvent,
  RefObject,
  useEffect,
  useRef,
  useState
} from "react";
import {
  DEFAULT_MASCOT_STAGE_HEIGHT,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  PROMPT_COMPOSER_MAX_HEIGHT,
  PROMPT_COMPOSER_MIN_CONVERSATION_HEIGHT,
  PROMPT_COMPOSER_MIN_HEIGHT,
  PROMPT_COMPOSER_RESERVED_ROWS_HEIGHT
} from "../config";
import {
  readWidgetWindowGeometry,
  setWidgetWindowFrame,
  startDragWidget,
  startResizeWidget,
  type WidgetResizeDirection
} from "../shell";
import type { PromptResizeState } from "../types";

type ResizeDragState = {
  direction: WidgetResizeDirection;
  pointerId: number;
  target: HTMLDivElement;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  minWidth: number;
  minHeight: number;
  scaleFactor: number;
  frameId: number | null;
  applying: boolean;
  queued: boolean;
  ended: boolean;
};

export function useWidgetResize(input: {
  maximized: boolean;
  conversationRef: RefObject<HTMLElement | null>;
  onToggleMaximize(): void;
}) {
  const [promptHeight, setPromptHeight] = useState(PROMPT_COMPOSER_MIN_HEIGHT);
  const promptResizeRef = useRef<PromptResizeState | null>(null);
  const resizeDragRef = useRef<ResizeDragState | null>(null);

  useEffect(() => {
    function clampPromptForViewport() {
      setPromptHeight((current) => clampPromptHeight(current, readPromptHeightLimit(input.maximized, input.conversationRef)));
    }

    clampPromptForViewport();
    window.addEventListener("resize", clampPromptForViewport);
    return () => {
      window.removeEventListener("resize", clampPromptForViewport);
    };
  }, [input.conversationRef, input.maximized]);

  function beginPromptResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    promptResizeRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startHeight: promptHeight
    };
    document.body.classList.add("is-resizing-prompt");
  }

  function updatePromptResize(event: PointerEvent<HTMLDivElement>) {
    const state = promptResizeRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaY = state.startClientY - event.clientY;
    setPromptHeight(clampPromptHeight(state.startHeight + deltaY, readPromptHeightLimit(input.maximized, input.conversationRef)));
  }

  function finishPromptResize(event: PointerEvent<HTMLDivElement>) {
    const state = promptResizeRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    promptResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.classList.remove("is-resizing-prompt");
  }

  function beginMascotDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.detail >= 2) {
      input.onToggleMaximize();
      return;
    }

    void startDragWidget();
  }

  function beginResize(direction: WidgetResizeDirection, event: PointerEvent<HTMLDivElement>) {
    if (input.maximized || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startClientX = event.clientX;
    const startClientY = event.clientY;

    void startResizeWidget(direction).then((nativeStarted) => {
      if (nativeStarted) {
        return;
      }

      target.setPointerCapture(pointerId);
      void beginManualResize({
        direction,
        pointerId,
        target,
        startClientX,
        startClientY
      });
    });
  }

  async function beginManualResize(options: {
    direction: WidgetResizeDirection;
    pointerId: number;
    target: HTMLDivElement;
    startClientX: number;
    startClientY: number;
  }) {
    const geometry = await readWidgetWindowGeometry();
    if (!geometry) {
      return;
    }

    resizeDragRef.current = {
      direction: options.direction,
      pointerId: options.pointerId,
      target: options.target,
      startClientX: options.startClientX,
      startClientY: options.startClientY,
      lastClientX: options.startClientX,
      lastClientY: options.startClientY,
      startX: geometry.x,
      startY: geometry.y,
      startWidth: geometry.width,
      startHeight: geometry.height,
      minWidth: MIN_WINDOW_WIDTH * geometry.scaleFactor,
      minHeight: MIN_WINDOW_HEIGHT * geometry.scaleFactor,
      scaleFactor: geometry.scaleFactor,
      frameId: null,
      applying: false,
      queued: false,
      ended: false
    };
    document.body.classList.add("is-resizing-widget");
  }

  function updateResize(event: PointerEvent<HTMLDivElement>) {
    const state = resizeDragRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
    scheduleResizeFrame(state);
  }

  function finishResize(event: PointerEvent<HTMLDivElement>) {
    const state = resizeDragRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    if (state.frameId !== null) {
      window.cancelAnimationFrame(state.frameId);
      state.frameId = null;
    }
    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
    state.ended = true;
    state.queued = true;
    applyLatestResizeFrame(state);
    if (state.target.hasPointerCapture(state.pointerId)) {
      state.target.releasePointerCapture(state.pointerId);
    }
  }

  function scheduleResizeFrame(state: ResizeDragState) {
    if (state.frameId !== null) {
      return;
    }

    state.frameId = window.requestAnimationFrame(() => {
      state.frameId = null;
      applyLatestResizeFrame(state);
    });
  }

  function applyLatestResizeFrame(state: ResizeDragState) {
    if (state.applying) {
      state.queued = true;
      return;
    }

    state.applying = true;
    state.queued = false;
    void setWidgetWindowFrame(calculateResizeFrame(state)).finally(() => {
      state.applying = false;
      if (state.queued) {
        scheduleResizeFrame(state);
        return;
      }
      if (state.ended) {
        cleanupResizeState(state);
      }
    });
  }

  function cleanupResizeState(state: ResizeDragState) {
    if (resizeDragRef.current === state) {
      resizeDragRef.current = null;
    }
    document.body.classList.remove("is-resizing-widget");
  }

  return {
    promptHeight,
    beginPromptResize,
    updatePromptResize,
    finishPromptResize,
    beginMascotDrag,
    beginResize,
    updateResize,
    finishResize
  };
}

function clampPromptHeight(value: number, maxHeight = PROMPT_COMPOSER_MAX_HEIGHT): number {
  if (!Number.isFinite(value)) {
    return PROMPT_COMPOSER_MIN_HEIGHT;
  }
  return Math.min(maxHeight, Math.max(PROMPT_COMPOSER_MIN_HEIGHT, value));
}

function readPromptHeightLimit(isMaximized: boolean, conversationRef: RefObject<HTMLElement | null>): number {
  const panel = conversationRef.current?.closest(".widget-panel");
  const panelHeight = panel instanceof HTMLElement ? panel.clientHeight : undefined;
  const mascotStage = isMaximized ? 0 : readCssPixelVariable("--mascot-stage", DEFAULT_MASCOT_STAGE_HEIGHT);
  const effectivePanelHeight = panelHeight ?? window.innerHeight - mascotStage;
  const availableHeight =
    effectivePanelHeight -
    PROMPT_COMPOSER_RESERVED_ROWS_HEIGHT -
    PROMPT_COMPOSER_MIN_CONVERSATION_HEIGHT;
  return Math.min(
    PROMPT_COMPOSER_MAX_HEIGHT,
    Math.max(PROMPT_COMPOSER_MIN_HEIGHT, availableHeight)
  );
}

function readCssPixelVariable(name: string, fallback: number): number {
  const rawValue = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

function calculateResizeFrame(state: ResizeDragState) {
  const direction = state.direction;
  const deltaX = (state.lastClientX - state.startClientX) * state.scaleFactor;
  const deltaY = (state.lastClientY - state.startClientY) * state.scaleFactor;
  let nextX = state.startX;
  let nextY = state.startY;
  let nextWidth = state.startWidth;
  let nextHeight = state.startHeight;

  if (direction.includes("East")) {
    nextWidth = Math.max(state.minWidth, state.startWidth + deltaX);
  }

  if (direction.includes("South")) {
    nextHeight = Math.max(state.minHeight, state.startHeight + deltaY);
  }

  if (direction.includes("West")) {
    nextWidth = Math.max(state.minWidth, state.startWidth - deltaX);
    nextX = state.startX + state.startWidth - nextWidth;
  }

  if (direction.includes("North")) {
    nextHeight = Math.max(state.minHeight, state.startHeight - deltaY);
    nextY = state.startY + state.startHeight - nextHeight;
  }

  return {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight
  };
}
