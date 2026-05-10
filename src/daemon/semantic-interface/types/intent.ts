import type {
  SemanticAffordance,
  SemanticEntityKind,
  SemanticTier1Risk
} from "./core.js";

export type IntentGoal =
  | "read_content"
  | "locate_target"
  | "activate_control"
  | "filter_content"
  | "navigate"
  | "type_input"
  | "submit"
  | "inspect"
  | "unknown";

export interface IntentFrame {
  id: string;
  instruction: string;
  language?: string;
  goal: IntentGoal;
  steps: IntentStep[];
  constraints: IntentConstraint[];
  outputExpectation?: {
    kind: "answer" | "show" | "open" | "summarize" | "confirm";
    description?: string;
  };
}

export interface IntentStep {
  id: string;
  desiredAffordance: SemanticAffordance;
  reference?: ReferenceExpression;
  expectedOutcome?: VerificationClaim;
  riskBudget: SemanticTier1Risk;
}

export interface ReferenceExpression {
  raw: string;
  normalized: string;
  kind?: "name" | "role" | "position" | "focused" | "selection" | "content_category";
  hints?: {
    entityKinds?: SemanticEntityKind[];
    affordances?: SemanticAffordance[];
    regionRoles?: string[];
    excludeRegionRoles?: string[];
    ordinal?: number;
    contentCategory?: string;
  };
}

export interface IntentConstraint {
  kind: "do_not_submit" | "same_origin" | "read_only" | "requires_confirmation" | "locale" | "adapter";
  value?: string;
}

export interface VerificationClaim {
  kind:
    | "observation_contains"
    | "entity_state"
    | "url_changed"
    | "url_contains"
    | "selection_changed"
    | "content_list_changed"
    | "no_hidden_side_effect"
    | "custom";
  entityId?: string;
  evidenceId?: string;
  expected?: Record<string, unknown>;
  description: string;
}
