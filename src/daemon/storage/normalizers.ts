import { createHash } from "node:crypto";
import type {
  ActivityLogEntry,
  ArtifactKind,
  MessageSnapshotStatus,
  ProviderSnapshotProvider,
  RuntimeThreadProvider,
  RuntimeThreadState,
  RuntimeThreadSummary,
  VisionStreamMode,
  VisionStreamStatus
} from "./types.js";

export function stableId(prefix: string, ...parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
  return `${prefix}:${hash}`;
}

export function runtimeThreadRowId(sessionId: string, provider: RuntimeThreadProvider): string {
  return stableId("runtime-thread", sessionId, provider);
}

export function artifactKindFromOperation(operation: "create" | "modify" | "delete"): ArtifactKind {
  if (operation === "create") {
    return "generated";
  }
  if (operation === "delete") {
    return "deleted";
  }
  return "modified";
}

export function normalizeArtifactKind(value: unknown): ArtifactKind {
  return value === "modified" || value === "deleted" || value === "external" ? value : "generated";
}

export function normalizeArtifactOperation(value: unknown): "create" | "modify" | "delete" | undefined {
  return value === "create" || value === "modify" || value === "delete" ? value : undefined;
}

export function normalizeActivityLevel(value: unknown): ActivityLogEntry["level"] {
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

export function normalizeVisionStreamMode(value: unknown): VisionStreamMode {
  return value === "agent_stream" ? "agent_stream" : "recording";
}

export function normalizeVisionStreamStatus(value: unknown): VisionStreamStatus {
  return value === "pending" || value === "recording" || value === "streaming" || value === "error" ? value : "stopped";
}

export function normalizeRuntimeThreadState(value: unknown): RuntimeThreadState {
  return value === "starting" || value === "connected" || value === "active" || value === "error" ? value : "closed";
}

export function normalizeRuntimeThreadProvider(value: unknown): RuntimeThreadProvider {
  if (value === "codex-exec" || value === "oauth-proxy" || value === "mock") {
    return value;
  }
  return "codex-app-server";
}

export function normalizeProviderSnapshotProvider(value: unknown): ProviderSnapshotProvider {
  if (value === "vision" || value === "terminal") {
    return value;
  }
  return "dom";
}

export function readRuntimeThreadRow(value: unknown): RuntimeThreadSummary | null {
  const row = readRecord(value);
  if (typeof row?.id !== "string" || typeof row.session_id !== "string") {
    return null;
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    provider: normalizeRuntimeThreadProvider(row.provider),
    threadId: optionalString(row.thread_id),
    turnId: optionalString(row.turn_id),
    state: normalizeRuntimeThreadState(row.state),
    startedAt: optionalString(row.started_at),
    closedAt: optionalString(row.closed_at),
    lastError: optionalString(row.last_error)
  };
}

export function sanitizeProviderSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

export function stringifyBoundedJson(value: unknown, maxBytes: number): string {
  const json = JSON.stringify(value ?? {});
  if (Buffer.byteLength(json, "utf8") <= maxBytes) {
    return json;
  }
  return JSON.stringify({
    truncated: true,
    originalBytes: Buffer.byteLength(json, "utf8")
  });
}

export function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function normalizeOptionalNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function normalizeRecordingMime(value: unknown): string {
  const mime = typeof value === "string" ? value.trim().toLowerCase() : "";
  return mime.startsWith("video/webm") ? mime : "video/webm";
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function stringOrNow(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : new Date().toISOString();
}

export function dbStatusFromSnapshot(status: MessageSnapshotStatus): "pending" | "thinking" | "tooling" | "streaming" | "complete" | "cancelled" | "error" {
  return status === "done" ? "complete" : status;
}

export function snapshotStatusFromDb(value: unknown): MessageSnapshotStatus {
  if (
    value === "pending" ||
    value === "thinking" ||
    value === "tooling" ||
    value === "streaming" ||
    value === "cancelled" ||
    value === "error"
  ) {
    return value;
  }
  return "done";
}

export function readWarningType(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "type" in value) {
    const type = (value as { type?: unknown }).type;
    return typeof type === "string" ? type : "";
  }
  return "";
}
