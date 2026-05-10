import type { WidgetMode } from "./base.js";
import type { ModelId, ReasoningEffort } from "./model.js";

export type MessageSnapshotStatus = "pending" | "thinking" | "tooling" | "streaming" | "done" | "cancelled" | "error";

export type SessionStatus = "active" | "archived" | "trashed";

export type SessionSummary = {
  id: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  parentSessionId?: string;
  branchFromMessageId?: string;
  activeModel?: ModelId;
  activeReasoning?: ReasoningEffort;
  activeMode?: WidgetMode;
  artifactCount?: number;
  messageCount?: number;
};

export type SessionMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: MessageSnapshotStatus;
};

export type SessionSnapshot = {
  activeSessionId: string;
  sessions: SessionSummary[];
  trashedSessions: SessionSummary[];
  messages: SessionMessage[];
};
