import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import { resolveStoragePaths, type StoragePathOptions } from "../../storage/paths.js";
import { deltasForFeedback } from "./graphWeights.js";
import { hashSemanticMemoryText, redactSemanticMemoryText } from "./privacy.js";
import { applyDelta } from "./sqliteGraph.js";
import { clearMemory, readMemory, readReport } from "./sqliteMemoryReads.js";
import {
  ensureSemanticMemoryTables,
  loadDatabaseSync
} from "./sqliteSchema.js";
import type {
  SemanticFeedbackEvent,
  SemanticMemoryStore,
  SemanticUnresolvedCase
} from "./types.js";

export function createSemanticMemoryStore(options: StoragePathOptions = {}): SemanticMemoryStore {
  const DatabaseSync = loadDatabaseSync();
  const paths = resolveStoragePaths(options);
  mkdirSync(dirname(paths.databasePath), { recursive: true });
  const database = new DatabaseSync(paths.databasePath);
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  ensureSemanticMemoryTables(database);
  return {
    recordUnresolvedCase: (input) => recordUnresolvedCase(database, input),
    recordFeedbackEvent: (input) => recordFeedbackEvent(database, input),
    readMemory: (input) => readMemory(database, input),
    readReport: () => readReport(database),
    clearMemory: (scope) => clearMemory(database, scope),
    close: () => {
      database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      database.close();
    }
  };
}

function recordUnresolvedCase(
  database: NodeDatabaseSync,
  input: Omit<SemanticUnresolvedCase, "id" | "createdAt" | "utteranceHash"> & { utterance?: string; createdAt?: string }
): SemanticUnresolvedCase {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const row: SemanticUnresolvedCase = {
    id: `sem-unresolved-${randomUUID()}`,
    createdAt,
    surface: input.surface,
    failureKind: input.failureKind,
    utteranceHash: input.utterance ? hashSemanticMemoryText(input.utterance) : undefined,
    redactedUtterance: redactSemanticMemoryText(input.utterance ?? input.redactedUtterance),
    scope: input.scope,
    candidates: input.candidates ?? [],
    traceId: input.traceId,
    resolvedBy: input.resolvedBy,
    resolutionEventId: input.resolutionEventId
  };
  database.prepare(`
    INSERT INTO semantic_unresolved_cases
      (id, created_at, surface, failure_kind, utterance_hash, redacted_utterance, scope_json, candidates_json, trace_id, resolved_by, resolution_event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.createdAt,
    row.surface,
    row.failureKind,
    row.utteranceHash ?? null,
    row.redactedUtterance ?? "",
    JSON.stringify(row.scope),
    JSON.stringify(row.candidates),
    row.traceId ?? null,
    row.resolvedBy ?? null,
    row.resolutionEventId ?? null
  );
  return row;
}

function recordFeedbackEvent(
  database: NodeDatabaseSync,
  input: Omit<SemanticFeedbackEvent, "id" | "createdAt" | "utteranceHash" | "memoryDelta"> & { utterance?: string; createdAt?: string }
): SemanticFeedbackEvent {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const base: Omit<SemanticFeedbackEvent, "memoryDelta"> = {
    id: `sem-feedback-${randomUUID()}`,
    createdAt,
    source: input.source,
    surface: input.surface,
    scope: input.scope,
    utteranceHash: input.utterance ? hashSemanticMemoryText(input.utterance) : undefined,
    redactedUtterance: redactSemanticMemoryText(input.utterance ?? input.redactedUtterance),
    payload: input.payload
  };
  const memoryDelta = deltasForFeedback(base);
  const event: SemanticFeedbackEvent = { ...base, memoryDelta };
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const delta of memoryDelta) {
      applyDelta(database, event.scope, delta, createdAt);
    }
    database.prepare(`
      INSERT INTO semantic_feedback_events
        (id, created_at, source, surface, scope_json, utterance_hash, redacted_utterance, payload_json, memory_delta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.createdAt,
      event.source,
      event.surface ?? null,
      JSON.stringify(event.scope),
      event.utteranceHash ?? null,
      event.redactedUtterance ?? "",
      JSON.stringify(event.payload),
      JSON.stringify(event.memoryDelta)
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return event;
}
