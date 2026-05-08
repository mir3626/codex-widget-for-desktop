export type SemanticEvidenceSource =
  | "dom"
  | "accessibility"
  | "visual"
  | "ocr"
  | "transcript"
  | "terminal"
  | "workspace"
  | "action_result"
  | "memory";

export type SemanticSurfaceKind =
  | "browser_page"
  | "terminal"
  | "desktop_screen"
  | "app_window"
  | "workspace"
  | "media_stream";

export type SemanticEntityKind =
  | "surface"
  | "region"
  | "control"
  | "content_item"
  | "media"
  | "selection"
  | "process";

export type SemanticAffordance =
  | "read"
  | "locate"
  | "activate"
  | "filter"
  | "navigate"
  | "type"
  | "submit";

export type SemanticRelationType =
  | "contains"
  | "labels"
  | "inside"
  | "controls"
  | "filters"
  | "item_of"
  | "selected"
  | "focused";

export type SemanticTier1Role = "observe" | "locate" | "act";

export type SemanticTier1Risk =
  | "read_only"
  | "local_navigation"
  | "external_navigation"
  | "input_non_submitting"
  | "state_change"
  | "submit_or_publish"
  | "destructive"
  | "credential_or_payment"
  | "code_execution"
  | "data_exfiltration";

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export interface SemanticEvidence {
  id: string;
  snapshotId: string;
  adapterId: string;
  source: SemanticEvidenceSource;
  observedAt: string;
  confidence: number;
  locator?: {
    selector?: string;
    xpath?: string;
    role?: string;
    name?: string;
    bbox?: Rect;
    textRange?: { start: number; end: number };
    path?: string;
    processId?: number;
    opaque?: Record<string, unknown>;
  };
  value?: {
    text?: string;
    role?: string;
    label?: string;
    state?: Record<string, unknown>;
    attributes?: Record<string, string>;
  };
  redaction?: {
    redacted: boolean;
    reason?: string;
  };
}

export interface AdapterCapabilities {
  observe: boolean;
  locate: boolean;
  execute: boolean;
  shadowProbe: boolean;
  dryRun: boolean;
  snapshotImmutable: boolean;
  revalidateBeforeExecute: boolean;
  supportsVisionOnly?: boolean;
  supportsDomLocator?: boolean;
  supportsOcrLocator?: boolean;
}

export interface SemanticSnapshot {
  id: string;
  createdAt: string;
  surface: {
    id: string;
    kind: SemanticSurfaceKind;
    title?: string;
    url?: string;
    adapterId: string;
  };
  capabilities: AdapterCapabilities;
  evidence: SemanticEvidence[];
  entities: SemanticEntity[];
  relations: SemanticRelation[];
  provenance: {
    rawObservationId?: string;
    previousSnapshotId?: string;
    previousActionResultId?: string;
  };
}

export interface SemanticEntity {
  id: string;
  kind: SemanticEntityKind;
  surfaceId: string;
  label?: string;
  normalizedLabel?: string;
  description?: string;
  affordances: SemanticAffordance[];
  evidenceIds: string[];
  state?: {
    selected?: boolean;
    focused?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    visible?: boolean;
  };
  tier1?: {
    role?: SemanticTier1Role;
    risk?: SemanticTier1Risk;
  };
  tier2?: Record<string, string>;
}

export interface SemanticRelation {
  from: string;
  to: string;
  type: SemanticRelationType;
  confidence: number;
  evidenceIds: string[];
}

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

export interface SemanticHypothesis {
  id: string;
  intentId: string;
  stepId: string;
  targetEntityId?: string;
  targetEvidenceIds: string[];
  affordance: SemanticAffordance;
  proposal: ExecutableCommandProposal;
  expectedVerification: VerificationClaim;
  features: DeterministicFeatures;
  enrichment?: EnrichmentLog;
  explanation: string;
  disqualifiers: string[];
}

export interface DeterministicFeatures {
  exactLabelMatch?: number;
  partialLabelMatch?: number;
  affordanceMatch?: number;
  roleMatch?: number;
  regionMatch?: number;
  viewportPresence?: number;
  enabled?: number;
  selectedOrFocused?: number;
  freshness?: number;
  sourceConfidence?: number;
  riskPenalty?: number;
}

export interface EnrichmentLog {
  source: "llm" | "lexicon" | "memory";
  influence: "logged_only";
  suggestions: string[];
  notes?: string;
}

export interface ExecutableCommandProposal {
  kind: string;
  tier1Risk: SemanticTier1Risk;
  tier1Role: SemanticTier1Role;
  payload: unknown;
  targetLocator?: {
    evidenceId?: string;
    entityId?: string;
    opaque?: Record<string, unknown>;
  };
  requiresRevalidation: boolean;
  tier2?: Record<string, string>;
}

