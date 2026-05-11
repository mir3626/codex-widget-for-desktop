import { createRequire as createNodeRequire } from "node:module";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";

export const MEMORY_SCHEMA_VERSION = "semantic-memory.v1";
export const MEMORY_STORE_VERSION = "semantic-memory-store.v1";
export const DECAY_EPOCH = "v1-static";

export function ensureSemanticMemoryTables(database: NodeDatabaseSync): void {
  database.exec(`
CREATE TABLE IF NOT EXISTS semantic_memory_nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT,
  scope_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS semantic_memory_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL REFERENCES semantic_memory_nodes(id) ON DELETE CASCADE,
  to_node_id TEXT NOT NULL REFERENCES semantic_memory_nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  weight_bp INTEGER NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  positive_count INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  safety_class TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS semantic_unresolved_cases (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  surface TEXT NOT NULL,
  failure_kind TEXT NOT NULL,
  utterance_hash TEXT,
  redacted_utterance TEXT,
  scope_json TEXT NOT NULL,
  candidates_json TEXT NOT NULL DEFAULT '[]',
  trace_id TEXT,
  resolved_by TEXT,
  resolution_event_id TEXT
);
CREATE TABLE IF NOT EXISTS semantic_feedback_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  surface TEXT,
  scope_json TEXT NOT NULL,
  utterance_hash TEXT,
  redacted_utterance TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  memory_delta_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_semantic_memory_nodes_kind_key ON semantic_memory_nodes(kind, key);
CREATE INDEX IF NOT EXISTS idx_semantic_memory_edges_from_relation ON semantic_memory_edges(from_node_id, relation);
CREATE INDEX IF NOT EXISTS idx_semantic_unresolved_surface_failure ON semantic_unresolved_cases(surface, failure_kind, created_at);
CREATE INDEX IF NOT EXISTS idx_semantic_feedback_source_created ON semantic_feedback_events(source, created_at);
`);
}

export function loadDatabaseSync(): new (path: string) => NodeDatabaseSync {
  const require = createNodeRequire(import.meta.url);
  return (require("node:sqlite") as { DatabaseSync: new (path: string) => NodeDatabaseSync }).DatabaseSync;
}
