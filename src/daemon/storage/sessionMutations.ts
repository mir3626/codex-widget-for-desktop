import { randomUUID } from "node:crypto";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import { readAppSetting, writeAppSetting } from "./settings.js";
import type {
  ModelId,
  ReasoningEffort,
  WidgetMode
} from "./types.js";

const ACTIVE_SESSION_SETTING_KEY = "session.active";

export function insertSession(
  database: NodeDatabaseSync,
  input: {
    id: string;
    title: string;
    parentSessionId?: string | null;
    branchFromMessageId?: string | null;
    model?: ModelId;
    reasoningEffort?: ReasoningEffort;
    mode?: WidgetMode;
  }
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO sessions (
        id, title, status, parent_session_id, branch_from_message_id, created_at, updated_at, last_opened_at,
        active_model, active_reasoning, active_mode
      )
      VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.title,
      input.parentSessionId ?? null,
      input.branchFromMessageId ?? null,
      now,
      now,
      now,
      input.model ?? null,
      input.reasoningEffort ?? null,
      input.mode ?? null
    );
  database
    .prepare(
      `INSERT INTO session_tabs (id, session_id, window_id, tab_index, active, created_at, updated_at)
       VALUES (?, ?, 'main', 0, 1, ?, ?)`
    )
    .run(randomUUID(), input.id, now, now);
}

export function insertMessage(
  database: NodeDatabaseSync,
  input: {
    id: string;
    sessionId: string;
    turnId?: string;
    role: "user" | "assistant";
    status: "pending" | "thinking" | "tooling" | "streaming" | "complete" | "cancelled" | "error";
    text: string;
    model?: ModelId;
    reasoningEffort?: ReasoningEffort;
    parentMessageId?: string | null;
  }
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT OR IGNORE INTO messages (
        id, session_id, turn_id, role, status, content_text, model, reasoning_effort, parent_message_id,
        created_at, updated_at, completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.sessionId,
      input.turnId ?? null,
      input.role,
      input.status,
      input.text,
      input.model ?? null,
      input.reasoningEffort ?? null,
      input.parentMessageId ?? null,
      now,
      now,
      input.status === "complete" || input.status === "cancelled" || input.status === "error" ? now : null
    );
}

export function deleteMessagesFrom(database: NodeDatabaseSync, sessionId: string, messageId: string): void {
  const row = database.prepare("SELECT created_at, rowid FROM messages WHERE session_id = ? AND id = ?").get(sessionId, messageId);
  if (typeof row?.created_at !== "string" || typeof row?.rowid !== "number") {
    return;
  }
  database
    .prepare(
      `DELETE FROM messages
       WHERE session_id = ?
         AND (created_at > ? OR (created_at = ? AND rowid >= ?))`
    )
    .run(sessionId, row.created_at, row.created_at, row.rowid);
  touchSessionUpdated(database, sessionId);
}

export function updateSessionMetadata(
  database: NodeDatabaseSync,
  sessionId: string,
  input: {
    title?: string;
    model?: ModelId;
    reasoningEffort?: ReasoningEffort;
    mode?: WidgetMode;
    openedAt?: string;
  }
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE sessions
       SET title = COALESCE(?, title),
           active_model = COALESCE(?, active_model),
           active_reasoning = COALESCE(?, active_reasoning),
           active_mode = COALESCE(?, active_mode),
           updated_at = ?,
           last_opened_at = COALESCE(?, last_opened_at)
       WHERE id = ?`
    )
    .run(input.title ?? null, input.model ?? null, input.reasoningEffort ?? null, input.mode ?? null, now, input.openedAt ?? null, sessionId);
}

export function touchSessionOpened(database: NodeDatabaseSync, sessionId: string): void {
  const now = new Date().toISOString();
  database.prepare("UPDATE sessions SET last_opened_at = ?, updated_at = ? WHERE id = ?").run(now, now, sessionId);
  writeAppSetting(database, ACTIVE_SESSION_SETTING_KEY, sessionId);
}

export function touchSessionUpdated(database: NodeDatabaseSync, sessionId: string, at = new Date().toISOString()): void {
  database.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(at, sessionId);
}

export function readActiveSessionId(database: NodeDatabaseSync): string | null {
  const id = readAppSetting<string>(database, ACTIVE_SESSION_SETTING_KEY);
  return typeof id === "string" && id.trim() ? id : null;
}

export function writeActiveSessionId(database: NodeDatabaseSync, sessionId: string): void {
  writeAppSetting(database, ACTIVE_SESSION_SETTING_KEY, sessionId);
}

export function isKnownSession(database: NodeDatabaseSync, sessionId: string): boolean {
  const row = database.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
  return typeof row?.id === "string";
}

export function isRestorableSession(database: NodeDatabaseSync, sessionId: string): boolean {
  const row = database.prepare("SELECT id FROM sessions WHERE id = ? AND status <> 'trashed'").get(sessionId);
  return typeof row?.id === "string";
}

export function sanitizeSessionTitle(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 54 ? `${normalized.slice(0, 53)}...` : normalized;
}

export function titleFromPrompt(text: string, fallback: string): string {
  return sanitizeSessionTitle(text, fallback);
}
