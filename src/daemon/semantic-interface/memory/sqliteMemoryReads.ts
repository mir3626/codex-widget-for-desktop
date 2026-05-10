import { createHash } from "node:crypto";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type { MemoryReadSet, RedactedMemoryEdge, SemanticMemoryScope } from "../types.js";
import { normalizeKey } from "./graphWeights.js";
import { DECAY_EPOCH, MEMORY_SCHEMA_VERSION, MEMORY_STORE_VERSION } from "./sqliteSchema.js";
import type { SemanticMemoryQuery, SemanticMemoryReport } from "./types.js";

type SqlValue = string | number | bigint | null | Uint8Array;

export function readMemory(database: NodeDatabaseSync, input: SemanticMemoryQuery): MemoryReadSet {
  const phrase = normalizeKey(input.phrase);
  const limit = Math.max(1, Math.min(100, input.limit ?? 25));
  const minEvidenceCount = Math.max(0, input.minEvidenceCount ?? 1);
  const rows = database.prepare(`
    SELECT e.id, e.relation, e.weight_bp, e.evidence_count, e.positive_count, e.negative_count, e.source,
           e.safety_class, e.last_used_at, n1.key AS from_key, n2.key AS to_key, n1.scope_json AS scope_json
    FROM semantic_memory_edges e
    JOIN semantic_memory_nodes n1 ON n1.id = e.from_node_id
    JOIN semantic_memory_nodes n2 ON n2.id = e.to_node_id
    WHERE (? = '' OR n1.key = ?)
      AND e.evidence_count >= ?
    ORDER BY ABS(e.weight_bp) DESC, e.updated_at DESC, e.id ASC
    LIMIT ?
  `).all(phrase, phrase, minEvidenceCount, limit);
  const edges: RedactedMemoryEdge[] = [];
  const exclusions: MemoryReadSet["exclusions"] = [];
  for (const row of rows) {
    const scope = parseJson<SemanticMemoryScope>(row.scope_json, {});
    if (!scopeMatches(scope, input.scope)) {
      exclusions.push({ reason: "scope_mismatch", edgeId: String(row.id) });
      continue;
    }
    if (String(row.safety_class) === "blocked") {
      exclusions.push({ reason: "safety_boundary", edgeId: String(row.id) });
      continue;
    }
    edges.push({
      id: String(row.id),
      fromKey: String(row.from_key),
      toKey: String(row.to_key),
      relation: readRelation(row.relation),
      weightBp: Number(row.weight_bp),
      evidenceCount: Number(row.evidence_count),
      positiveCount: Number(row.positive_count),
      negativeCount: Number(row.negative_count),
      scope,
      source: readSource(row.source),
      safetyClass: readSafetyClass(row.safety_class),
      lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : undefined
    });
  }
  const queryHash = hashJson({ phrase, scope: input.scope, minEvidenceCount, limit });
  const resultHash = hashJson({ edges, exclusions });
  return {
    id: `mem-read-${queryHash}-${resultHash}`,
    schemaVersion: MEMORY_SCHEMA_VERSION,
    storeVersion: MEMORY_STORE_VERSION,
    decayEpoch: DECAY_EPOCH,
    scope: input.scope,
    queryHash,
    resultHash,
    edges,
    exclusions
  };
}

export function readReport(database: NodeDatabaseSync): SemanticMemoryReport {
  const generatedAt = new Date().toISOString();
  const edgeCount = Number(readSingleValue(database, "SELECT COUNT(*) AS value FROM semantic_memory_edges", "value"));
  const unresolvedCount = Number(readSingleValue(database, "SELECT COUNT(*) AS value FROM semantic_unresolved_cases", "value"));
  const feedbackCount = Number(readSingleValue(database, "SELECT COUNT(*) AS value FROM semantic_feedback_events", "value"));
  const readSet = readMemory(database, { scope: { global: true }, limit: 10, minEvidenceCount: 0 });
  return {
    generatedAt,
    edgeCount,
    unresolvedCount,
    feedbackCount,
    topEdges: readSet.edges
  };
}

export function clearMemory(database: NodeDatabaseSync, scope?: SemanticMemoryScope): void {
  if (!scope || scope.global) {
    database.exec("DELETE FROM semantic_feedback_events; DELETE FROM semantic_unresolved_cases; DELETE FROM semantic_memory_edges; DELETE FROM semantic_memory_nodes;");
    return;
  }
  const scopeJson = JSON.stringify(scope);
  database.prepare("DELETE FROM semantic_feedback_events WHERE scope_json = ?").run(scopeJson);
  database.prepare("DELETE FROM semantic_unresolved_cases WHERE scope_json = ?").run(scopeJson);
  database.prepare("DELETE FROM semantic_memory_edges WHERE from_node_id IN (SELECT id FROM semantic_memory_nodes WHERE scope_json = ?)").run(scopeJson);
  database.prepare("DELETE FROM semantic_memory_nodes WHERE scope_json = ?").run(scopeJson);
}

function scopeMatches(edgeScope: SemanticMemoryScope, queryScope: SemanticMemoryScope): boolean {
  if (edgeScope.global) return true;
  if (edgeScope.project && edgeScope.project !== queryScope.project) return false;
  if (edgeScope.surface && edgeScope.surface !== queryScope.surface) return false;
  if (edgeScope.origin && edgeScope.origin !== queryScope.origin) return false;
  if (edgeScope.viewPattern && edgeScope.viewPattern !== queryScope.viewPattern) return false;
  return true;
}

function readSingleValue(database: NodeDatabaseSync, sql: string, key: string, ...values: SqlValue[]): unknown {
  return database.prepare(sql).get(...values)?.[key];
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hashJson(value: unknown): string {
  return `h${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 15)}`;
}

function readRelation(value: unknown): RedactedMemoryEdge["relation"] {
  return ["phrase_alias", "preferred_role", "preferred_region", "preferred_affordance", "usual_action", "workflow_step", "avoid_target"].includes(String(value))
    ? String(value) as RedactedMemoryEdge["relation"]
    : "phrase_alias";
}

function readSource(value: unknown): RedactedMemoryEdge["source"] {
  return ["clarification", "verified_success", "user_correction", "manual_rule", "import"].includes(String(value))
    ? String(value) as RedactedMemoryEdge["source"]
    : "verified_success";
}

function readSafetyClass(value: unknown): RedactedMemoryEdge["safetyClass"] {
  return ["safe_read", "safe_action", "risky_requires_approval", "blocked"].includes(String(value))
    ? String(value) as RedactedMemoryEdge["safetyClass"]
    : "safe_action";
}
