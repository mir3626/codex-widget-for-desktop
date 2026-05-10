import type {
  CaptureSource,
  VisionRawMedia,
  VisionRetentionPolicy
} from "./core.js";
import type { CaptureEvent } from "./events.js";

export type VisionCaptureSession = {
  id: string;
  sessionId?: string;
  startedAt: string;
  stoppedAt?: string;
  source: CaptureSource;
  userProfileId?: string;
  retention: VisionRetentionPolicy;
  timeline: CaptureEvent[];
  rawMedia?: VisionRawMedia;
};

export type VisionContextStartInput = {
  id?: string;
  sessionId?: string;
  source?: Partial<CaptureSource>;
  retention?: "default" | "privacy" | VisionRetentionPolicy;
  rawMedia?: VisionRawMedia;
};
