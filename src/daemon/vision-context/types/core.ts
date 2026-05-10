export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TranscriptSegment = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
};

export type CaptureSource = {
  kind: "screen" | "window" | "browser_tab" | "app";
  appName?: string;
  windowTitle?: string;
  url?: string;
  viewport?: {
    width: number;
    height: number;
    devicePixelRatio?: number;
  };
};

export type VisionRetentionPolicy = {
  rawVideo: "delete_after_processing";
  rawAudio: "delete_after_processing";
  derivedFrames: "keep_selected" | "delete_after_turn";
  fullFrames: "keep_selected" | "crop_only";
  transcript: "keep" | "delete_after_turn";
};

export const DEFAULT_RETENTION: VisionRetentionPolicy = {
  rawVideo: "delete_after_processing",
  rawAudio: "delete_after_processing",
  derivedFrames: "keep_selected",
  fullFrames: "keep_selected",
  transcript: "keep"
};

export const PRIVACY_RETENTION: VisionRetentionPolicy = {
  rawVideo: "delete_after_processing",
  rawAudio: "delete_after_processing",
  derivedFrames: "delete_after_turn",
  fullFrames: "crop_only",
  transcript: "delete_after_turn"
};

export type VisionRawMedia = {
  videoPath?: string;
  audioPath?: string;
  segmentPaths?: string[];
};
