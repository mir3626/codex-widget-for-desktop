import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import {
  optionalString,
  snapshotStatusFromDb,
  stringOrNow
} from "./normalizers.js";
import type {
  MessageSnapshotStatus,
  ModelId,
  ReasoningEffort,
  SessionMessage,
  SessionSnapshot,
  SessionSummary,
  WidgetMode
} from "./types.js";

export function readSessionSnapshot(database: NodeDatabaseSync, activeSessionId: string): SessionSnapshot {
  const activeSessions = database
    .prepare(
      `SELECT sessions.*,
              (SELECT COUNT(*) FROM artifacts WHERE artifacts.session_id = sessions.id AND artifacts.status = 'active') AS artifact_count,
              (SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id) AS message_count
       FROM sessions
       WHERE sessions.status <> 'trashed'
       ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC
       LIMIT 40`
    )
    .all();
  const trashedSessions = database
    .prepare(
      `SELECT sessions.*,
              (SELECT COUNT(*) FROM artifacts WHERE artifacts.session_id = sessions.id) AS artifact_count,
              (SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id) AS message_count
       FROM sessions
       WHERE sessions.status = 'trashed'
       ORDER BY COALESCE(trashed_at, updated_at) DESC
       LIMIT 30`
    )
    .all();
  const messages = database
    .prepare(
      `SELECT id, role, status, content_text
       FROM messages
       WHERE session_id = ? AND role IN ('user', 'assistant')
       ORDER BY created_at ASC, rowid ASC
       LIMIT 240`
    )
    .all(activeSessionId);

  return {
    activeSessionId,
    sessions: activeSessions.flatMap(readSessionSummary),
    trashedSessions: trashedSessions.flatMap(readSessionSummary),
    messages: messages.flatMap(readSessionMessage)
  };
}

function readSessionSummary(value: unknown): SessionSummary[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.status !== "string") {
    return [];
  }
  return [
    {
      id: row.id,
      title: row.title,
      status: row.status === "archived" || row.status === "trashed" ? row.status : "active",
      createdAt: stringOrNow(row.created_at),
      updatedAt: stringOrNow(row.updated_at),
      lastOpenedAt: optionalString(row.last_opened_at),
      parentSessionId: optionalString(row.parent_session_id),
      branchFromMessageId: optionalString(row.branch_from_message_id),
      activeModel: optionalString(row.active_model) as ModelId | undefined,
      activeReasoning: optionalString(row.active_reasoning) as ReasoningEffort | undefined,
      activeMode: optionalString(row.active_mode) as WidgetMode | undefined,
      artifactCount: typeof row.artifact_count === "number" ? row.artifact_count : Number(row.artifact_count ?? 0),
      messageCount: typeof row.message_count === "number" ? row.message_count : Number(row.message_count ?? 0)
    }
  ];
}

function readSessionMessage(value: unknown): SessionMessage[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.role !== "string" || typeof row.content_text !== "string") {
    return [];
  }
  if (row.role !== "user" && row.role !== "assistant") {
    return [];
  }
  return [
    {
      id: row.id,
      role: row.role,
      text: row.content_text,
      status: row.role === "assistant" ? snapshotStatusFromDb(row.status) : undefined
    }
  ];
}
