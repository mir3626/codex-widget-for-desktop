import { randomUUID } from "node:crypto";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type { SemanticMemoryScope } from "../types.js";
import { applyWeightDelta, edgePolarity } from "./graphWeights.js";
import type { SemanticMemoryDelta } from "./types.js";

export function applyDelta(database: NodeDatabaseSync, scope: SemanticMemoryScope, delta: SemanticMemoryDelta, at: string): void {
  const fromNodeId = ensureNode(database, "phrase", delta.fromKey, delta.fromKey, scope, at);
  const toNodeId = ensureNode(database, delta.relation, delta.toKey, delta.toKey, scope, at);
  const existing = database.prepare(`
    SELECT id, weight_bp, evidence_count, positive_count, negative_count
    FROM semantic_memory_edges
    WHERE from_node_id = ? AND to_node_id = ? AND relation = ?
  `).get(fromNodeId, toNodeId, delta.relation);
  const polarity = edgePolarity(delta.deltaBp);
  if (existing) {
    database.prepare(`
      UPDATE semantic_memory_edges
      SET weight_bp = ?, evidence_count = evidence_count + 1, positive_count = positive_count + ?,
          negative_count = negative_count + ?, source = ?, safety_class = ?, last_used_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      applyWeightDelta(Number(existing.weight_bp), delta.deltaBp),
      polarity.positive,
      polarity.negative,
      delta.source,
      delta.safetyClass,
      at,
      at,
      String(existing.id)
    );
    return;
  }
  database.prepare(`
    INSERT INTO semantic_memory_edges
      (id, from_node_id, to_node_id, relation, weight_bp, evidence_count, positive_count, negative_count, source, safety_class, last_used_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `sem-edge-${randomUUID()}`,
    fromNodeId,
    toNodeId,
    delta.relation,
    applyWeightDelta(0, delta.deltaBp),
    polarity.positive,
    polarity.negative,
    delta.source,
    delta.safetyClass,
    at,
    at,
    at
  );
}

function ensureNode(database: NodeDatabaseSync, kind: string, key: string, label: string, scope: SemanticMemoryScope, at: string): string {
  const scopeJson = JSON.stringify(scope);
  const existing = database.prepare("SELECT id FROM semantic_memory_nodes WHERE kind = ? AND key = ? AND scope_json = ?").get(kind, key, scopeJson);
  if (typeof existing?.id === "string") {
    database.prepare("UPDATE semantic_memory_nodes SET updated_at = ? WHERE id = ?").run(at, existing.id);
    return existing.id;
  }
  const id = `sem-node-${randomUUID()}`;
  database.prepare(`
    INSERT INTO semantic_memory_nodes (id, kind, key, label, scope_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, kind, key, label, scopeJson, at, at);
  return id;
}
