import type { CSSProperties, PointerEvent } from "react";
import type { ScreenCrop } from "../../shared/protocol.js";
import { VISION_FRAME_INTERVAL_OPTIONS } from "../config";
import type { ScreenCropPickerState, ScreenCropSettings, VisionFrameStats } from "../types";

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Recording could not be encoded."));
      }
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Recording could not be read.")));
    reader.readAsDataURL(blob);
  });
}

export function buildScreenCrop(crop: ScreenCropSettings): ScreenCrop | undefined {
  if (!crop.enabled || crop.width <= 0 || crop.height <= 0) {
    return undefined;
  }
  return {
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height
  };
}

export function readCropPickerPoint(element: HTMLElement, event: PointerEvent<HTMLElement>): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
    y: Math.min(rect.height, Math.max(0, event.clientY - rect.top))
  };
}

export function readScreenCropPickerSelection(state: ScreenCropPickerState): CSSProperties & {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const left = Math.min(state.startX, state.currentX);
  const top = Math.min(state.startY, state.currentY);
  const width = Math.abs(state.currentX - state.startX);
  const height = Math.abs(state.currentY - state.startY);
  return { left, top, width, height };
}

export function convertPickerSelectionToScreenCrop(
  selection: { left: number; top: number; width: number; height: number },
  state: ScreenCropPickerState
): ScreenCrop {
  const scaleFactor = state.geometry?.scaleFactor ?? window.devicePixelRatio ?? 1;
  const originX = state.geometry?.x ?? Math.round(window.screenX * scaleFactor);
  const originY = state.geometry?.y ?? Math.round(window.screenY * scaleFactor);
  return {
    x: Math.round(originX + selection.left * scaleFactor),
    y: Math.round(originY + selection.top * scaleFactor),
    width: Math.max(1, Math.round(selection.width * scaleFactor)),
    height: Math.max(1, Math.round(selection.height * scaleFactor))
  };
}

export function formatVisionStreamStatus(stats: VisionFrameStats, frameIntervalMs: number): string {
  const cadence = VISION_FRAME_INTERVAL_OPTIONS.find((option) => option.value === frameIntervalMs)?.label ?? "1 fps";
  if (stats.lastSentAt) {
    return `Sharing screen · ${cadence} · ${stats.sent} frames${stats.skipped ? ` · ${stats.skipped} skipped` : ""}`;
  }
  return `Sharing screen · ${cadence}`;
}
