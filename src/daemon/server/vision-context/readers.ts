import type { CaptureEvent } from "../../vision-context/index.js";

export function normalizePositiveNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function readStringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readOptionalString(value: unknown): string | undefined {
  const string = readStringField(value);
  return string || undefined;
}

export function readRect(value: unknown): { x: number; y: number; w: number; h: number } | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  const width = Number(record.w ?? record.width);
  const height = Number(record.h ?? record.height);
  const x = Number(record.x);
  const y = Number(record.y);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, w: width, h: height };
}

export function readScreenshotPurpose(value: unknown): Extract<CaptureEvent, { type: "screenshot" }>["purpose"] {
  return value === "primary_media" ||
    value === "referent_crop" ||
    value === "temporal_evidence" ||
    value === "error_evidence" ||
    value === "full"
    ? value
    : "full";
}

export function readPointerAction(value: unknown): Extract<CaptureEvent, { type: "pointer" }>["action"] {
  return value === "move" || value === "click" || value === "drag" || value === "circle" || value === "highlight"
    ? value
    : "click";
}

export function readKeyboardAction(value: unknown): Extract<CaptureEvent, { type: "keyboard" }>["action"] {
  return value === "type" || value === "shortcut" || value === "submit" ? value : "type";
}

export function readObservationSource(value: unknown): Extract<CaptureEvent, { type: "semantic" }>["source"] {
  return value === "screen" ||
    value === "ocr" ||
    value === "browser" ||
    value === "terminal" ||
    value === "ide" ||
    value === "document" ||
    value === "accessibility" ||
    value === "pointer" ||
    value === "speech"
    ? value
    : "screen";
}

export function readObservationKind(value: unknown): Extract<CaptureEvent, { type: "semantic" }>["kind"] {
  return value === "image" ||
    value === "text" ||
    value === "ui_element" ||
    value === "file" ||
    value === "command" ||
    value === "error" ||
    value === "selection" ||
    value === "media" ||
    value === "page" ||
    value === "window" ||
    value === "gesture"
    ? value
    : "text";
}

export function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
