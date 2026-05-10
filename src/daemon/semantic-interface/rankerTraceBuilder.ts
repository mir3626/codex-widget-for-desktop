import type {
  AxisEvidence,
  CandidateEvidencePacket,
  GateResult,
  IntentFrame,
  OperatingProfile,
  OperatingProfileDecision,
  PairwiseMargin,
  RankedSemanticHypothesis,
  RankerTrace,
  SemanticHypothesis,
  SemanticSnapshot,
  TargetFingerprint
} from "./types.js";

export function buildRankerTrace(input: {
  snapshot: SemanticSnapshot;
  intent: IntentFrame;
  ranked: RankedSemanticHypothesis[];
  profile: OperatingProfile;
  selectedHypothesisId?: string;
  profileFailures: string[];
  outcome: RankerTrace["outcome"];
}): RankerTrace {
  const selected = input.selectedHypothesisId
    ? input.ranked.find((item) => item.hypothesis.id === input.selectedHypothesisId)
    : undefined;
  const runnerUp = selected
    ? input.ranked.find((item) => item.hypothesis.id !== selected.hypothesis.id)
    : undefined;
  const gateResults: GateResult[] = input.ranked.flatMap((item) => {
    const hardStatus = item.hypothesis.disqualifiers.length > 0 ? "fail" : "pass";
    const results: GateResult[] = [{
      candidateId: item.hypothesis.id,
      gate: "hard",
      status: hardStatus,
      reasonCodes: item.hypothesis.disqualifiers.length ? item.hypothesis.disqualifiers : ["hard_gates_passed"]
    }];
    if (item.hypothesis.id === selected?.hypothesis.id) {
      results.push({
        candidateId: item.hypothesis.id,
        gate: "operating_profile",
        status: input.profileFailures.length ? "fail" : "pass",
        reasonCodes: input.profileFailures.length ? input.profileFailures : ["operating_profile_passed"]
      });
    }
    return results;
  });
  const pairwiseMargin = selected && runnerUp
    ? buildPairwiseMargin(selected, runnerUp, input.profile)
    : undefined;
  return {
    candidateGeneration: {
      sourceSnapshotId: input.snapshot.id,
      intentFrameId: input.intent.id,
      generatorVersion: "semantic-interface.candidate-generator.v2",
      generatedCandidateIds: input.ranked.map((item) => item.hypothesis.id),
      rejectedBeforeRanking: gateResults.filter((gate) => gate.gate === "hard" && gate.status === "fail")
    },
    gateResults,
    profileDecision: operatingProfileDecision(input.profile),
    pairwiseMargin,
    selectedCandidateId: input.selectedHypothesisId,
    targetFingerprint: selected ? targetFingerprintForHypothesis(input.snapshot, selected.hypothesis) : undefined,
    outcome: input.outcome,
    reasonCodes: input.profileFailures.length ? input.profileFailures : ["ranker_decision_complete"]
  };
}

export function isExactActionableNearMiss(input: {
  selected: RankedSemanticHypothesis;
  runnerUp: RankedSemanticHypothesis;
  profile: OperatingProfile;
  margin: number;
}): boolean {
  const minTopMargin = input.profile.requiredEvidence.minTopMargin;
  if (minTopMargin === undefined) {
    return false;
  }
  if (input.margin < minTopMargin - 0.02 || input.margin < 0) {
    return false;
  }
  const selectedEvidence = input.selected.hypothesis.evidence;
  const runnerUpEvidence = input.runnerUp.hypothesis.evidence;
  const selectedExact = selectedEvidence.lexical.reasonCodes.includes("exact_label");
  const runnerPartialOnly = runnerUpEvidence.lexical.reasonCodes.includes("partial_label") && !runnerUpEvidence.lexical.reasonCodes.includes("exact_label");
  if (!selectedExact || !runnerPartialOnly) {
    return false;
  }
  if (input.selected.finalScoreBp < 8500) {
    return false;
  }
  if (selectedEvidence.lexical.scoreBp - runnerUpEvidence.lexical.scoreBp < 2500) {
    return false;
  }
  if (selectedEvidence.affordance.scoreBp <= 0 || selectedEvidence.actionability.visible.scoreBp <= 0 || selectedEvidence.actionability.enabled.scoreBp <= 0 || selectedEvidence.actionability.inViewport.scoreBp <= 0) {
    return false;
  }
  return true;
}

