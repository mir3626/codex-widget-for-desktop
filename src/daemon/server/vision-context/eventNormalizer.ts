import type { CaptureEvent } from "../../vision-context/index.js";
import { cryptoRandomId } from "../runtimeActivity.js";
import {
  clampUnit,
  readKeyboardAction,
  readObservationKind,
  readObservationSource,
  readOptionalString,
  readPointerAction,
  readRecord,
  readRect,
  readScreenshotPurpose,
  readStringField
} from "./readers.js";

export function normalizeVisionContextEvent(input: unknown): CaptureEvent {
  const record = readRecord(input);
  if (!record || typeof record.type !== "string") {
    throw new Error("Vision Context event must include a type.");
  }
  const base = {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : cryptoRandomId(),
    t: Math.max(0, Math.floor(Number(record.t ?? 0)))
  };
  if (record.type === "speech") {
    return {
      ...base,
      type: "speech",
      text: readStringField(record.text),
      confidence: clampUnit(Number(record.confidence ?? 0.75))
    };
  }
  if (record.type === "screenshot") {
    return {
      ...base,
      type: "screenshot",
      path: readOptionalString(record.path),
      dataUrl: readOptionalString(record.dataUrl),
      cropOf: readOptionalString(record.cropOf),
      bbox: readRect(record.bbox),
      purpose: readScreenshotPurpose(record.purpose),
      perceptualHash: readOptionalString(record.perceptualHash),
      text: readOptionalString(record.text)
    };
  }
  if (record.type === "pointer") {
    return {
      ...base,
      type: "pointer",
      action: readPointerAction(record.action),
      x: Number(record.x ?? 0),
      y: Number(record.y ?? 0),
      toX: typeof record.toX === "number" ? record.toX : undefined,
      toY: typeof record.toY === "number" ? record.toY : undefined,
      bbox: readRect(record.bbox)
    };
  }
  if (record.type === "active_window") {
    return {
      ...base,
      type: "active_window",
      appName: readOptionalString(record.appName),
      windowTitle: readOptionalString(record.windowTitle),
      url: readOptionalString(record.url)
    };
  }
  if (record.type === "semantic") {
    return {
      ...base,
      type: "semantic",
      source: readObservationSource(record.source),
      kind: readObservationKind(record.kind),
      label: readOptionalString(record.label),
      text: readOptionalString(record.text),
      bbox: readRect(record.bbox),
      path: readOptionalString(record.path),
      metadata: readRecord(record.metadata),
      confidence: clampUnit(Number(record.confidence ?? 0.68))
    };
  }
  if (record.type === "keyboard") {
    return {
      ...base,
      type: "keyboard",
      action: readKeyboardAction(record.action),
      text: readOptionalString(record.text),
      key: readOptionalString(record.key)
    };
  }
  if (record.type === "scroll") {
    return {
      ...base,
      type: "scroll",
      x: typeof record.x === "number" ? record.x : undefined,
      y: typeof record.y === "number" ? record.y : undefined,
      deltaX: typeof record.deltaX === "number" ? record.deltaX : undefined,
      deltaY: typeof record.deltaY === "number" ? record.deltaY : undefined
    };
  }
  if (record.type === "artifact") {
    return {
      ...base,
      type: "artifact",
      title: readStringField(record.title),
      path: readOptionalString(record.path),
      text: readOptionalString(record.text),
      metadata: readRecord(record.metadata)
    };
  }
  throw new Error(`Unsupported Vision Context event type: ${record.type}`);
}

export function readVisionContextTimeRange(events: CaptureEvent[]): { startMs: number; endMs: number } {
  if (events.length === 0) {
    return { startMs: 0, endMs: 0 };
  }
  const times = events.map((event) => event.t);
  return { startMs: Math.min(...times), endMs: Math.max(...times) };
}
