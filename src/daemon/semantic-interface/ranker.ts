import { isHighSemanticRisk } from "./ontology.js";
import { buildSourceWarnings } from "./observation.js";
import { selectOperatingProfileForRisk } from "./operatingProfile.js";
import {
  buildRankerTrace,
  isExactActionableNearMiss
} from "./rankerTraceBuilder.js";
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
    .map((hypothesis) => {
      const finalScoreBp = scoreHypothesisBp(hypothesis);
      hypothesis.finalScoreBp = finalScoreBp;
      return {
        hypothesis,
        score: finalScoreBp / 10000,
        finalScoreBp,
        evidence: hypothesis.evidence
      };
    })
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
  const selectedHypothesisId = profileFailures.length === 0 ? selected?.hypothesis.id : undefined;
  const rankerTrace = buildRankerTrace({
    snapshot: input.snapshot,
    intent: input.intent,
    ranked,
    profile,
    selectedHypothesisId,
    profileFailures,
    outcome: selectedHypothesisId ? "act" : profileFailures.some((reason) => /requires|ambiguous|unique|margin/i.test(reason)) ? "clarify" : "abstain"
  });
  const trace = buildTraceRecord({
    snapshotId: input.snapshot.id,
    intentId: input.intent.id,
    intent: input.intent,
    ranked,
    selectedHypothesisId,
    rankerTrace,
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

function scoreHypothesisBp(hypothesis: SemanticHypothesis): number {
  const evidence = hypothesis.evidence;
  const scoreBp =
    evidence.lexical.scoreBp * 0.28 +
    evidence.alias.scoreBp * 0.12 +
    evidence.affordance.scoreBp * 0.24 +
    evidence.role.scoreBp * 0.06 +
    evidence.entityKind.scoreBp * 0.04 +
    evidence.region.scoreBp * 0.04 +
    evidence.graphRelation.scoreBp * 0.04 +
    evidence.actionability.visible.scoreBp * 0.05 +
    evidence.actionability.enabled.scoreBp * 0.04 +
    evidence.actionability.stable.scoreBp * 0.02 +
    evidence.actionability.inViewport.scoreBp * 0.03 +
    evidence.focus.scoreBp * 0.03 +
    evidence.viewFreshness.scoreBp * 0.02 +
    (evidence.memory?.phraseAlias.scoreBp ?? 0) * 0.02 +
    (evidence.memory?.preferredRole.scoreBp ?? 0) * 0.02 +
    (evidence.memory?.preferredRegion.scoreBp ?? 0) * 0.01 +
    (evidence.memory?.usualAction.scoreBp ?? 0) * 0.01 -
    evidence.risk.scoreBp * 0.04 -
    evidence.ambiguity.scoreBp * 0.03 -
    hypothesis.disqualifiers.length * 2000;
  return Math.max(0, Math.min(10000, Math.round(scoreBp)));
}

function evaluateProfile(input: {
  selected: RankedSemanticHypothesis;
  ranked: RankedSemanticHypothesis[];
  profile: OperatingProfile;
  margin: number;
}): string[] {
  const required = input.profile.requiredEvidence;
  const evidence = input.selected.hypothesis.evidence;
  const failures: string[] = [];
  const runnerUp = input.ranked.find((item) => item.hypothesis.id !== input.selected.hypothesis.id);
  const exactActionableNearMiss = runnerUp
    ? isExactActionableNearMiss({ selected: input.selected, runnerUp, profile: input.profile, margin: input.margin })
    : false;
  if (required.exactOrAliasMatch && evidence.lexical.scoreBp <= 0 && evidence.alias.scoreBp <= 0) failures.push("profile requires label or alias match");
  if (required.roleOrAffordanceMatch && evidence.affordance.scoreBp <= 0) failures.push("profile requires affordance match");
  if (required.visibleInViewport && evidence.actionability.visible.scoreBp <= 0) failures.push("profile requires visible target evidence");
  if (required.enabledStateKnown && evidence.actionability.enabled.status === "missing") failures.push("profile requires enabled-state evidence");
  if (required.uniqueWithinScope && input.ranked.filter((item) => Math.abs(item.score - input.selected.score) < 0.08).length > 1 && !exactActionableNearMiss) failures.push("profile requires unique top candidate");
  if (required.revalidationRequired && !input.selected.hypothesis.proposal.requiresRevalidation && input.selected.hypothesis.proposal.tier1Role === "act") failures.push("profile requires revalidation for action proposals");
  if (required.minTopMargin !== undefined && input.selected.hypothesis.proposal.tier1Role === "act" && input.margin < required.minTopMargin && !exactActionableNearMiss) failures.push(`profile requires top margin >= ${required.minTopMargin}`);
  return failures;
}
