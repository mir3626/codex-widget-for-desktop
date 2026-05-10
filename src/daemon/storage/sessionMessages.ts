import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import { readSingleValue } from "./database.js";
import { readSessionSnapshot } from "./sessionSnapshots.js";
import {
  deleteMessagesFrom,
  insertMessage,
  isRestorableSession,
  titleFromPrompt,
  touchSessionUpdated,
  updateSessionMetadata,
  writeActiveSessionId
} from "./sessionMutations.js";
import { dbStatusFromSnapshot } from "./normalizers.js";
import { ensureSessionSnapshot } from "./sessionLifecycle.js";
import type {
  AskPersistenceInput,
  AssistantDeltaInput,
  AssistantUpdateInput,
  SessionSnapshot
} from "./types.js";

export function prepareAsk(database: NodeDatabaseSync, input: AskPersistenceInput): { sessionId: string; snapshot: SessionSnapshot } {
  const fallbackSnapshot = input.sessionId && isRestorableSession(database, input.sessionId)
    ? null
    : ensureSessionSnapshot(database, {
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        mode: input.mode
      });
  const sessionId = input.sessionId && isRestorableSession(database, input.sessionId)
    ? input.sessionId
    : fallbackSnapshot?.activeSessionId;
  if (!sessionId) {
    throw new Error("Unable to resolve active session.");
  }

  if (input.replaceFromMessageId) {
    deleteMessagesFrom(database, sessionId, input.replaceFromMessageId);
  }

  const now = new Date().toISOString();
  const hasUserMessage = Number(
    readSingleValue(database, "SELECT COUNT(*) AS value FROM messages WHERE session_id = ? AND role = 'user'", "value", sessionId)
  ) > 0;
  const nextTitle = hasUserMessage ? undefined : titleFromPrompt(input.text, "New chat");
  updateSessionMetadata(database, sessionId, {
    title: nextTitle,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    mode: input.mode,
    openedAt: now
  });
  writeActiveSessionId(database, sessionId);

  const userMessageId = `user:${input.requestId}`;
  insertMessage(database, {
    id: userMessageId,
    sessionId,
    turnId: input.requestId,
    role: "user",
    status: "complete",
    text: input.text,
    model: input.model,
    reasoningEffort: input.reasoningEffort
  });
  insertMessage(database, {
    id: input.requestId,
    sessionId,
    turnId: input.requestId,
    role: "assistant",
    status: "pending",
    text: "",
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    parentMessageId: userMessageId
  });

  return { sessionId, snapshot: readSessionSnapshot(database, sessionId) };
}

export function appendAssistantDelta(database: NodeDatabaseSync, input: AssistantDeltaInput): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE messages
       SET content_text = content_text || ?, status = ?, updated_at = ?
       WHERE id = ? AND session_id = ? AND role = 'assistant'`
    )
    .run(input.text, dbStatusFromSnapshot(input.status ?? "streaming"), now, input.messageId, input.sessionId);
  touchSessionUpdated(database, input.sessionId, now);
}

export function updateAssistantMessage(database: NodeDatabaseSync, input: AssistantUpdateInput): void {
  const now = new Date().toISOString();
  const status = dbStatusFromSnapshot(input.status);
  const completedAt = input.status === "done" || input.status === "cancelled" || input.status === "error" ? now : null;
  if (typeof input.text === "string") {
    database
      .prepare(
        `UPDATE messages
         SET content_text = ?, status = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND session_id = ? AND role = 'assistant'`
      )
      .run(input.text, status, now, completedAt, input.messageId, input.sessionId);
  } else {
    database
      .prepare(
        `UPDATE messages
         SET status = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND session_id = ? AND role = 'assistant'`
      )
      .run(status, now, completedAt, input.messageId, input.sessionId);
  }
  touchSessionUpdated(database, input.sessionId, now);
}
