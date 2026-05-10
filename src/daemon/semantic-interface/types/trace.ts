import type {
  BasisPoints,
  SemanticSurfaceKind,
  SemanticTier1Risk
} from "./core.js";
import type { CandidateEvidencePacket } from "./evidence.js";
import type { SemanticHypothesis, EnrichmentLog, ExecutableCommandProposal } from "./hypothesis.js";
import type { IntentFrame } from "./intent.js";
import type { RankerTrace, TargetFingerprint } from "./ranking.js";
import type { SafetyVerdict, SemanticSourceWarning } from "./safety.js";
import type { AdapterCapabilities } from "./evidence.js";
import type { SemanticSnapshot } from "./snapshot.js";

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
  rankerTrace: RankerTrace;
  ranked: Array<{
    hypothesisId: string;
    targetEntityId?: string;
    finalScoreBp: BasisPoints;
    selected: boolean;
    evidence: CandidateEvidencePacket;
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
    finalScoreBp: BasisPoints;
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

export interface ClarificationDecision {
  kind: "clarify";
  reason: "ambiguous_target" | "unknown_reference" | "unknown_intent" | "missing_required_evidence";
  choices: Array<{
    candidateId: string;
    label: string;
    evidenceSummary: string;
    targetFingerprint?: TargetFingerprint;
  }>;
  trace: RankerTrace;
}

export interface SafetyApprovalDecision {
  kind: "safety_approval";
  risk: SemanticTier1Risk;
  proposal: ExecutableCommandProposal;
  safety: SafetyVerdict;
  targetFingerprint?: TargetFingerprint;
  trace: RankerTrace;
}

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
  finalScoreBp: BasisPoints;
  evidence: CandidateEvidencePacket;
};
