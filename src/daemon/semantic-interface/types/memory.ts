import type { BasisPoints, SemanticSurfaceKind } from "./core.js";
import type { AxisEvidence } from "./evidence.js";

export interface MemoryContributionEvidence {
  phraseAlias: AxisEvidence;
  preferredRole: AxisEvidence;
  preferredRegion: AxisEvidence;
  usualAction: AxisEvidence;
  avoidTarget: AxisEvidence;
  scopeStrength: AxisEvidence;
  readSetId?: string;
}

export interface SemanticMemoryScope {
  surface?: SemanticSurfaceKind;
  origin?: string;
  viewPattern?: string;
  project?: string;
  global?: boolean;
}

export interface RedactedMemoryEdge {
  id: string;
  fromKey: string;
  toKey: string;
  relation:
    | "phrase_alias"
    | "preferred_role"
    | "preferred_region"
    | "preferred_affordance"
    | "usual_action"
    | "workflow_step"
    | "avoid_target";
  weightBp: BasisPoints;
  evidenceCount: number;
  positiveCount: number;
  negativeCount: number;
  scope: SemanticMemoryScope;
  source: "clarification" | "verified_success" | "user_correction" | "manual_rule" | "import";
  safetyClass: "safe_read" | "safe_action" | "risky_requires_approval" | "blocked";
  lastUsedAt?: string;
}

export interface MemoryReadExclusion {
  reason:
    | "scope_mismatch"
    | "stale_view"
    | "insufficient_evidence"
    | "conflict"
    | "safety_boundary"
    | "redacted";
  edgeId?: string;
  note?: string;
}

export interface MemoryReadSet {
  id: string;
  schemaVersion: string;
  storeVersion: string;
  decayEpoch: string;
  scope: SemanticMemoryScope;
  queryHash: string;
  resultHash: string;
  edges: RedactedMemoryEdge[];
  exclusions: MemoryReadExclusion[];
}

export type SemanticMemoryFeatures = {
  readSetId: string;
  phraseAliasBp: BasisPoints;
  conceptAliasBp: BasisPoints;
  preferredRoleBp: BasisPoints;
  preferredRegionBp: BasisPoints;
  preferredAffordanceBp: BasisPoints;
  usualActionBp: BasisPoints;
  workflowStepBp: BasisPoints;
  avoidTargetPenaltyBp: BasisPoints;
  scopeStrengthBp: BasisPoints;
  evidenceCountBp: BasisPoints;
  recencyBp: BasisPoints;
  contradictionPenaltyBp: BasisPoints;
  reasonCodes: string[];
};
