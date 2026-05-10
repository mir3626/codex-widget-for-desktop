export type VisionStreamMode = "recording" | "agent_stream";

export type VisionStreamStatus = "pending" | "recording" | "streaming" | "stopped" | "error";

export type VisionStreamSummary = {
  id: string;
  sessionId?: string;
  mode: VisionStreamMode;
  status: VisionStreamStatus;
  fps?: number;
  frameIntervalMs?: number;
  recordingBlobId?: string;
  startedAt: string;
  stoppedAt?: string;
  detail?: unknown;
};

export type VisionContextSourceRequest = {
  kind?: "screen" | "window" | "browser_tab" | "app";
  appName?: string;
  windowTitle?: string;
  url?: string;
  viewport?: {
    width: number;
    height: number;
    devicePixelRatio?: number;
  };
};

export type VisionContextEventInput = {
  id?: string;
  t?: number;
  type: string;
  [key: string]: unknown;
};
