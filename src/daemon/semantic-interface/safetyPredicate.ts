import { isHighSemanticRisk } from "./ontology.js";
import type { SafetyPredicate, SafetyVerdict, SemanticHypothesis } from "./types.js";

export const defaultSemanticSafetyPredicate: SafetyPredicate = (input) => {
  const hypothesis = input.hypothesis;
  if (!hypothesis) {
    return { kind: "block", reasons: ["No hypothesis provided to safety predicate."] };
  }
  if (hypothesis.disqualifiers.length > 0) {
    return { kind: "block", reasons: hypothesis.disqualifiers };
  }
  if (isHighSemanticRisk(hypothesis.proposal.tier1Risk)) {
    return { kind: "confirm", reasons: [`High-risk semantic action requires confirmation: ${hypothesis.proposal.tier1Risk}`] };
  }
  if (hypothesis.proposal.tier1Role === "act" && !input.snapshot.capabilities.execute) {
    return { kind: "block", reasons: ["Adapter cannot execute this action."] };
  }
  if (hypothesis.proposal.tier1Risk === "state_change" || hypothesis.proposal.tier1Risk === "input_non_submitting") {
    return { kind: "warn", reasons: [`Low-risk side-effect action: ${hypothesis.proposal.tier1Risk}`] };
  }
  return { kind: "allow", reasons: ["Semantic safety predicate allowed the hypothesis."] };
};

export function composeSafetyVerdicts(verdicts: SafetyVerdict[]): SafetyVerdict {
  const order: SafetyVerdict["kind"][] = ["allow", "warn", "confirm", "block"];
  const strictest = verdicts.reduce((current, verdict) => order.indexOf(verdict.kind) > order.indexOf(current.kind) ? verdict : current, verdicts[0] ?? { kind: "allow", reasons: [] });
  return {
    kind: strictest.kind,
    reasons: [...new Set(verdicts.flatMap((verdict) => verdict.reasons))]
  } as SafetyVerdict;
}

export function safetyVerdictForHypothesis(input: {
  hypothesis: SemanticHypothesis;
  snapshot: Parameters<SafetyPredicate>[0]["snapshot"];
  intent: Parameters<SafetyPredicate>[0]["intent"];
  predicates?: SafetyPredicate[];
}): SafetyVerdict {
  const predicates = input.predicates?.length ? input.predicates : [defaultSemanticSafetyPredicate];
  return composeSafetyVerdicts(predicates.map((predicate) => predicate({
    subjectKind: "hypothesis",
    hypothesis: input.hypothesis,
    snapshot: input.snapshot,
    intent: input.intent
  })));
}
