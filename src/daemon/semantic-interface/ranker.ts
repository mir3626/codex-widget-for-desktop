import { isHighSemanticRisk } from "./ontology.js";
import { buildSourceWarnings } from "./observation.js";
import { selectOperatingProfileForRisk } from "./operatingProfile.js";
import { safetyVerdictForHypothesis } from "./safetyPredicate.js";
import { buildTraceRecord } from "./trace.js";
import type {
  IntentFrame,
  OperatingProfile,
  RankedSemanticHypothesis,
  SemanticDecisionOutcome,
  SemanticHypothesis,
  SemanticSnapshot
} from "./types.js";

export function rankSemanticHypotheses(input: {
  hypotheses: SemanticHypothesis[];
}): RankedSemanticHypothesis[] {
  return input.hypotheses
    .map((hypothesis) => ({
      hypothesis,
      score: scoreHypothesis(hypothesis),
      featureContributions: hypothesis.features
    }))
    .sort((left, right) => right.score - left.score || left.hypothesis.id.localeCompare(right.hypothesis.id));
}

export function decideSemanticOutcome(input: {
  snapshot: SemanticSnapshot;
  intent: IntentFrame;
  hypotheses: SemanticHypothesis[];
  profile?: OperatingProfile;
  now?: Date;
}): SemanticDecisionOutcome {
  const ranked = rankSemanticHypotheses({ hypotheses: input.hypotheses });
  const selected = ranked.find((item) => item.hypothesis.disqualifiers.length === 0);
  const profile = input.profile ?? selectOperatingProfileForRisk(selected?.hypothesis.proposal.tier1Risk ?? "read_only");
  const warnings = buildSourceWarnings({
    snapshot: input.snapshot,
    now: input.now,
    maxSnapshotAgeMs: profile.requiredEvidence.maxSnapshotAgeMs
  });
  const margin = selected ? selected.score - (ranked.find((item) => item.hypothesis.id !== selected.hypothesis.id)?.score ?? 0) : 0;
  const profileFailures = selected ? evaluateProfile({ selected, ranked, profile, margin }) : ["no valid semantic hypothesis"];
  const verdicts = ranked.map((item) => ({
    hypothesisId: item.hypothesis.id,
    verdict: safetyVerdictForHypothesis({ hypothesis: item.hypothesis, snapshot: input.snapshot, intent: input.intent })
  }));
  const selectedVerdict = selected ? verdicts.find((verdict) => verdict.hypothesisId === selected.hypothesis.id)?.verdict : undefined;
  const trace = buildTraceRecord({
    snapshotId: input.snapshot.id,
    intentId: input.intent.id,
    intent: input.intent,
    ranked,
    selectedHypothesisId: profileFailures.length === 0 ? selected?.hypothesis.id : undefined,
    verdicts,
    warnings,
    now: input.now
  });

  if (!selected) {
    return { kind: "abstain", reasons: ["No valid semantic hypothesis."], trace };
  }
  if (profileFailures.length > 0) {
    return { kind: "abstain", reasons: profileFailures, trace };
  }
  if (warnings.some((warning) => warning.severity === "block")) {
    return { kind: "block", reasons: warnings.filter((warning) => warning.severity === "block").map((warning) => warning.description), trace };
  }
  if (!selectedVerdict || selectedVerdict.kind === "block") {
    return { kind: "block", reasons: selectedVerdict?.reasons ?? ["Semantic safety blocked the hypothesis."], trace };
  }
  if (selectedVerdict.kind === "confirm" || isHighSemanticRisk(selected.hypothesis.proposal.tier1Risk)) {
    return { kind: "confirm", hypothesis: selected.hypothesis, safety: selectedVerdict, trace };
  }
  return { kind: "act", hypothesis: selected.hypothesis, safety: selectedVerdict, trace };
}

function scoreHypothesis(hypothesis: SemanticHypothesis): number {
  const features = hypothesis.features;
  const score =
    (features.exactLabelMatch ?? 0) * 0.32 +
    (features.partialLabelMatch ?? 0) * 0.16 +
    (features.affordanceMatch ?? 0) * 0.24 +
    (features.roleMatch ?? 0) * 0.08 +
    (features.regionMatch ?? 0) * 0.04 +
    (features.viewportPresence ?? 0) * 0.06 +
    (features.enabled ?? 0) * 0.04 +
    (features.selectedOrFocused ?? 0) * 0.03 +
    (features.freshness ?? 0) * 0.02 +
    (features.sourceConfidence ?? 0) * 0.01 -
    (features.riskPenalty ?? 0) * 0.06 -
    hypothesis.disqualifiers.length * 0.2;
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

function evaluateProfile(input: {
  selected: RankedSemanticHypothesis;
  ranked: RankedSemanticHypothesis[];
  profile: OperatingProfile;
  margin: number;
}): string[] {
  const required = input.profile.requiredEvidence;
  const features = input.selected.hypothesis.features;
  const failures: string[] = [];
  if (required.exactOrAliasMatch && !(features.exactLabelMatch || features.partialLabelMatch)) failures.push("profile requires label or alias match");
  if (required.roleOrAffordanceMatch && !features.affordanceMatch) failures.push("profile requires affordance match");
  if (required.visibleInViewport && !features.viewportPresence) failures.push("profile requires visible target evidence");
  if (required.enabledStateKnown && features.enabled === undefined) failures.push("profile requires enabled-state evidence");
  if (required.uniqueWithinScope && input.ranked.filter((item) => Math.abs(item.score - input.selected.score) < 0.08).length > 1) failures.push("profile requires unique top candidate");
  if (required.revalidationRequired && !input.selected.hypothesis.proposal.requiresRevalidation && input.selected.hypothesis.proposal.tier1Role === "act") failures.push("profile requires revalidation for action proposals");
  if (required.minTopMargin !== undefined && input.selected.hypothesis.proposal.tier1Role === "act" && input.margin < required.minTopMargin) failures.push(`profile requires top margin >= ${required.minTopMargin}`);
  return failures;
}
