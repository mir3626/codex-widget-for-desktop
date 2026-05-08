import type { SemanticDecisionOutcome } from "../types.js";

export function assertSemanticOutcomeKind(outcome: SemanticDecisionOutcome, expected: SemanticDecisionOutcome["kind"], label: string): void {
  if (outcome.kind !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${outcome.kind}`);
  }
}

export function assertSelectedEntity(outcome: SemanticDecisionOutcome, expectedEntityId: string, label: string): void {
  if (outcome.kind !== "act" && outcome.kind !== "confirm") {
    throw new Error(`${label}: no selected hypothesis in ${outcome.kind}`);
  }
  if (outcome.hypothesis.targetEntityId !== expectedEntityId) {
    throw new Error(`${label}: expected ${expectedEntityId}, got ${outcome.hypothesis.targetEntityId}`);
  }
}
