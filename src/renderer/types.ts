import type { ComponentPropsWithoutRef } from "react";
import type {
  RuntimeInteraction,
  ScreenCrop
} from "../shared/protocol.js";

export type LogLine = {
  id: string;
  text: string;
  tone: "muted" | "tool" | "error";
};

export type TerminalLine = {
  id: string;
  text: string;
  kind: "command" | "output" | "system" | "error";
};

export type TerminalKeyName = "enter" | "tab" | "escape" | "ctrl-c";

export type AssistantMessageStatus =
  | "pending"
  | "thinking"
  | "tooling"
  | "streaming"
  | "typing"
  | "done"
  | "cancelled"
  | "error";

export type ChatMessage =
  | {
      id: string;
      role: "user";
      text: string;
    }
  | {
      id: string;
      role: "assistant";
      text: string;
      status: AssistantMessageStatus;
    };

export type InteractionDrafts = Record<string, Record<string, string>>;

export type ScreenCropSettings = ScreenCrop & {
  enabled: boolean;
};

export type VisionStreamSettings = {
  frameIntervalMs: number;
  maxDurationMs: number;
};

export type VisionFrameStats = {
  sent: number;
  skipped: number;
  failed: number;
  lastSentAt: number | null;
};

export type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: {
    transcript: string;
  };
};

export type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export type PromptResizeState = {
  pointerId: number;
  startClientY: number;
  startHeight: number;
};

export type ToastNotice = {
  id: number;
  text: string;
};

export type ScreenCropPickerState = {
  pointerId: number | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  geometry: import("./shell").WidgetWindowGeometry | null;
};

export type InteractionCardProps = {
  interaction: RuntimeInteraction;
  values: Record<string, string>;
  onChange: (interactionId: string, fieldId: string, value: string) => void;
  onRespond: (interaction: RuntimeInteraction, decision: "approve" | "decline" | "submit") => void;
};

export type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & {
  onCopyCode: (text: string) => void;
};
