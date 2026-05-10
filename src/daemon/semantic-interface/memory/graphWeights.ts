import type { RedactedMemoryEdge } from "../types.js";
import type { SemanticFeedbackEvent, SemanticMemoryDelta } from "./types.js";

export function deltasForFeedback(event: Omit<SemanticFeedbackEvent, "memoryDelta">): SemanticMemoryDelta[] {
  const phrase = normalizeKey(event.payload.phrase ?? event.redactedUtterance);
  if (!phrase) {
    return [];
  }
  const source = sourceForFeedback(event.source);
  const safetyClass = event.payload.safetyClass ?? "safe_action";
  const deltas: SemanticMemoryDelta[] = [];

  if (event.payload.selectedTarget) {
    deltas.push({
      relation: "phrase_alias",
      fromKey: phrase,
      toKey: normalizeKey(event.payload.selectedTarget),
      deltaBp: event.source === "verified_success" ? 350 : 1800,
      source,
      safetyClass
    });
  }
  if (event.payload.correctedTarget) {
    deltas.push({
      relation: "phrase_alias",
      fromKey: phrase,
      toKey: normalizeKey(event.payload.correctedTarget),
      deltaBp: 2200,
      source: "user_correction",
      safetyClass
    });
  }
  if (event.payload.rejectedTarget) {
    deltas.push({
      relation: "avoid_target",
      fromKey: phrase,
      toKey: normalizeKey(event.payload.rejectedTarget),
      deltaBp: 2500,
      source: "user_correction",
      safetyClass
    });
  }
  if (event.payload.preferredRole) {
    deltas.push({
      relation: "preferred_role",
      fromKey: phrase,
      toKey: normalizeKey(event.payload.preferredRole),
      deltaBp: event.source === "verified_success" ? 200 : 1200,
      source,
      safetyClass
    });
  }
  if (event.payload.preferredRegion) {
    deltas.push({
      relation: "preferred_region",
      fromKey: phrase,
      toKey: normalizeKey(event.payload.preferredRegion),
      deltaBp: event.source === "verified_success" ? 200 : 1200,
      source,
      safetyClass
    });
  }
  if (event.payload.preferredAffordance) {
    deltas.push({
      relation: "preferred_affordance",
      fromKey: phrase,
      toKey: event.payload.preferredAffordance,
      deltaBp: event.source === "verified_success" ? 250 : 1300,
      source,
      safetyClass
    });
  }
  if (event.payload.action) {
    deltas.push({
      relation: "usual_action",
      fromKey: phrase,
      toKey: normalizeKey(event.payload.action),
      deltaBp: event.source === "verified_success" ? 250 : 1100,
      source,
      safetyClass
    });
  }

  if (event.source === "verification_failure") {
    return deltas.map((delta) => ({ ...delta, deltaBp: -Math.max(900, Math.abs(delta.deltaBp)) }));
  }
  return deltas.filter((delta) => delta.toKey);
}

export function applyWeightDelta(currentBp: number, deltaBp: number): number {
  return Math.max(-10000, Math.min(10000, Math.round(currentBp + deltaBp)));
}

export function edgePolarity(deltaBp: number): { positive: number; negative: number } {
  return deltaBp >= 0 ? { positive: 1, negative: 0 } : { positive: 0, negative: 1 };
}

export function normalizeKey(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 240);
}

function sourceForFeedback(source: SemanticFeedbackEvent["source"]): RedactedMemoryEdge["source"] {
  if (source === "clarification_selected") return "clarification";
  if (source === "user_correction" || source === "verification_failure") return "user_correction";
  if (source === "manual_rule") return "manual_rule";
  return "verified_success";
}