export type SafetySubjectKind = "hypothesis" | "step" | "plan";

export interface SafetyPredicateInput {
  subjectKind: SafetySubjectKind;
  hypothesis?: SemanticHypothesis;
  hypotheses?: SemanticHypothesis[];
  snapshot: SemanticSnapshot;
  intent: IntentFrame;
  policy?: Record<string, unknown>;
}

export type SafetyVerdict =
  | { kind: "allow"; reasons: string[] }
  | { kind: "warn"; reasons: string[] }
  | { kind: "confirm"; reasons: string[] }
  | { kind: "block"; reasons: string[] };

export type SafetyPredicate = (input: SafetyPredicateInput) => SafetyVerdict;

export interface SemanticSourceWarning {
  kind: "snapshot_stale" | "source_mismatch" | "adapter_mismatch" | "redacted_evidence" | "unsupported_surface";
  severity: "info" | "warn" | "block";
  evidenceIds: string[];
  description: string;
}

export interface TraceRecord {
  id: string;
  createdAt: string;
  snapshotId: string;
  intentId: string;
  intentHash: string;
  semanticInterfaceVersion: string;
  rankerVersion: string;
  predicateVersion: string;
  catalogVersion: string;
  ranked: Array<{
    hypothesisId: string;
    targetEntityId?: string;
    score: number;
    selected: boolean;
    featureContributions: DeterministicFeatures;
    explanation: string;
    disqualifiers: string[];
  }>;
  verdicts: Array<{
    hypothesisId: string;
    verdict: SafetyVerdict;
  }>;
  warnings: SemanticSourceWarning[];
  enrichment?: EnrichmentLog[];
}

export interface RedactedTraceRecord {
  schemaVersion: number;
  id: string;
  createdAt: string;
  snapshotId: string;
  intentId: string;
  intentHash: string;
  semanticInterfaceVersion: string;
  redactionPolicyVersion: string;
  summary: {
    outcome: "selected" | "abstained" | "blocked" | "confirm_required" | "unsupported";
    selectedHypothesisId?: string;
    hypothesisCount: number;
    warningCount: number;
  };
  ranked: Array<{
    hypothesisId: string;
    targetEntityId?: string;
    score: number;
    selected: boolean;
    explanation: string;
    disqualifiers: string[];
  }>;
  verdicts: Array<{
    hypothesisId: string;
    verdict: SafetyVerdict;
  }>;
  warnings: SemanticSourceWarning[];
}

export type SemanticStepTransition =
  | "intent_to_reference"
  | "reference_to_target"
  | "target_to_action"
  | "action_to_verification";

export interface StepTransitionGrammar {
  id: string;
  version: string;
  validate(input: {
    snapshot: SemanticSnapshot;
    intent: IntentFrame;
    hypothesis: SemanticHypothesis;
  }): {
    valid: boolean;
    disqualifiers: string[];
    warnings: SemanticSourceWarning[];
  };
}

export interface OperatingProfile {
  id: "strict" | "standard" | "permissive";
  version: string;
  requiredEvidence: {
    exactOrAliasMatch?: boolean;
    roleOrAffordanceMatch?: boolean;
    visibleInViewport?: boolean;
    enabledStateKnown?: boolean;
    uniqueWithinScope?: boolean;
    revalidationRequired?: boolean;
    maxSnapshotAgeMs?: number;
    minTopMargin?: number;
  };
}

export type SemanticDecisionOutcome =
  | { kind: "act"; hypothesis: SemanticHypothesis; safety: SafetyVerdict; trace: TraceRecord }
  | { kind: "confirm"; hypothesis: SemanticHypothesis; safety: SafetyVerdict; trace: TraceRecord }
  | { kind: "abstain"; reasons: string[]; trace: TraceRecord }
  | { kind: "block"; reasons: string[]; trace: TraceRecord };

export type SemanticEvalMode = "typed" | "untyped" | "adversarial";

export type SemanticObservationAdapter<TObservation = unknown> = {
  id: string;
  surfaceKinds: SemanticSurfaceKind[];
  capabilities(input?: TObservation): AdapterCapabilities;
  toSnapshot(input: {
    observation: TObservation;
    previousSnapshotId?: string;
    previousActionResultId?: string;
    now?: Date;
  }): SemanticSnapshot;
};

export type RankedSemanticHypothesis = {
  hypothesis: SemanticHypothesis;
  score: number;
  featureContributions: DeterministicFeatures;
};
