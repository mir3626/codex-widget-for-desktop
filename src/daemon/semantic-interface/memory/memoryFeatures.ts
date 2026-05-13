import type {
  AxisEvidence,
  MemoryContributionEvidence,
  MemoryReadSet,
  SemanticHypothesis,
  SemanticMemoryFeatures
} from "../types.js";
import { normalizeKey } from "./graphWeights.js";

export function semanticMemoryFeaturesForHypothesis(input: {
  memoryReadSet: MemoryReadSet;
  hypothesis: SemanticHypothesis;
}): SemanticMemoryFeatures {
  const label = normalizeKey(String(input.hypothesis.proposal.payload && typeof input.hypothesis.proposal.payload === "object"
    ? (input.hypothesis.proposal.payload as { entityLabel?: string }).entityLabel ?? ""
    : ""));
  const role = normalizeKey(String(input.hypothesis.proposal.targetLocator?.opaque && typeof input.hypothesis.proposal.targetLocator.opaque === "object"
    ? (input.hypothesis.proposal.targetLocator.opaque as { role?: string }).role ?? ""
    : ""));
  const region = normalizeKey(String(input.hypothesis.proposal.targetLocator?.opaque && typeof input.hypothesis.proposal.targetLocator.opaque === "object"
    ? (input.hypothesis.proposal.targetLocator.opaque as { regionRole?: string }).regionRole ?? ""
    : ""));
  let phraseAliasBp = 0;
  let conceptAliasBp = 0;
  let preferredRoleBp = 0;
  let preferredRegionBp = 0;
  let preferredAffordanceBp = 0;
  let usualActionBp = 0;
  let workflowStepBp = 0;
  let avoidTargetPenaltyBp = 0;
  let evidenceCount = 0;
  let contradictionPenaltyBp = 0;
  const reasonCodes = new Set<string>();

  for (const edge of input.memoryReadSet.edges) {
    const targetMatches = !label || edge.toKey === label || label.includes(edge.toKey) || edge.toKey.includes(label);
    const roleMatches = role && edge.toKey === role;
    const positiveWeight = Math.max(0, edge.weightBp);
    const negativeWeight = Math.max(0, -edge.weightBp);
    evidenceCount += edge.evidenceCount;
    if (edge.relation === "phrase_alias" && targetMatches) {
      phraseAliasBp = Math.max(phraseAliasBp, positiveWeight);
      reasonCodes.add("memory_phrase_alias");
    }
    if (edge.relation === "preferred_role" && roleMatches) {
      preferredRoleBp = Math.max(preferredRoleBp, positiveWeight);
      reasonCodes.add("memory_preferred_role");
    }
    if (edge.relation === "preferred_region" && region && edge.toKey === region) {
      preferredRegionBp = Math.max(preferredRegionBp, positiveWeight);
      reasonCodes.add("memory_preferred_region");
    }
    if (edge.relation === "preferred_affordance" && edge.toKey === input.hypothesis.affordance) {
      preferredAffordanceBp = Math.max(preferredAffordanceBp, positiveWeight);
      reasonCodes.add("memory_preferred_affordance");
    }
    if (edge.relation === "usual_action" && input.hypothesis.proposal.kind.includes(edge.toKey)) {
      usualActionBp = Math.max(usualActionBp, positiveWeight);
      reasonCodes.add("memory_usual_action");
    }
    if (edge.relation === "workflow_step") {
      workflowStepBp = Math.max(workflowStepBp, positiveWeight);
      reasonCodes.add("memory_workflow_step");
    }
    if (edge.relation === "avoid_target" && targetMatches) {
      avoidTargetPenaltyBp = Math.max(avoidTargetPenaltyBp, positiveWeight || negativeWeight);
      contradictionPenaltyBp = Math.max(contradictionPenaltyBp, positiveWeight || negativeWeight);
      reasonCodes.add("memory_avoid_target");
    }
    if (negativeWeight > 0 && edge.relation !== "avoid_target") {
      contradictionPenaltyBp = Math.max(contradictionPenaltyBp, negativeWeight);
      reasonCodes.add("memory_contradiction");
    }
    if (edge.relation === "phrase_alias" && !targetMatches) {
      conceptAliasBp = Math.max(conceptAliasBp, Math.round(positiveWeight * 0.2));
    }
  }

  return {
    readSetId: input.memoryReadSet.id,
    phraseAliasBp: clampBp(phraseAliasBp),
    conceptAliasBp: clampBp(conceptAliasBp),
    preferredRoleBp: clampBp(preferredRoleBp),
    preferredRegionBp: clampBp(preferredRegionBp),
    preferredAffordanceBp: clampBp(preferredAffordanceBp),
    usualActionBp: clampBp(usualActionBp),
    workflowStepBp: clampBp(workflowStepBp),
    avoidTargetPenaltyBp: clampBp(avoidTargetPenaltyBp),
    scopeStrengthBp: input.memoryReadSet.edges.length ? 7000 : 0,
    evidenceCountBp: clampBp(evidenceCount * 1000),
    recencyBp: input.memoryReadSet.edges.length ? 5000 : 0,
    contradictionPenaltyBp: clampBp(contradictionPenaltyBp),
    reasonCodes: [...reasonCodes].sort()
  };
}

