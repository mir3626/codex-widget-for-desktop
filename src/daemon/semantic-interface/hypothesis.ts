import { compactSemanticText, hashSemanticParts, normalizeSemanticText } from "./ontology.js";
import { expandSemanticAliases } from "./lexicon/index.js";
import type {
  DeterministicFeatures,
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
      const features = scoreEntityForStep(entity, step);
      if (maxFeatureScore(features) <= 0.05 && step.reference) {
        continue;
      }
      hypotheses.push(buildEntityHypothesis(input.snapshot, input.intent, step, entity, features));
    }
  }
  return hypotheses;
}

export function scoreEntityForStep(entity: SemanticEntity, step: IntentStep): DeterministicFeatures {
  const reference = step.reference;
  const label = entity.normalizedLabel || normalizeSemanticText(entity.label);
  const compactLabel = compactSemanticText(label);
  const normalizedReference = reference?.normalized ?? "";
  const compactReference = compactSemanticText(normalizedReference);
  const aliases = expandSemanticAliases(normalizedReference);
  const exact = Boolean(reference && label && aliases.some((alias) => label === alias || compactLabel === compactSemanticText(alias)));
  const partial = Boolean(reference && label && normalizedReference && aliases.some((alias) => label.includes(alias) || alias.includes(label) || compactLabel.includes(compactSemanticText(alias)) || compactSemanticText(alias).includes(compactLabel)));
  const affordanceMatch = entity.affordances.includes(step.desiredAffordance) || isCompatibleAffordance(entity.affordances, step.desiredAffordance);
  const entityKindMatch = reference?.hints?.entityKinds?.includes(entity.kind) ? 1 : undefined;
  return {
    exactLabelMatch: exact ? 1 : 0,
    partialLabelMatch: exact ? 0 : partial ? 0.72 : 0,
    affordanceMatch: affordanceMatch ? 1 : 0,
    roleMatch: readRoleMatch(entity, reference),
    regionMatch: entityKindMatch,
    viewportPresence: entity.state?.visible === false ? 0 : 1,
    enabled: entity.state?.disabled === true ? 0 : 1,
    selectedOrFocused: entity.state?.selected || entity.state?.focused ? 1 : 0,
    freshness: 1,
    sourceConfidence: readEntityConfidence(entity)
  };
}

function buildSurfaceReadHypothesis(snapshot: SemanticSnapshot, intent: IntentFrame, step: IntentStep): SemanticHypothesis {
  const surface = snapshot.entities.find((entity) => entity.kind === "surface") ?? snapshot.entities[0];
  const features: DeterministicFeatures = {
    affordanceMatch: 1,
    viewportPresence: 1,
    enabled: 1,
    freshness: 1,
    sourceConfidence: 0.9
  };
  return buildEntityHypothesis(snapshot, intent, step, surface, features);
}

function buildEntityHypothesis(
  snapshot: SemanticSnapshot,
  intent: IntentFrame,
  step: IntentStep,
  entity: SemanticEntity,
  features: DeterministicFeatures
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
    features,
    explanation: buildExplanation(entity, step, features),
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

function buildExplanation(entity: SemanticEntity, step: IntentStep, features: DeterministicFeatures): string {
  const evidence = [];
  if (features.exactLabelMatch) evidence.push("exact label");
  if (features.partialLabelMatch) evidence.push("partial label");
  if (features.affordanceMatch) evidence.push("affordance");
  if (features.selectedOrFocused) evidence.push("selected/focused");
  return `${entity.kind} ${entity.label ?? entity.id} matched ${step.desiredAffordance}${evidence.length ? ` via ${evidence.join(", ")}` : ""}.`;
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

function readEntityConfidence(entity: SemanticEntity): number {
  return entity.evidenceIds.length > 0 ? 0.85 : 0.65;
}

function maxFeatureScore(features: DeterministicFeatures): number {
  return Math.max(...Object.values(features).filter((value): value is number => typeof value === "number"));
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
