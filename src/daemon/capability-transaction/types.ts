export type CapabilityKind =
  | "browser_action"
  | "vision_context"
  | "terminal"
  | "agent_tool"
  | "desktop_action";

export type CapabilityTransactionSource =
  | "prompt"
  | "direct_ui"
  | "resumed_clarification"
  | "approval_resume"
  | "background";

export type CapabilityTransactionPhase =
  | "perceiving"
  | "framing_intent"
  | "generating_candidates"
  | "clarifying"
  | "awaiting_approval"
  | "executing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type CapabilityTransactionSnapshot = {
  capability: CapabilityKind;
  transactionId: string;
  requestId: string;
  sessionId?: string;
  source: CapabilityTransactionSource;
  phase: CapabilityTransactionPhase;
  createdAt: string;
  updatedAt: string;
};

export type CapabilityTimingEvent = {
  name: string;
  at: string;
  elapsedMs: number;
  phase?: CapabilityTransactionPhase;
  detail?: Record<string, unknown>;
};

export type CapabilityContextLeaseIdentity = {
  leaseId?: string;
  contextId?: string;
  sourceId?: string;
  surfaceId?: string;
  routeKey?: string;
  revision?: string;
  mutationRevision?: string;
  digest?: string;
  capturedAt?: string;
  expiresAt?: string;
};

export type CapabilityCandidateSummary = {
  id: string;
  label: string;
  role?: string;
  confidence?: number;
  reasonCodes?: string[];
};

export type CapabilityGateSummary = {
  decision: "proceed" | "clarify" | "request_approval" | "abstain" | "blocked" | "cancelled";
  confidence?: number;
  margin?: number;
  reasonCodes?: string[];
  message?: string;
};

export type CapabilityDebugBundle = {
  schemaVersion: "capability-debug-bundle.v1";
  capability: CapabilityKind;
  transactionId: string;
  requestId: string;
  sessionId?: string;
  createdAt: string;
  redaction: {
    mode: "metadata_only" | "redacted_text";
    omittedFields: string[];
  };
  request: {
    source: CapabilityTransactionSource;
    utterancePreview?: string;
    utteranceHash?: string;
  };
  context?: CapabilityContextLeaseIdentity;
  candidates: CapabilityCandidateSummary[];
  gate?: CapabilityGateSummary;
  timings: CapabilityTimingEvent[];
  events: Array<{
    phase: CapabilityTransactionPhase;
    at: string;
    summary: string;
  }>;
  diagnostics: Record<string, unknown>;
};

