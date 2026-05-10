import type { BasisPoints, SemanticAffordance } from "./core.js";

export interface TargetFingerprint {
  surfaceId: string;
  viewIdentityHash: string;
  entityId?: string;
  evidenceIds: string[];
  role?: string;
  normalizedLabel?: string;
  affordances: SemanticAffordance[];
  regionPath?: string[];
  relationDigest?: string;
  locatorDigest?: string;
  bboxBucket?: string;
}

export interface CandidateGenerationTrace {
  sourceSnapshotId: string;
  intentFrameId: string;
  generatorVersion: string;
  generatedCandidateIds: string[];
  rejectedBeforeRanking: GateResult[];
}

export interface GateResult {
  candidateId: string;
  gate: "hard" | "operating_profile" | "safety_precheck";
  status: "pass" | "fail" | "warn";
  reasonCodes: string[];
}

export interface OperatingProfileDecision {
  profileId: string;
  requiredAxes: string[];
  minTopMarginBp: BasisPoints;
  selectedBy: "action_family" | "risk_tier" | "surface_kind" | "evidence_quality";
  reasonCodes: string[];
}

export interface PairwiseMargin {
  winnerId: string;
  runnerUpId: string;
  finalMarginBp: BasisPoints;
  axisMarginsBp: Record<string, BasisPoints>;
  sufficient: boolean;
  reasonCodes: string[];
}

export interface RankerTrace {
  candidateGeneration: CandidateGenerationTrace;
  gateResults: GateResult[];
  profileDecision: OperatingProfileDecision;
  pairwiseMargin?: PairwiseMargin;
  selectedCandidateId?: string;
  targetFingerprint?: TargetFingerprint;
  outcome: "act" | "clarify" | "abstain" | "block";
  reasonCodes: string[];
}
