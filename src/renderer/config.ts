import { Bot, Eye, Globe2, SquareTerminal } from "lucide-react";
import type { WidgetMode } from "../shared/protocol.js";
import type { VisionStreamSettings } from "./types";
import type { WidgetResizeDirection } from "./shell";

export const MODES: Array<{ mode: WidgetMode; label: string; icon: typeof Bot }> = [
  { mode: "agent", label: "Agent", icon: Bot },
  { mode: "browser", label: "Browser", icon: Globe2 },
  { mode: "screen", label: "Vision", icon: Eye },
  { mode: "terminal", label: "PTY", icon: SquareTerminal }
];

export const MODEL_STORAGE_KEY = "codex-widget-model";
export const REASONING_STORAGE_KEY = "codex-widget-reasoning-effort";
export const CHAT_STORAGE_KEY = "codex-widget-chat-messages:v1";
export const BRANCH_CONTEXT_STORAGE_KEY = "codex-widget-branch-context:v1";
export const SCREEN_CROP_STORAGE_KEY = "codex-widget-screen-crop:v1";
export const VISION_STREAM_SETTINGS_STORAGE_KEY = "codex-widget-vision-stream-settings:v1";

export const MIN_WINDOW_WIDTH = 320;
export const MIN_WINDOW_HEIGHT = 480;
export const PROMPT_COMPOSER_MIN_HEIGHT = 46;
export const PROMPT_COMPOSER_MAX_HEIGHT = 192;
export const PROMPT_COMPOSER_RESERVED_ROWS_HEIGHT = 242;
export const PROMPT_COMPOSER_MIN_CONVERSATION_HEIGHT = 48;
export const DEFAULT_MASCOT_STAGE_HEIGHT = 126;
export const STREAM_TYPE_BASE_INTERVAL_MS = 18;
export const TERMINAL_LINE_LIMIT = 260;
export const TERMINAL_LINE_MAX_CHARS = 1800;
export const TERMINAL_MOUSE_DRAG_INTERVAL_MS = 28;
export const VISION_RECORDING_MAX_BYTES = 8 * 1024 * 1024;
export const VISION_RECORDING_MAX_DURATION_MS = 120_000;
export const VISION_AGENT_STREAM_FRAME_INTERVAL_MS = 1000;
export const VISION_AGENT_STREAM_MAX_FRAME_WIDTH = 960;
export const VISION_AGENT_STREAM_JPEG_QUALITY = 0.68;

export const VISION_FRAME_INTERVAL_OPTIONS = [
  { value: 2000, label: "0.5 fps" },
  { value: 1000, label: "1 fps" },
  { value: 500, label: "2 fps" }
] as const;

export const VISION_MAX_DURATION_OPTIONS = [
  { value: 60_000, label: "1 min" },
  { value: 120_000, label: "2 min" },
  { value: 300_000, label: "5 min" }
] as const;

export const DEFAULT_VISION_STREAM_SETTINGS: VisionStreamSettings = {
  frameIntervalMs: VISION_AGENT_STREAM_FRAME_INTERVAL_MS,
  maxDurationMs: VISION_RECORDING_MAX_DURATION_MS
};

export const RESIZE_HANDLES: Array<{ direction: WidgetResizeDirection; className: string }> = [
  { direction: "North", className: "resize-n" },
  { direction: "East", className: "resize-e" },
  { direction: "South", className: "resize-s" },
  { direction: "West", className: "resize-w" },
  { direction: "NorthEast", className: "resize-ne" },
  { direction: "NorthWest", className: "resize-nw" },
  { direction: "SouthEast", className: "resize-se" },
  { direction: "SouthWest", className: "resize-sw" }
];
