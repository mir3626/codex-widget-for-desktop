import {
  normalizeModelId,
  normalizeReasoningEffort,
  type BranchContextMessage,
  type ModelId,
  type ReasoningEffort,
  type ScreenCrop,
  type WidgetMode
} from "../../shared/protocol.js";
import {
  BRANCH_CONTEXT_STORAGE_KEY,
  CHAT_STORAGE_KEY,
  DEFAULT_VISION_STREAM_SETTINGS,
  MODEL_STORAGE_KEY,
  REASONING_STORAGE_KEY,
  SCREEN_CROP_STORAGE_KEY,
  VISION_FRAME_INTERVAL_OPTIONS,
  VISION_MAX_DURATION_OPTIONS,
  VISION_STREAM_SETTINGS_STORAGE_KEY
} from "../config";
import type { AssistantMessageStatus, ChatMessage, ScreenCropSettings, VisionStreamSettings } from "../types";

export function readStoredOpacity(): number {
  const stored = localStorage.getItem("codex-widget-opacity");
  if (!stored) {
    return 0.95;
  }
  return clampOpacity(Number(stored));
}

export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.95;
  }
  return Math.min(1, Math.max(0, value > 1 ? value / 100 : value));
}

export function readStoredModel(): ModelId {
  return normalizeModelId(localStorage.getItem(MODEL_STORAGE_KEY));
}

export function readInitialWidgetMode(): WidgetMode {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "browser" || mode === "screen" || mode === "terminal" ? mode : "agent";
}

export function readStoredReasoningEffort(): ReasoningEffort {
  return normalizeReasoningEffort(localStorage.getItem(REASONING_STORAGE_KEY));
}

export function readStoredScreenCrop(): ScreenCropSettings {
  const fallback: ScreenCropSettings = { enabled: false, x: 0, y: 0, width: 0, height: 0 };
  const stored = localStorage.getItem(SCREEN_CROP_STORAGE_KEY);
  if (!stored) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ScreenCropSettings>;
    return {
      enabled: parsed.enabled === true,
      x: normalizeScreenCropField("x", parsed.x),
      y: normalizeScreenCropField("y", parsed.y),
      width: normalizeScreenCropField("width", parsed.width),
      height: normalizeScreenCropField("height", parsed.height)
    };
  } catch {
    return fallback;
  }
}

export function persistScreenCrop(crop: ScreenCropSettings): void {
  localStorage.setItem(SCREEN_CROP_STORAGE_KEY, JSON.stringify(crop));
}

export function readStoredVisionStreamSettings(): VisionStreamSettings {
  const stored = localStorage.getItem(VISION_STREAM_SETTINGS_STORAGE_KEY);
  if (!stored) {
    return DEFAULT_VISION_STREAM_SETTINGS;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<VisionStreamSettings>;
    return {
      frameIntervalMs: normalizeVisionFrameInterval(parsed.frameIntervalMs),
      maxDurationMs: normalizeVisionMaxDuration(parsed.maxDurationMs)
    };
  } catch {
    return DEFAULT_VISION_STREAM_SETTINGS;
  }
}

export function persistVisionStreamSettings(settings: VisionStreamSettings): void {
  localStorage.setItem(VISION_STREAM_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function normalizeVisionFrameInterval(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return VISION_FRAME_INTERVAL_OPTIONS.some((option) => option.value === numeric)
    ? numeric
    : DEFAULT_VISION_STREAM_SETTINGS.frameIntervalMs;
}

export function normalizeVisionMaxDuration(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return VISION_MAX_DURATION_OPTIONS.some((option) => option.value === numeric)
    ? numeric
    : DEFAULT_VISION_STREAM_SETTINGS.maxDurationMs;
}

export function normalizeScreenCropField(field: keyof ScreenCrop, value: unknown): number {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const rounded = Math.trunc(numeric);
  return field === "width" || field === "height" ? Math.max(0, rounded) : rounded;
}

export function readStoredChatMessages(): ChatMessage[] {
  const stored = localStorage.getItem(CHAT_STORAGE_KEY);
  if (!stored) {
    return [];
  }
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap(readStoredChatMessage).slice(-80);
  } catch {
    return [];
  }
}

function readStoredChatMessage(value: unknown): ChatMessage[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.text !== "string") {
    return [];
  }

  if (record.role === "user") {
    return [{ id: record.id, role: "user", text: record.text }];
  }

  if (record.role === "assistant") {
    const status: AssistantMessageStatus = record.status === "error" || record.status === "cancelled" ? record.status : "done";
    return [{ id: record.id, role: "assistant", text: record.text, status }];
  }

  return [];
}

export function readStoredBranchContext(): BranchContextMessage[] | null {
  const stored = localStorage.getItem(BRANCH_CONTEXT_STORAGE_KEY);
  if (!stored) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    const context = parsed.flatMap(readStoredBranchContextMessage).slice(-2);
    return context.length > 0 ? context : null;
  } catch {
    return null;
  }
}

function readStoredBranchContextMessage(value: unknown): BranchContextMessage[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const record = value as Record<string, unknown>;
  if ((record.role !== "user" && record.role !== "assistant") || typeof record.text !== "string" || !record.text.trim()) {
    return [];
  }

  return [{ role: record.role, text: record.text }];
}

export function persistChatMessages(messages: ChatMessage[]): void {
  localStorage.setItem(
    CHAT_STORAGE_KEY,
    JSON.stringify(
      messages
        .filter((message) => message.role === "user" || message.text)
        .map((message) =>
          message.role === "assistant"
            ? { id: message.id, role: message.role, text: message.text, status: message.status }
            : message
        )
    )
  );
}

export function persistBranchContext(context: BranchContextMessage[] | null): void {
  if (!context || context.length === 0) {
    localStorage.removeItem(BRANCH_CONTEXT_STORAGE_KEY);
    return;
  }
  localStorage.setItem(BRANCH_CONTEXT_STORAGE_KEY, JSON.stringify(context));
}
