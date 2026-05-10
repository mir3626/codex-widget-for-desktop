import { randomUUID } from "node:crypto";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import { readSingleValue } from "./database.js";
import { readSessionSnapshot } from "./sessionSnapshots.js";
import {
  insertMessage,
  insertSession,
  isKnownSession,
  isRestorableSession,
  readActiveSessionId,
  sanitizeSessionTitle,
  titleFromPrompt,
  touchSessionOpened,
  writeActiveSessionId
} from "./sessionMutations.js";
import type {
  BranchSessionInput,
  SessionDefaults,
  SessionSnapshot
} from "./types.js";

export function ensureSessionSnapshot(database: NodeDatabaseSync, defaults: SessionDefaults = {}): SessionSnapshot {
  const activeSessionId = readActiveSessionId(database);
  if (activeSessionId && isRestorableSession(database, activeSessionId)) {
    touchSessionOpened(database, activeSessionId);
    return readSessionSnapshot(database, activeSessionId);
  }

  const latest = database
    .prepare(
      `SELECT id FROM sessions
       WHERE status = 'active'
       ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC
       LIMIT 1`
    )
    .get();
  if (typeof latest?.id === "string") {
    touchSessionOpened(database, latest.id);
    return readSessionSnapshot(database, latest.id);
  }

  return createSession(database, defaults);
}

export function createSession(database: NodeDatabaseSync, input: SessionDefaults = {}): SessionSnapshot {
  const id = randomUUID();
  insertSession(database, {
    id,
    title: sanitizeSessionTitle(input.title, "New chat"),
    parentSessionId: null,
    branchFromMessageId: null,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    mode: input.mode
  });
  writeActiveSessionId(database, id);
  return readSessionSnapshot(database, id);
}

export function openSession(database: NodeDatabaseSync, sessionId: string): SessionSnapshot {
  if (!isRestorableSession(database, sessionId)) {
    throw new Error("Session is not available.");
  }
  touchSessionOpened(database, sessionId);
  return readSessionSnapshot(database, sessionId);
}

export function discardSession(database: NodeDatabaseSync, sessionId: string): SessionSnapshot {
  const row = database.prepare("SELECT id, title FROM sessions WHERE id = ? AND status = 'active'").get(sessionId);
  if (typeof row?.id !== "string") {
    return ensureSessionSnapshot(database);
  }
  const title = typeof row.title === "string" ? row.title.trim().toLowerCase() : "";
  const messageCount = Number(readSingleValue(database, "SELECT COUNT(*) AS value FROM messages WHERE session_id = ?", "value", sessionId) ?? 0);
  const artifactCount = Number(readSingleValue(database, "SELECT COUNT(*) AS value FROM artifacts WHERE session_id = ?", "value", sessionId) ?? 0);
  if (title !== "new chat" || messageCount > 0 || artifactCount > 0) {
    return trashSession(database, sessionId);
  }

  database.prepare("DELETE FROM trash_entries WHERE entity_type = 'session' AND entity_id = ?").run(sessionId);
  database.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);

  if (readActiveSessionId(database) !== sessionId) {
    return ensureSessionSnapshot(database);
  }

  const next = database
    .prepare(
      `SELECT id FROM sessions
       WHERE status = 'active'
       ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC
       LIMIT 1`
    )
    .get();
  if (typeof next?.id === "string") {
    return openSession(database, next.id);
  }
  return createSession(database);
}

export function deleteSession(database: NodeDatabaseSync, sessionId: string): SessionSnapshot {
  const row = database.prepare("SELECT id, status FROM sessions WHERE id = ?").get(sessionId);
  if (typeof row?.id !== "string") {
    return ensureSessionSnapshot(database);
  }
  if (row.status !== "trashed") {
    return ensureSessionSnapshot(database);
  }

  database.prepare("DELETE FROM trash_entries WHERE entity_type = 'session' AND entity_id = ?").run(sessionId);
  database.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  return ensureSessionSnapshot(database);
}

export function trashSession(database: NodeDatabaseSync, sessionId: string): SessionSnapshot {
  const now = new Date().toISOString();
  const row = database.prepare("SELECT id, status FROM sessions WHERE id = ?").get(sessionId);
  if (typeof row?.id !== "string") {
    return ensureSessionSnapshot(database);
  }

  database
    .prepare(
      `UPDATE sessions
       SET status = 'trashed', trashed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(now, now, sessionId);
  database.prepare("DELETE FROM trash_entries WHERE entity_type = 'session' AND entity_id = ?").run(sessionId);
  database
    .prepare(
      `INSERT INTO trash_entries (id, entity_type, entity_id, trashed_at, restore_payload_json)
       VALUES (?, 'session', ?, ?, ?)`
    )
    .run(randomUUID(), sessionId, now, JSON.stringify({ previousStatus: row.status ?? "active" }));

  if (readActiveSessionId(database) !== sessionId) {
    return ensureSessionSnapshot(database);
  }

  const next = database
    .prepare(
      `SELECT id FROM sessions
       WHERE status = 'active' AND id <> ?
       ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC
       LIMIT 1`
    )
    .get(sessionId);
  if (typeof next?.id === "string") {
    return openSession(database, next.id);
  }
  return createSession(database);
}

export function restoreSession(database: NodeDatabaseSync, sessionId: string): SessionSnapshot {
  const row = database.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
  if (typeof row?.id !== "string") {
    throw new Error("Session is not available.");
  }

  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE sessions
       SET status = 'active', trashed_at = NULL, updated_at = ?, last_opened_at = ?
       WHERE id = ?`
    )
    .run(now, now, sessionId);
  database.prepare("DELETE FROM trash_entries WHERE entity_type = 'session' AND entity_id = ?").run(sessionId);
  writeActiveSessionId(database, sessionId);
  return readSessionSnapshot(database, sessionId);
}

export function branchSession(database: NodeDatabaseSync, input: BranchSessionInput): SessionSnapshot {
  const activeParentId = input.parentSessionId ?? readActiveSessionId(database);
  const id = randomUUID();
  const userText = input.messages.find((message) => message.role === "user")?.text ?? "";
  insertSession(database, {
    id,
    title: sanitizeSessionTitle(input.title, titleFromPrompt(userText, "Branch chat")),
    parentSessionId: activeParentId && isKnownSession(database, activeParentId) ? activeParentId : null,
    branchFromMessageId: input.sourceMessageId ?? null,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    mode: input.mode
  });

  let previousMessageId: string | null = null;
  for (const message of input.messages.slice(0, 8)) {
    const messageId = `${message.role}:${randomUUID()}`;
    insertMessage(database, {
      id: messageId,
      sessionId: id,
      turnId: messageId,
      role: message.role,
      status: "complete",
      text: message.text,
      parentMessageId: previousMessageId
    });
    previousMessageId = messageId;
  }

  writeActiveSessionId(database, id);
  return readSessionSnapshot(database, id);
}
