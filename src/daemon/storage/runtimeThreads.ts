import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type {
  RuntimeThreadInput,
  RuntimeThreadProvider,
  RuntimeThreadSummary
} from "./types.js";
import {
  normalizeRuntimeThreadState,
  readRuntimeThreadRow,
  runtimeThreadRowId
} from "./normalizers.js";

export function readRuntimeThread(
  database: NodeDatabaseSync,
  sessionId: string,
  provider: RuntimeThreadProvider
): RuntimeThreadSummary | null {
  const row = database
    .prepare(
      `SELECT id, session_id, provider, thread_id, turn_id, state, started_at, closed_at, last_error
       FROM runtime_threads
       WHERE id = ?`
    )
    .get(runtimeThreadRowId(sessionId, provider));
  return readRuntimeThreadRow(row);
}

export function writeRuntimeThread(database: NodeDatabaseSync, input: RuntimeThreadInput): RuntimeThreadSummary {
  if (!isRestorableSession(database, input.sessionId)) {
    throw new Error("Runtime thread session is not available.");
  }

  const now = new Date().toISOString();
  const id = runtimeThreadRowId(input.sessionId, input.provider);
  const state = normalizeRuntimeThreadState(input.state);
  const closedAt = input.closedAt ?? (state === "closed" || state === "error" ? now : null);
  database
    .prepare(
      `INSERT INTO runtime_threads (id, session_id, provider, thread_id, turn_id, state, started_at, closed_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         thread_id = excluded.thread_id,
         turn_id = excluded.turn_id,
         state = excluded.state,
         started_at = COALESCE(runtime_threads.started_at, excluded.started_at),
         closed_at = excluded.closed_at,
         last_error = excluded.last_error`
    )
    .run(
      id,
      input.sessionId,
      input.provider,
      input.threadId ?? null,
      input.turnId ?? null,
      state,
      input.startedAt ?? now,
      closedAt,
      input.lastError ?? null
    );
  const summary = readRuntimeThread(database, input.sessionId, input.provider);
  if (!summary) {
    throw new Error("Runtime thread was not persisted.");
  }
  return summary;
}

export function clearRuntimeThread(
  database: NodeDatabaseSync,
  sessionId: string,
  provider: RuntimeThreadProvider,
  error?: string
): void {
  if (!isRestorableSession(database, sessionId)) {
    return;
  }
  writeRuntimeThread(database, {
    sessionId,
    provider,
    state: error ? "error" : "closed",
    lastError: error
  });
}

function isRestorableSession(database: NodeDatabaseSync, sessionId: string): boolean {
  const row = database.prepare("SELECT id FROM sessions WHERE id = ? AND status <> 'trashed'").get(sessionId);
  return typeof row?.id === "string";
}