export function applySemanticMemoryToHypotheses(input: {
  hypotheses: SemanticHypothesis[];
  memoryReadSet?: MemoryReadSet;
}): SemanticHypothesis[] {
  if (!input.memoryReadSet || input.memoryReadSet.edges.length === 0) {
    return input.hypotheses;
  }
  return input.hypotheses.map((hypothesis) => {
    if (hypothesis.disqualifiers.length > 0) {
      return hypothesis;
    }
    const features = semanticMemoryFeaturesForHypothesis({ memoryReadSet: input.memoryReadSet!, hypothesis });
    const memory = memoryContributionEvidence(input.memoryReadSet!, features);
    return {
      ...hypothesis,
      evidence: {
        ...hypothesis.evidence,
        memory,
        ambiguity: mergeAxisPenalty(hypothesis.evidence.ambiguity, features.contradictionPenaltyBp)
      }
    };
  });
}

function memoryContributionEvidence(readSet: MemoryReadSet, features: SemanticMemoryFeatures): MemoryContributionEvidence {
  return {
    phraseAlias: axis(features.phraseAliasBp || features.conceptAliasBp, readSet.id, features.reasonCodes.includes("memory_phrase_alias") ? "memory_phrase_alias" : "memory_concept_alias"),
    preferredRole: axis(features.preferredRoleBp, readSet.id, "memory_preferred_role"),
    preferredRegion: axis(features.preferredRegionBp, readSet.id, "memory_preferred_region"),
    usualAction: axis(Math.max(features.usualActionBp, features.preferredAffordanceBp, features.workflowStepBp), readSet.id, "memory_usual_action"),
    avoidTarget: axis(features.avoidTargetPenaltyBp, readSet.id, "memory_avoid_target"),
    scopeStrength: axis(features.scopeStrengthBp, readSet.id, "memory_scope_strength"),
    readSetId: readSet.id
  };
}

function mergeAxisPenalty(axisEvidence: AxisEvidence, penaltyBp: number): AxisEvidence {
  if (penaltyBp <= 0) {
    return axisEvidence;
  }
  return {
    ...axisEvidence,
    scoreBp: Math.max(axisEvidence.scoreBp, clampBp(penaltyBp)),
    status: "conflict",
    reasonCodes: [...new Set([...axisEvidence.reasonCodes, "memory_contradiction"])]
  };
}

function axis(scoreBp: number, readSetId: string, reasonCode: string): AxisEvidence {
  const bounded = clampBp(scoreBp);
  return {
    scoreBp: bounded,
    status: bounded > 0 ? "present" : "missing",
    evidenceIds: [readSetId],
    reasonCodes: [reasonCode]
  };
}

function clampBp(value: number): number {
  return Math.max(0, Math.min(10000, Math.round(value)));
}
