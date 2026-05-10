import type { WidgetMode } from "../../../shared/protocol.js";
import type { CaptureSource } from "./core.js";
import type { CapturePointerEvent } from "./events.js";
import type { Observation } from "./graph.js";
import type { VisionCaptureSession } from "./session.js";

export type VisionContextAdapter = {
  id: string;
  label: string;
  isAvailable(input: AdapterAvailabilityInput): Promise<boolean>;
  collect(input: AdapterCollectInput): Promise<Observation[]>;
};

export type AdapterAvailabilityInput = {
  captureSession: VisionCaptureSession;
  activeSource?: CaptureSource;
};

export type AdapterCollectInput = {
  captureSession: VisionCaptureSession;
  timeRange: { startMs: number; endMs: number };
  activeSource?: CaptureSource;
  hints: {
    utterance?: string;
    pointerEvents?: CapturePointerEvent[];
    currentMode?: WidgetMode;
  };
  providerState?: {
    screenSnapshot?: unknown;
    domSnapshot?: unknown;
    terminal?: unknown;
  };
};

export type ScreenSnapshotLike = {
  source: string;
  title: string;
  description: string;
  ocrText: string;
  imageDataUrl: string;
  imageHash: string;
  imageChanged: boolean;
  imageDiffRatio: number;
  imageMeaningfullyChanged: boolean;
  capturedAt: string;
};
