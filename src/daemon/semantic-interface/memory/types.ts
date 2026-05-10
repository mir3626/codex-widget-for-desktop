import type {
  MemoryReadSet,
  RedactedMemoryEdge,
  SemanticAffordance,
  SemanticMemoryScope,
  SemanticSurfaceKind
} from "../types.js";

export type SemanticUnresolvedFailureKind =
  | "unknown_intent"
  | "unknown_reference"
  | "ambiguous_target"
  | "missing_resolver"
  | "unsupported_surface"
  | "safety_blocked";

export type SemanticUnresolvedCase = {
  id: string;
  createdAt: string;
  surface: SemanticSurfaceKind;
  failureKind: SemanticUnresolvedFailureKind;
  utteranceHash?: string;
  redactedUtterance?: string;
  scope: SemanticMemoryScope;
  candidates: Array<{ id: string; label: string; reason?: string }>;
  traceId?: string;
  resolvedBy?: "clarification" | "retry" | "user_correction" | "manual";
  resolutionEventId?: string;
};

export type SemanticFeedbackSource =
  | "clarification_selected"
  | "verified_success"
  | "verification_failure"
  | "user_correction"
  | "manual_rule";

export type SemanticFeedbackEvent = {
  id: string;
  createdAt: string;
  source: SemanticFeedbackSource;
  surface?: SemanticSurfaceKind;
  scope: SemanticMemoryScope;
  utteranceHash?: string;
  redactedUtterance?: string;
  payload: {
    phrase?: string;
    selectedTarget?: string;
    correctedTarget?: string;
    rejectedTarget?: string;
    preferredRole?: string;
    preferredRegion?: string;
    preferredAffordance?: SemanticAffordance;
    action?: string;
    safetyClass?: RedactedMemoryEdge["safetyClass"];
  };
  memoryDelta: SemanticMemoryDelta[];
};

export type SemanticMemoryDelta = {
  relation: RedactedMemoryEdge["relation"];
  fromKey: string;
  toKey: string;
  deltaBp: number;
  source: RedactedMemoryEdge["source"];
  safetyClass: RedactedMemoryEdge["safetyClass"];
};

export type SemanticMemoryQuery = {
  phrase?: string;
  scope: SemanticMemoryScope;
  surface?: SemanticSurfaceKind;
  minEvidenceCount?: number;
  limit?: number;
};

export type SemanticMemoryReport = {
  generatedAt: string;
  edgeCount: number;
  unresolvedCount: number;
  feedbackCount: number;
  topEdges: RedactedMemoryEdge[];
};

export type SemanticMemoryStore = {
  recordUnresolvedCase(input: Omit<SemanticUnresolvedCase, "id" | "createdAt" | "utteranceHash"> & { utterance?: string; createdAt?: string }): SemanticUnresolvedCase;
  recordFeedbackEvent(input: Omit<SemanticFeedbackEvent, "id" | "createdAt" | "utteranceHash" | "memoryDelta"> & { utterance?: string; createdAt?: string }): SemanticFeedbackEvent;
  readMemory(input: SemanticMemoryQuery): MemoryReadSet;
  readReport(): SemanticMemoryReport;
  clearMemory(scope?: SemanticMemoryScope): void;
  close(): void;
};
