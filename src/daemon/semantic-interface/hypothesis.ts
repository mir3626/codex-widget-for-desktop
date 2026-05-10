import { compactSemanticText, hashSemanticParts, normalizeSemanticText } from "./ontology.js";
import { expandSemanticAliases } from "./lexicon/index.js";
import type {
  AxisEvidence,
  CandidateEvidencePacket,
  ExecutableCommandProposal,
  IntentFrame,
  IntentStep,
  ReferenceExpression,
  SemanticAffordance,
  SemanticEntity,
  SemanticHypothesis,
  SemanticSnapshot,
  SemanticTier1Risk,
  VerificationClaim
} from "./types.js";

export function buildSemanticHypotheses(input: {
  snapshot: SemanticSnapshot;
  intent: IntentFrame;
}): SemanticHypothesis[] {
  const hypotheses: SemanticHypothesis[] = [];
  for (const step of input.intent.steps) {
    if (step.desiredAffordance === "read" && !step.reference) {
      hypotheses.push(buildSurfaceReadHypothesis(input.snapshot, input.intent, step));
      continue;
    }
    for (const entity of input.snapshot.entities) {
      if (entity.kind === "surface" && step.desiredAffordance !== "read") {
        continue;
      }
      const evidence = scoreEntityForStep(entity, step);
      if (maxFeatureScore(evidence) <= 500 && step.reference) {
        continue;
      }
      hypotheses.push(buildEntityHypothesis(input.snapshot, input.intent, step, entity, evidence));
    }
  }
  return hypotheses;
}

export function scoreEntityForStep(entity: SemanticEntity, step: IntentStep): CandidateEvidencePacket {
  const reference = step.reference;
  const label = entity.normalizedLabel || normalizeSemanticText(entity.label);
  const compactLabel = compactSemanticText(label);
  const normalizedReference = reference?.normalized ?? "";
  const aliases = expandSemanticAliases(normalizedReference);
  const exact = Boolean(reference && label && aliases.some((alias) => label === alias || compactLabel === compactSemanticText(alias)));
  const partial = Boolean(reference && label && normalizedReference && aliases.some((alias) => label.includes(alias) || alias.includes(label) || compactLabel.includes(compactSemanticText(alias)) || compactSemanticText(alias).includes(compactLabel)));
  const affordanceMatch = entity.affordances.includes(step.desiredAffordance) || isCompatibleAffordance(entity.affordances, step.desiredAffordance);
  const entityKindMatch = reference?.hints?.entityKinds?.includes(entity.kind) ? 1 : undefined;
  const evidenceIds = entity.evidenceIds;
  const visible = entity.state?.visible !== false;
  const enabled = entity.state?.disabled !== true;
  return {
    lexical: axis(exact ? 10000 : partial ? 7200 : 0, evidenceIds, exact ? "exact_label" : partial ? "partial_label" : "no_label_match"),
    alias: axis(exact || partial ? 8000 : 0, evidenceIds, exact || partial ? "alias_or_normalized_match" : "no_alias_match"),
    affordance: axis(affordanceMatch ? 10000 : 0, evidenceIds, affordanceMatch ? "affordance_match" : "wrong_affordance"),
    role: axis(readRoleMatch(entity, reference) ? 10000 : 0, evidenceIds, "role_or_hint_match"),
    entityKind: axis(entityKindMatch ? 10000 : 0, evidenceIds, entityKindMatch ? "entity_kind_match" : "entity_kind_unspecified"),
    region: axis(entityKindMatch ? 8000 : 0, evidenceIds, entityKindMatch ? "region_hint_match" : "region_unspecified"),
    graphRelation: axis(0, evidenceIds, "graph_relation_unavailable"),
    viewFreshness: axis(10000, evidenceIds, "fresh_view"),
    focus: axis(entity.state?.selected || entity.state?.focused ? 10000 : 0, evidenceIds, entity.state?.focused ? "focused" : entity.state?.selected ? "selected" : "not_focused"),
    actionability: {
      visible: axis(visible ? 10000 : 0, evidenceIds, visible ? "visible" : "not_visible"),
      enabled: axis(enabled ? 10000 : 0, evidenceIds, enabled ? "enabled" : "disabled"),
      stable: axis(9000, evidenceIds, "assumed_stable"),
      inViewport: axis(visible ? 10000 : 0, evidenceIds, visible ? "in_viewport" : "not_in_viewport"),
      occlusion: axis(visible ? 9000 : 0, evidenceIds, visible ? "not_known_occluded" : "hidden_or_occluded"),
      adapterCapability: axis(10000, evidenceIds, "adapter_capability_checked_later"),
      revalidation: axis(10000, evidenceIds, "revalidation_available_or_not_required")
    },
    risk: axis(0, evidenceIds, "risk_separate_from_reference_confidence"),
    ambiguity: axis(0, evidenceIds, "ambiguity_evaluated_by_margin")
  };
}

function buildSurfaceReadHypothesis(snapshot: SemanticSnapshot, intent: IntentFrame, step: IntentStep): SemanticHypothesis {
  const surface = snapshot.entities.find((entity) => entity.kind === "surface") ?? snapshot.entities[0];
  const evidence = scoreEntityForStep(surface, step);
  evidence.affordance = axis(10000, surface.evidenceIds, "surface_read");
  evidence.actionability.visible = axis(10000, surface.evidenceIds, "surface_visible");
  evidence.actionability.enabled = axis(10000, surface.evidenceIds, "surface_enabled");
  evidence.viewFreshness = axis(10000, surface.evidenceIds, "fresh_view");
  return buildEntityHypothesis(snapshot, intent, step, surface, evidence);
}

