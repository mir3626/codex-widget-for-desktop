import { createHash } from "node:crypto";
import {
  REDACTED_TRACE_SCHEMA_VERSION,
  SEMANTIC_CATALOG_VERSION,
  SEMANTIC_INTERFACE_VERSION,
  SEMANTIC_PREDICATE_VERSION,
  SEMANTIC_RANKER_VERSION,
  SEMANTIC_REDACTION_POLICY_VERSION
} from "./ontology.js";
import type { RankedSemanticHypothesis, RedactedTraceRecord, SafetyVerdict, SemanticSourceWarning, TraceRecord } from "./types.js";

export function buildTraceRecord(input: {
  snapshotId: string;
  intentId: string;
  intent: unknown;
  ranked: RankedSemanticHypothesis[];
  selectedHypothesisId?: string;
  verdicts: Array<{ hypothesisId: string; verdict: SafetyVerdict }>;
  warnings?: SemanticSourceWarning[];
  now?: Date;
}): TraceRecord {
  return {
    id: `trace-${hashJson([input.snapshotId, input.intentId, input.ranked.map((item) => item.hypothesis.id)])}`,
    createdAt: (input.now ?? new Date()).toISOString(),
    snapshotId: input.snapshotId,
    intentId: input.intentId,
    intentHash: hashJson(input.intent),
    semanticInterfaceVersion: SEMANTIC_INTERFACE_VERSION,
    rankerVersion: SEMANTIC_RANKER_VERSION,
    predicateVersion: SEMANTIC_PREDICATE_VERSION,
    catalogVersion: SEMANTIC_CATALOG_VERSION,
    ranked: input.ranked.map((item) => ({
      hypothesisId: item.hypothesis.id,
      targetEntityId: item.hypothesis.targetEntityId,
      score: item.score,
      selected: item.hypothesis.id === input.selectedHypothesisId,
      featureContributions: item.featureContributions,
      explanation: item.hypothesis.explanation,
      disqualifiers: item.hypothesis.disqualifiers
    })),
    verdicts: input.verdicts,
    warnings: input.warnings ?? []
  };
}

export function redactTraceRecord(input: {
  trace: TraceRecord;
  outcome: RedactedTraceRecord["summary"]["outcome"];
  selectedHypothesisId?: string;
}): RedactedTraceRecord {
  return {
    schemaVersion: REDACTED_TRACE_SCHEMA_VERSION,
    id: input.trace.id,
    createdAt: input.trace.createdAt,
    snapshotId: input.trace.snapshotId,
    intentId: input.trace.intentId,
    intentHash: input.trace.intentHash,
    semanticInterfaceVersion: input.trace.semanticInterfaceVersion,
    redactionPolicyVersion: SEMANTIC_REDACTION_POLICY_VERSION,
    summary: {
      outcome: input.outcome,
      selectedHypothesisId: input.selectedHypothesisId,
      hypothesisCount: input.trace.ranked.length,
      warningCount: input.trace.warnings.length
    },
    ranked: input.trace.ranked.map((item) => ({
      hypothesisId: item.hypothesisId,
      targetEntityId: item.targetEntityId,
      score: item.score,
      selected: item.selected,
      explanation: item.explanation,
      disqualifiers: item.disqualifiers
    })),
    verdicts: input.trace.verdicts,
    warnings: input.trace.warnings
  };
}

export function traceContainsSecretLikeText(trace: RedactedTraceRecord): boolean {
  const text = JSON.stringify(trace).toLowerCase();
  return /(\bsecret_value\b|bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9]{16,}|(?:password|token|cookie|api[_ -]?key)\s*[:=]\s*["']?[^"',}\s]{4,}|\b(?:\d[ -]?){13,19}\b)/i.test(text);
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
