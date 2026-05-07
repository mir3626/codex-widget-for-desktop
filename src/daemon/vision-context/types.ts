import type { CodexUserInput, WidgetMode } from "../../shared/protocol.js";

export type { CodexUserInput };

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

export type Observation = {
  id: string;
  t: number;
  source: "screen" | "ocr" | "browser" | "terminal" | "ide" | "document" | "accessibility" | "pointer" | "speech";
  app?: string;
  kind:
    | "image"
    | "text"
    | "ui_element"
    | "file"
    | "command"
    | "error"
    | "selection"
    | "media"
    | "page"
    | "window"
    | "gesture";
  label?: string;
  text?: string;
  bbox?: Rect;
  path?: string;
  dataUrl?: string;
  metadata?: Record<string, unknown>;
  confidence: number;
};

export type ContextEntity = {
  id: string;
  name?: string;
  role: "referent" | "target" | "evidence" | "source_context" | "action_target" | "alternative";
  observations: string[];
  salience: number;
  confidence: number;
};

export type ContextEdge = {
  from: string;
  to: string;
  relation:
    | "near"
    | "contains"
    | "points_to"
    | "spoken_about"
    | "before"
    | "after"
    | "same_app"
    | "same_window"
    | "candidate_for";
  confidence: number;
};

export type EvidenceGraph = {
  sessionId: string;
  observations: Observation[];
  entities: ContextEntity[];
  edges: ContextEdge[];
};

export type IntentKind =
  | "identify_place"
  | "explain_screen"
  | "modify_code"
  | "debug_error"
  | "summarize_content"
  | "compare_items"
  | "rewrite_text"
  | "operate_app"
  | "unknown";

export type ResolvedIntent = {
  kind: IntentKind;
  summary: string;
  confidence: number;
};

export type CapsuleEvidence = {
  kind: "text" | "image" | "crop" | "event" | "semantic";
  title: string;
  path?: string;
  dataUrl?: string;
  text?: string;
  t?: number;
  bbox?: Rect;
  sourceObservationIds: string[];
};

export type CapsuleUncertainty = {
  reason: string;
  severity: "low" | "medium" | "high";
  sourceObservationIds?: string[];
};

export type TaskCapsule = {
  id: string;
  createdAt: string;
  captureSessionId: string;
  userUtterance: string;
  source?: CaptureSource;
  resolvedIntent: ResolvedIntent;
  referents: ContextEntity[];
  alternatives: ContextEntity[];
  actionTarget?: ContextEntity;
  evidence: CapsuleEvidence[];
  uncertainties: CapsuleUncertainty[];
  instructions: string[];
  retention: VisionRetentionPolicy;
};

export type ReferenceResolution = {
  primary?: ContextEntity;
  alternatives: ContextEntity[];
  confidence: number;
  reason: string;
};

export type ClarificationDecision =
  | { action: "none" }
  | { action: "inline_confirmation"; prompt: string; options?: string[] }
  | { action: "agent_can_ask"; reason: string };

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

export type BuildTaskCapsuleInput = {
  captureSession: VisionCaptureSession;
  observations?: Observation[];
  now?: Date;
};

export type VisionContextStartInput = {
  id?: string;
  sessionId?: string;
  source?: Partial<CaptureSource>;
  retention?: "default" | "privacy" | VisionRetentionPolicy;
  rawMedia?: VisionRawMedia;
};
