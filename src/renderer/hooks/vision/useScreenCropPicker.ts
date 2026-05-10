import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent,
  type SetStateAction
} from "react";
import type { ScreenCropSettings } from "../../types";
import type { LogLine, ScreenCropPickerState } from "../../types";
import type { WidgetMode } from "../../../shared/protocol.js";
import { readWidgetWindowGeometry } from "../../shell";
import {
  convertPickerSelectionToScreenCrop,
  readCropPickerPoint,
  readScreenCropPickerSelection
} from "../../utils/vision";

type UseScreenCropPickerInput = {
  setMode(mode: WidgetMode): void;
  appendLog(text: string, tone: LogLine["tone"]): void;
  setScreenCrop: Dispatch<SetStateAction<ScreenCropSettings>>;
};

export function useScreenCropPicker({
  setMode,
  appendLog,
  setScreenCrop
}: UseScreenCropPickerInput) {
  const [screenCropPicker, setScreenCropPickerState] = useState<ScreenCropPickerState | null>(null);
  const screenCropPickerRef = useRef<ScreenCropPickerState | null>(null);
  const cropPickerSelection = screenCropPicker ? readScreenCropPickerSelection(screenCropPicker) : null;
  const cropPickerSelectionStyle = cropPickerSelection ? (cropPickerSelection as CSSProperties) : undefined;

  useEffect(() => {
    if (!screenCropPicker) {
      return;
    }

    document.body.classList.add("is-picking-screen-crop");
    function cancelFromEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setScreenCropPicker(null);
      }
    }

    document.addEventListener("keydown", cancelFromEscape);
    return () => {
      document.body.classList.remove("is-picking-screen-crop");
      document.removeEventListener("keydown", cancelFromEscape);
    };
  }, [screenCropPicker]);

  function setScreenCropPicker(next: ScreenCropPickerState | null) {
    screenCropPickerRef.current = next;
    setScreenCropPickerState(next);
  }

  async function startScreenCropPicker() {
    setMode("screen");
    const geometry = await readWidgetWindowGeometry();
    setScreenCropPicker({
      pointerId: null,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      geometry
    });
    appendLog("drag crop region", "tool");
  }

  function beginScreenCropPick(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const current = screenCropPickerRef.current;
    if (!current) {
      return;
    }

    const point = readCropPickerPoint(event.currentTarget, event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setScreenCropPicker({
      ...current,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y
    });
  }

  function updateScreenCropPick(event: PointerEvent<HTMLDivElement>) {
    const current = screenCropPickerRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    const point = readCropPickerPoint(event.currentTarget, event);
    setScreenCropPicker({
      ...current,
      currentX: point.x,
      currentY: point.y
    });
  }

  function finishScreenCropPick(event: PointerEvent<HTMLDivElement>) {
    const current = screenCropPickerRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const selection = readScreenCropPickerSelection(current);
    if (selection.width >= 8 && selection.height >= 8) {
      setScreenCrop({
        enabled: true,
        ...convertPickerSelectionToScreenCrop(selection, current)
      });
    }
    setScreenCropPicker(null);
  }

  return {
    screenCropPicker,
    cropPickerSelection,
    cropPickerSelectionStyle,
    setScreenCropPicker,
    startScreenCropPicker,
    beginScreenCropPick,
    updateScreenCropPick,
    finishScreenCropPick
  };
}
