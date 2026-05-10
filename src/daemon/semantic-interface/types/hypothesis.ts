import type {
  SemanticAffordance,
  SemanticTier1Risk,
  SemanticTier1Role
} from "./core.js";
import type { CandidateEvidencePacket } from "./evidence.js";
import type { VerificationClaim } from "./intent.js";

export interface SemanticHypothesis {
  id: string;
  intentId: string;
  stepId: string;
  targetEntityId?: string;
  targetEvidenceIds: string[];
  affordance: SemanticAffordance;
  proposal: ExecutableCommandProposal;
  expectedVerification: VerificationClaim;
  evidence: CandidateEvidencePacket;
  finalScoreBp?: number;
  enrichment?: EnrichmentLog;
  explanation: string;
  disqualifiers: string[];
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