function operatingProfileDecision(profile: OperatingProfile): OperatingProfileDecision {
  const requiredAxes: string[] = [];
  if (profile.requiredEvidence.exactOrAliasMatch) requiredAxes.push("lexical", "alias");
  if (profile.requiredEvidence.roleOrAffordanceMatch) requiredAxes.push("affordance", "role");
  if (profile.requiredEvidence.visibleInViewport) requiredAxes.push("actionability.visible", "actionability.inViewport");
  if (profile.requiredEvidence.enabledStateKnown) requiredAxes.push("actionability.enabled");
  if (profile.requiredEvidence.revalidationRequired) requiredAxes.push("actionability.revalidation");
  return {
    profileId: profile.id,
    requiredAxes,
    minTopMarginBp: Math.round((profile.requiredEvidence.minTopMargin ?? 0) * 10000),
    selectedBy: "risk_tier",
    reasonCodes: ["risk_selected_operating_profile"]
  };
}

function buildPairwiseMargin(
  winner: RankedSemanticHypothesis,
  runnerUp: RankedSemanticHypothesis,
  profile: OperatingProfile
): PairwiseMargin {
  const axisMarginsBp = {
    lexical: axisMargin(winner.evidence.lexical, runnerUp.evidence.lexical),
    alias: axisMargin(winner.evidence.alias, runnerUp.evidence.alias),
    affordance: axisMargin(winner.evidence.affordance, runnerUp.evidence.affordance),
    role: axisMargin(winner.evidence.role, runnerUp.evidence.role),
    region: axisMargin(winner.evidence.region, runnerUp.evidence.region),
    graphRelation: axisMargin(winner.evidence.graphRelation, runnerUp.evidence.graphRelation),
    actionability: actionabilityScore(winner.evidence) - actionabilityScore(runnerUp.evidence)
  };
  const finalMarginBp = winner.finalScoreBp - runnerUp.finalScoreBp;
  const minTopMarginBp = Math.round((profile.requiredEvidence.minTopMargin ?? 0) * 10000);
  const exactActionableNearMiss = isExactActionableNearMiss({
    selected: winner,
    runnerUp,
    profile,
    margin: finalMarginBp / 10000
  });
  const sufficient = finalMarginBp >= minTopMarginBp || exactActionableNearMiss;
  return {
    winnerId: winner.hypothesis.id,
    runnerUpId: runnerUp.hypothesis.id,
    finalMarginBp,
    axisMarginsBp,
    sufficient,
    reasonCodes: sufficient
      ? [exactActionableNearMiss ? "pairwise_margin_exact_actionable_near_miss_passed" : "pairwise_margin_passed"]
      : ["pairwise_margin_too_low"]
  };
}

function targetFingerprintForHypothesis(snapshot: SemanticSnapshot, hypothesis: SemanticHypothesis): TargetFingerprint | undefined {
  const entity = snapshot.entities.find((candidate) => candidate.id === hypothesis.targetEntityId);
  if (!entity) {
    return undefined;
  }
  const evidence = entity.evidenceIds
    .map((evidenceId) => snapshot.evidence.find((item) => item.id === evidenceId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const locatorDigest = evidence.map((item) => [item.locator?.selector, item.locator?.role, item.locator?.name, item.locator?.bbox]).flat().filter(Boolean).join("|");
  return {
    surfaceId: entity.surfaceId,
    viewIdentityHash: snapshot.id,
    entityId: entity.id,
    evidenceIds: entity.evidenceIds,
    role: evidence[0]?.locator?.role ?? entity.tier2?.role,
    normalizedLabel: entity.normalizedLabel,
    affordances: entity.affordances,
    regionPath: readRegionPath(snapshot, entity.id),
    relationDigest: snapshot.relations.filter((relation) => relation.from === entity.id || relation.to === entity.id).map((relation) => `${relation.from}:${relation.type}:${relation.to}`).join("|"),
    locatorDigest,
    bboxBucket: evidence[0]?.locator?.bbox ? bboxBucket(evidence[0].locator.bbox) : undefined
  };
}

function readRegionPath(snapshot: SemanticSnapshot, entityId: string): string[] {
  const path: string[] = [];
  let current = entityId;
  for (let i = 0; i < 8; i += 1) {
    const parent = snapshot.relations.find((relation) => relation.type === "contains" && relation.to === current);
    if (!parent) break;
    path.unshift(parent.from);
    current = parent.from;
  }
  return path;
}

function bboxBucket(rect: { x: number; y: number; w: number; h: number }): string {
  return [rect.x, rect.y, rect.w, rect.h].map((value) => Math.round(value / 10) * 10).join(",");
}

function axisMargin(left: AxisEvidence, right: AxisEvidence): number {
  return left.scoreBp - right.scoreBp;
}

function actionabilityScore(evidence: CandidateEvidencePacket): number {
  return Math.round((
    evidence.actionability.visible.scoreBp +
    evidence.actionability.enabled.scoreBp +
    evidence.actionability.stable.scoreBp +
    evidence.actionability.inViewport.scoreBp +
    evidence.actionability.occlusion.scoreBp +
    evidence.actionability.adapterCapability.scoreBp +
    evidence.actionability.revalidation.scoreBp
  ) / 7);
}
