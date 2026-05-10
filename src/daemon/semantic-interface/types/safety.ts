import type { IntentFrame } from "./intent.js";
import type { SemanticHypothesis } from "./hypothesis.js";
import type { SemanticSnapshot } from "./snapshot.js";

export type SafetySubjectKind = "hypothesis" | "step" | "plan";

export interface SafetyPredicateInput {
  subjectKind: SafetySubjectKind;
  hypothesis?: SemanticHypothesis;
  hypotheses?: SemanticHypothesis[];
  snapshot: SemanticSnapshot;
  intent: IntentFrame;
  policy?: Record<string, unknown>;
}

export type SafetyVerdict =
  | { kind: "allow"; reasons: string[] }
  | { kind: "warn"; reasons: string[] }
  | { kind: "confirm"; reasons: string[] }
  | { kind: "block"; reasons: string[] };

export type SafetyPredicate = (input: SafetyPredicateInput) => SafetyVerdict;

export interface SemanticSourceWarning {
  kind: "snapshot_stale" | "source_mismatch" | "adapter_mismatch" | "redacted_evidence" | "unsupported_surface";
  severity: "info" | "warn" | "block";
  evidenceIds: string[];
  description: string;
}
