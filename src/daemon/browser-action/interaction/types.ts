import type { PreparedBrowserViewContext } from "../../browser-perception/types.js";
import type {
  BrowserAction,
  BrowserActionMode,
  BrowserActionSource,
  BrowserElement,
  BrowserExpectedState
} from "../types.js";

export type BrowserInteractionSource = "prompt" | "direct_ui" | "resumed_clarification" | "approval_resume";

export type BrowserInteractionPhase =
  | "perceiving"
  | "framing_intent"
  | "generating_candidates"
  | "clarifying"
  | "awaiting_approval"
  | "executing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type BrowserInteractionRiskClass = "read" | "safe_side_effect" | "risky_side_effect";

export type BrowserViewContextLease = {
  leaseId: string;
  contextId: string;
  adapterId: PreparedBrowserViewContext["adapterId"];
  tabKey?: string;
  tabId?: string;
  windowId?: string;
  url?: string;
  origin?: string;
  routeKey?: string;
  viewRevision?: string;
  mutationRevision?: string;
  graphDigest?: string;
  capturedAt: string;
  expiresAt: string;
  freshness: PreparedBrowserViewContext["freshness"] | "settling_ready";
  stability: PreparedBrowserViewContext["stability"];
  leaseReason: "prompt" | "direct_action" | "before_step" | "after_step" | "retry" | "clarification_resume";
  requiredRiskClass: BrowserInteractionRiskClass;
  diagnostics: Record<string, unknown>;
  context: PreparedBrowserViewContext;
};

export type IntentFrame = {
  actionFamily: BrowserAction["type"] | "multi_step" | "unknown";
  targetPhrase?: string;
  valuePhrase?: string;
  ordinal?: number;
  constraints: string[];
  locale: "ko" | "en" | "unknown";
  riskHint: BrowserInteractionRiskClass;
  multiStepHints: string[];
  deicticReferences: string[];
  confidence: number;
  evidenceRefs: string[];
};

export type ReferenceBindingScope =
  | "current_view"
  | "after_step"
  | "deictic"
  | "focused_element"
  | "spatial"
  | "content_list_ordinal"
  | "content_list_representative";

export type CandidateStep = {
  candidateId: string;
  leaseId?: string;
  contextId?: string;
  viewRevision?: string;
  graphDigest?: string;
  stepIndex: number;
  action: BrowserAction;
  targetRef?: string;
  element?: BrowserElement;
  referenceBindingScope: ReferenceBindingScope;
  label: string;
  localeLabel: string;
  role?: string;
  region?: string;
  expectedEffect: BrowserExpectedState[];
  riskClass: BrowserInteractionRiskClass;
  confidence: number;
  scoreBreakdown: Record<string, number>;
  alternatives: string[];
  reasonCodes: string[];
  memoryEvidence?: {
    readSetId?: string;
    edgeCount?: number;
    exclusionCount?: number;
  };
  safetyHints: string[];
};

export type PlanningGateDecision = {
  decision: "proceed" | "clarify" | "request_approval" | "abstain" | "blocked" | "cancelled";
  selectedCandidateId?: string;
  clarificationOptions: CandidateStep[];
  approvalRequest?: {
    reason: string;
    candidateId?: string;
  };
  blockingReason?: string;
  confidence: number;
  margin: number;
  reasonCodes: string[];
  userFacingMessage: string;
};

export type ExecutionBinding = {
  bindingId: string;
  candidateId?: string;
  leaseId?: string;
  elementId?: string;
  locator?: string;
  role?: string;
  name?: string;
  stableFingerprint?: string;
  revalidationStatus: "valid" | "stale" | "missing" | "ambiguous" | "not_required";
  diagnostics: Record<string, unknown>;
};

export type VerificationClaim = {
  claimId: string;
  candidateId?: string;
  beforeLeaseId?: string;
  afterLeaseId?: string;
  status: "passed" | "failed" | "inconclusive";
  matchedEffects: string[];
  missingEffects: string[];
  diagnostics: Record<string, unknown>;
  userFacingSummary: string;
};

export type BrowserInteractionEvent = {
  id: string;
  t: string;
  phase: BrowserInteractionPhase;
  summary: string;
  detail?: unknown;
};

export type BrowserInteractionTransaction = {
  transactionId: string;
  requestId: string;
  actionSessionId: string;
  sessionId?: string;
  utterance: string;
  locale: "ko" | "en" | "unknown";
  source: BrowserInteractionSource;
  mode: BrowserActionMode;
  phase: BrowserInteractionPhase;
  browserSource?: Partial<BrowserActionSource>;
  activeLease?: BrowserViewContextLease;
  intentFrame?: IntentFrame;
  candidateSteps: CandidateStep[];
  selectedCandidateIds: string[];
  stepCursor: number;
  events: BrowserInteractionEvent[];
  memoryReadSetId?: string;
  auditSummary: Record<string, unknown>;
  finalOutcome?: "completed" | "failed" | "cancelled" | "blocked";
};

export type InteractionFeedbackEvent = {
  transactionId?: string;
  utterance: string;
  locale: "ko" | "en" | "unknown";
  contextIdentity?: {
    url?: string;
    routeKey?: string;
    viewRevision?: string;
    graphDigest?: string;
  };
  intentFrameSummary?: Pick<IntentFrame, "actionFamily" | "targetPhrase" | "riskHint" | "confidence">;
  candidateSummary?: Array<Pick<CandidateStep, "candidateId" | "label" | "role" | "confidence" | "reasonCodes">>;
  decisionReason?: string;
  userClarificationChoice?: string;
  verificationOutcome?: string;
  correction?: string;
  redactionSummary: {
    mode: "metadata_only";
    persistedFields: string[];
  };
};
