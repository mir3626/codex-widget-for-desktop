import { DEFAULT_SEMANTIC_CAPABILITIES } from "./observation.js";
import type { SemanticHypothesis, SemanticSnapshot, SemanticSourceWarning, StepTransitionGrammar } from "./types.js";

export const defaultStepTransitionGrammar: StepTransitionGrammar = {
  id: "default-step-transition-grammar",
  version: "0.1.0",
  validate(input) {
    const disqualifiers: string[] = [];
    const warnings: SemanticSourceWarning[] = [];
    const hypothesis = input.hypothesis;
    const capabilities = input.snapshot.capabilities ?? DEFAULT_SEMANTIC_CAPABILITIES;
    const targetEntity = hypothesis.targetEntityId
      ? input.snapshot.entities.find((entity) => entity.id === hypothesis.targetEntityId)
      : undefined;

    if (!input.intent.steps.some((step) => step.id === hypothesis.stepId)) {
      disqualifiers.push("hypothesis step does not exist on intent frame");
    }
    if (hypothesis.proposal.tier1Role === "act" && !targetEntity) {
      disqualifiers.push("action proposal has no resolved target entity");
    }
    if (hypothesis.proposal.tier1Role === "act" && !capabilities.execute) {
      disqualifiers.push("adapter does not support execution");
    }
    if ((hypothesis.affordance === "read" || hypothesis.affordance === "locate") && !capabilities.locate) {
      disqualifiers.push("adapter cannot locate/read this surface");
    }
    if (hypothesis.proposal.requiresRevalidation && !capabilities.revalidateBeforeExecute) {
      disqualifiers.push("proposal requires revalidation but adapter cannot revalidate");
    }
    if (targetEntity?.state?.visible === false) {
      disqualifiers.push("target entity is not visible");
    }
    if (targetEntity?.state?.disabled === true) {
      disqualifiers.push("target entity is disabled");
    }
    return {
      valid: disqualifiers.length === 0,
      disqualifiers,
      warnings
    };
  }
};

export function applyStepTransitionGrammar(input: {
  snapshot: SemanticSnapshot;
  intent: Parameters<StepTransitionGrammar["validate"]>[0]["intent"];
  hypotheses: SemanticHypothesis[];
  grammar?: StepTransitionGrammar;
}): SemanticHypothesis[] {
  const grammar = input.grammar ?? defaultStepTransitionGrammar;
  return input.hypotheses.map((hypothesis) => {
    const result = grammar.validate({ snapshot: input.snapshot, intent: input.intent, hypothesis });
    return {
      ...hypothesis,
      disqualifiers: [...new Set([...hypothesis.disqualifiers, ...result.disqualifiers])]
    };
  });
}