function buildEntityHypothesis(
  snapshot: SemanticSnapshot,
  intent: IntentFrame,
  step: IntentStep,
  entity: SemanticEntity,
  evidence: CandidateEvidencePacket
): SemanticHypothesis {
  const proposal = buildProposal(entity, step);
  return {
    id: `hyp-${hashSemanticParts([intent.id, step.id, entity.id, step.desiredAffordance])}`,
    intentId: intent.id,
    stepId: step.id,
    targetEntityId: entity.id,
    targetEvidenceIds: entity.evidenceIds,
    affordance: step.desiredAffordance,
    proposal,
    expectedVerification: step.expectedOutcome ?? buildDefaultVerification(entity, step),
    evidence,
    explanation: buildExplanation(entity, step, evidence),
    disqualifiers: readInitialDisqualifiers(snapshot, entity, step, proposal)
  };
}

function buildProposal(entity: SemanticEntity, step: IntentStep): ExecutableCommandProposal {
  const risk = highestRisk(step.riskBudget, entity.tier1?.risk ?? "read_only");
  return {
    kind: commandKindForAffordance(step.desiredAffordance),
    tier1Risk: risk,
    tier1Role: step.desiredAffordance === "read" || step.desiredAffordance === "locate" ? "locate" : "act",
    payload: {
      affordance: step.desiredAffordance,
      reference: step.reference?.raw,
      entityLabel: entity.label
    },
    targetLocator: {
      evidenceId: entity.evidenceIds[0],
      entityId: entity.id,
      opaque: entity.tier2
    },
    requiresRevalidation: risk !== "read_only"
  };
}

function commandKindForAffordance(affordance: SemanticAffordance): string {
  if (affordance === "read" || affordance === "locate") return "browser.read";
  if (affordance === "type") return "browser.type";
  if (affordance === "navigate") return "browser.navigate";
  if (affordance === "submit") return "browser.submit";
  return "browser.click";
}

function buildDefaultVerification(entity: SemanticEntity, step: IntentStep): VerificationClaim {
  return {
    kind: step.desiredAffordance === "navigate" ? "url_changed" : "entity_state",
    entityId: entity.id,
    description: `Verify ${step.desiredAffordance} on ${entity.label ?? entity.id}.`
  };
}

function buildExplanation(entity: SemanticEntity, step: IntentStep, packet: CandidateEvidencePacket): string {
  const reasons = [];
  if (packet.lexical.reasonCodes.includes("exact_label")) reasons.push("exact label");
  if (packet.lexical.reasonCodes.includes("partial_label")) reasons.push("partial label");
  if (packet.affordance.scoreBp > 0) reasons.push("affordance");
  if (packet.focus.scoreBp > 0) reasons.push("selected/focused");
  return `${entity.kind} ${entity.label ?? entity.id} matched ${step.desiredAffordance}${reasons.length ? ` via ${reasons.join(", ")}` : ""}.`;
}

function readInitialDisqualifiers(
  snapshot: SemanticSnapshot,
  entity: SemanticEntity,
  step: IntentStep,
  proposal: ExecutableCommandProposal
): string[] {
  const disqualifiers: string[] = [];
  if (entity.state?.visible === false) disqualifiers.push("target is not visible");
  if (entity.state?.disabled === true) disqualifiers.push("target is disabled");
  if (!entity.affordances.includes(step.desiredAffordance) && !isCompatibleAffordance(entity.affordances, step.desiredAffordance)) {
    disqualifiers.push("wrong affordance for requested step");
  }
  if (proposal.requiresRevalidation && !snapshot.capabilities.revalidateBeforeExecute) {
    disqualifiers.push("adapter cannot revalidate before execution");
  }
  if (proposal.tier1Role === "act" && !snapshot.capabilities.execute) {
    disqualifiers.push("adapter cannot execute action proposals");
  }
  return disqualifiers;
}

function readRoleMatch(entity: SemanticEntity, reference: ReferenceExpression | undefined): number | undefined {
  const expected = reference?.hints?.affordances;
  if (!expected?.length) return undefined;
  return expected.some((affordance) => entity.affordances.includes(affordance) || isCompatibleAffordance(entity.affordances, affordance)) ? 1 : 0;
}

function maxFeatureScore(evidence: CandidateEvidencePacket): number {
  return Math.max(
    evidence.lexical.scoreBp,
    evidence.alias.scoreBp,
    evidence.affordance.scoreBp,
    evidence.role.scoreBp,
    evidence.entityKind.scoreBp,
    evidence.region.scoreBp,
    evidence.graphRelation.scoreBp,
    evidence.focus.scoreBp,
    evidence.actionability.visible.scoreBp,
    evidence.actionability.enabled.scoreBp,
    evidence.actionability.inViewport.scoreBp
  );
}

function isCompatibleAffordance(affordances: SemanticAffordance[], desired: SemanticAffordance): boolean {
  if (desired === "filter") return affordances.includes("activate");
  if (desired === "activate") return affordances.includes("filter") || affordances.includes("navigate");
  if (desired === "read") return affordances.includes("locate");
  return false;
}

function highestRisk(left: SemanticTier1Risk, right: SemanticTier1Risk): SemanticTier1Risk {
  const order: SemanticTier1Risk[] = [
    "read_only",
    "local_navigation",
    "external_navigation",
    "input_non_submitting",
    "state_change",
    "submit_or_publish",
    "destructive",
    "credential_or_payment",
    "code_execution",
    "data_exfiltration"
  ];
  return order.indexOf(left) >= order.indexOf(right) ? left : right;
}

function axis(scoreBp: number, evidenceIds: string[], reasonCode: string): AxisEvidence {
  const bounded = Math.max(0, Math.min(10000, Math.round(scoreBp)));
  return {
    scoreBp: bounded,
    status: bounded > 0 ? "present" : "missing",
    evidenceIds,
    reasonCodes: [reasonCode]
  };
}
