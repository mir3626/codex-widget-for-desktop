import type { Rect, TranscriptSegment } from "./core.js";
import type { Observation } from "./graph.js";

export type SpeechEvent = {
  id: string;
  t: number;
  type: "speech";
  text: string;
  confidence: number;
  segments?: TranscriptSegment[];
};

export type ScreenshotEvent = {
  id: string;
  t: number;
  type: "screenshot";
  path?: string;
  dataUrl?: string;
  cropOf?: string;
  bbox?: Rect;
  purpose: "full" | "primary_media" | "referent_crop" | "temporal_evidence" | "error_evidence";
  perceptualHash?: string;
  text?: string;
};

export type CapturePointerEvent = {
  id: string;
  t: number;
  type: "pointer";
  action: "move" | "click" | "drag" | "circle" | "highlight";
  x: number;
  y: number;
  toX?: number;
  toY?: number;
  bbox?: Rect;
};

export type CaptureKeyboardEvent = {
  id: string;
  t: number;
  type: "keyboard";
  action: "type" | "shortcut" | "submit";
  text?: string;
  key?: string;
};

export type ActiveWindowEvent = {
  id: string;
  t: number;
  type: "active_window";
  appName?: string;
  windowTitle?: string;
  url?: string;
};

export type ScrollEvent = {
  id: string;
  t: number;
  type: "scroll";
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
};

export type ArtifactEvent = {
  id: string;
  t: number;
  type: "artifact";
  title: string;
  path?: string;
  text?: string;
  metadata?: Record<string, unknown>;
};

export type SemanticEvent = {
  id: string;
  t: number;
  type: "semantic";
  source: Observation["source"];
  kind: Observation["kind"];
  label?: string;
  text?: string;
  bbox?: Rect;
  path?: string;
  metadata?: Record<string, unknown>;
  confidence?: number;
};

export type CaptureEvent =
  | SpeechEvent
  | ScreenshotEvent
  | CapturePointerEvent
  | CaptureKeyboardEvent
  | ActiveWindowEvent
  | ScrollEvent
  | ArtifactEvent
  | SemanticEvent;
