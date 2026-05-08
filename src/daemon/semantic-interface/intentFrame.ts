import { hashSemanticParts, normalizeSemanticText } from "./ontology.js";
import type { IntentFrame, IntentGoal, IntentStep, ReferenceExpression, SemanticAffordance, SemanticTier1Risk } from "./types.js";

export function buildIntentFrame(input: {
  instruction: string;
  goal?: IntentGoal;
  language?: string;
  steps: Array<{
    affordance: SemanticAffordance;
    reference?: string;
    referenceKind?: ReferenceExpression["kind"];
    referenceHints?: ReferenceExpression["hints"];
    riskBudget?: SemanticTier1Risk;
  }>;
  outputKind?: NonNullable<IntentFrame["outputExpectation"]>["kind"];
}): IntentFrame {
  const normalizedInstruction = normalizeSemanticText(input.instruction);
  const steps: IntentStep[] = input.steps.map((step, index) => ({
    id: `step-${index + 1}`,
    desiredAffordance: step.affordance,
    reference: step.reference
      ? {
          raw: step.reference,
          normalized: normalizeSemanticText(step.reference),
          kind: step.referenceKind ?? "name",
          hints: {
            affordances: [step.affordance],
            ...step.referenceHints
          }
        }
      : undefined,
    riskBudget: step.riskBudget ?? riskForAffordance(step.affordance),
    expectedOutcome: {
      kind: step.affordance === "read" ? "observation_contains" : "entity_state",
      description: `Verify ${step.affordance} for ${step.reference ?? "current surface"}.`
    }
  }));
  return {
    id: `intent-${hashSemanticParts([normalizedInstruction, steps.map((step) => step.desiredAffordance).join(",")])}`,
    instruction: input.instruction,
    language: input.language,
    goal: input.goal ?? inferGoal(steps),
    steps,
    constraints: [],
    outputExpectation: {
      kind: input.outputKind ?? (steps.some((step) => step.desiredAffordance !== "read") ? "show" : "answer"),
      description: input.instruction
    }
  };
}

export function riskForAffordance(affordance: SemanticAffordance): SemanticTier1Risk {
  if (affordance === "read" || affordance === "locate") {
    return "read_only";
  }
  if (affordance === "navigate") {
    return "local_navigation";
  }
  if (affordance === "type") {
    return "input_non_submitting";
  }
  if (affordance === "submit") {
    return "submit_or_publish";
  }
  return "state_change";
}

function inferGoal(steps: IntentStep[]): IntentGoal {
  const first = steps[0]?.desiredAffordance;
  if (first === "read") return "read_content";
  if (first === "locate") return "locate_target";
  if (first === "activate") return "activate_control";
  if (first === "filter") return "filter_content";
  if (first === "navigate") return "navigate";
  if (first === "type") return "type_input";
  if (first === "submit") return "submit";
  return "unknown";
}
