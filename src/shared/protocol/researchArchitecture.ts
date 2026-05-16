import type {
  CapabilityJobKind,
  CapabilityJobPriority,
  CapabilityJobRequestedBy,
  CapabilityJobStatus,
  CapabilityResourceRetention
} from "./capability.js";

export type ComputerUseEvalModality =
  | "browser"
  | "windows"
  | "asr"
  | "vision"
  | "terminal"
  | "cross_app";

export type ComputerUseEvalStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ComputerUseTaskSuccess =
  | "passed"
  | "failed"
  | "partial"
  | "abstained"
  | "blocked"
  | "unknown";

export type ComputerUseFailureClass =
  | "none"
  | "setup_failed"
  | "perception_miss"
  | "asr_slot_error"
  | "ambiguous_target"
  | "unsafe_action_rejected"
  | "restricted_surface"
  | "approval_denied"
  | "action_failed"
  | "verification_false_positive"
  | "verification_false_negative"
  | "recovery_failed"
  | "timeout"
  | "external_blocker"
  | "unknown";

export type ComputerUseEvalScenario = {
  id: string;
  title: string;
  modalities: ComputerUseEvalModality[];
  source?: string;
  prompt?: string;
  setup?: unknown;
  expectedOutcome?: unknown;
  baselineId?: string;
  tags?: string[];
  safetyBoundaries?: string[];
};

export type ComputerUseEvalMetricSummary = {
  taskSuccessRate: number;
  proofRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p50PerceptionLatencyMs: number;
  p95PerceptionLatencyMs: number;
  averageActionCount: number;
  clarificationRate: number;
  abstentionRate: number;
  unsafeActionRejectionRate: number;
  recoverySuccessRate: number;
  verifierFalsePositiveCount: number;
  verifierFalseNegativeCount: number;
  runs: number;
};

export type ComputerUseEvalRunSummary = {
  id: string;
  scenarioId: string;
  sessionId?: string;
  status: ComputerUseEvalStatus;
  modalities: ComputerUseEvalModality[];
  prompt?: string;
  taskSuccess: ComputerUseTaskSuccess;
  failureClass: ComputerUseFailureClass;
  startedAt: string;
  completedAt?: string;
  elapsedMs?: number;
  scenario?: ComputerUseEvalScenario;
  metrics?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ComputerUseEvalStepSummary = {
  id: string;
  runId: string;
  stepIndex: number;
  kind: string;
  phase: string;
  status: string;
  capabilityJobId?: string;
  capabilityDagNodeId?: string;
  perceptionGraphId?: string;
  input?: unknown;
  output?: unknown;
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  failureClass?: ComputerUseFailureClass;
  createdAt: string;
};

export type ComputerUseEvalResourceSummary = {
  id: string;
  runId: string;
  stepId?: string;
  capabilityResourceId?: string;
  blobId?: string;
  role: string;
  retention: CapabilityResourceRetention;
  redaction?: unknown;
  createdAt: string;
};

export type ComputerUseVerifierAuditClass =
  | "consistent_pass"
  | "consistent_failure"
  | "false_positive_candidate"
  | "false_negative_record"
  | "inconclusive_verifier"
  | "missing_verifier_evidence";

export type ComputerUseVerifierStepAudit = {
  id: string;
  runId: string;
  scenarioId: string;
  sessionId?: string;
  stepId?: string;
  stepKind: string;
  phase: string;
  capabilityJobId?: string;
  capabilityDagNodeId?: string;
  verifierStatus?: "passed" | "failed" | "inconclusive" | "unknown";
  verifierClass?: string;
  failureClass?: ComputerUseFailureClass;
  auditClass: ComputerUseVerifierAuditClass;
  reason: string;
  evidence: {
    taskSuccess: ComputerUseTaskSuccess;
    runFailureClass: ComputerUseFailureClass;
    expectedDeclared: boolean;
    proofRecorded: boolean;
    recoveryAttempted: boolean;
    matchingVerifierStepIds: string[];
  };
  createdAt: string;
};

export type ComputerUseVerifierAuditSummary = {
  schemaVersion: "computer-use-verifier-audit.v1";
  createdAt: string;
  runsAudited: number;
  stepsAudited: number;
  verifierStepCount: number;
  falsePositiveCandidates: number;
  falseNegativeRecords: number;
  inconclusiveRecords: number;
  missingVerifierEvidence: number;
  audits: ComputerUseVerifierStepAudit[];
};

export type PerceptionEvidenceSource =
  | "dom"
  | "uia"
  | "ocr"
  | "screenshot"
  | "visual_parser"
  | "browser_view_graph"
  | "previous_observation"
  | "terminal"
  | "asr"
  | "memory";

export type PerceptionActionRisk = "read_only" | "reversible" | "side_effect" | "high_risk" | "credential";

export type PerceptionGraphRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PerceptionEvidenceEdge = {
  id: string;
  source: PerceptionEvidenceSource;
  class:
    | "semantic_label"
    | "visible_text"
    | "accessibility_role"
    | "dom_selector"
    | "uia_selector"
    | "bbox"
    | "screenshot_region"
    | "ocr_box"
    | "z_order"
    | "occlusion"
    | "freshness"
    | "source_reliability"
    | "disagreement"
    | "memory_prior";
  value?: unknown;
  confidence: number;
  reliability: number;
  observedAt: string;
  notes?: string;
};

export type PerceptionGraphNode = {
  id: string;
  role?: string;
  label?: string;
  text?: string;
  bbox?: PerceptionGraphRect;
  actionable: boolean;
  confidence: number;
  evidence: PerceptionEvidenceEdge[];
  disagreementNotes: string[];
  metadata?: Record<string, unknown>;
};

export type PerceptionGraphSummary = {
  id: string;
  sessionId?: string;
  source: string;
  createdAt: string;
  nodes: PerceptionGraphNode[];
  edges: Array<{
    from: string;
    to: string;
    relation: "near" | "contains" | "labels" | "same_target" | "candidate_for" | "disagrees";
    confidence: number;
  }>;
  thresholds: Record<PerceptionActionRisk, number>;
  diagnostics?: Record<string, unknown>;
};

export type AsrTranscriptCandidate = {
  id: string;
  text: string;
  confidence: number;
  source: "model" | "segment" | "alias" | "grammar";
  replacements?: Array<{ from: string; to: string; reason: string; confidenceBoost: number }>;
};

export type AsrCommandSlot = {
  name: "action" | "target" | "value" | "location" | "domain" | "package" | "app";
  value?: string;
  confidence: number;
  source: "grammar" | "alias" | "lexicon" | "model" | "unknown";
};

export type AsrCommandDecodeResult = {
  schemaVersion: "asr-command-decoder.v1";
  transcriptId: string;
  candidates: AsrTranscriptCandidate[];
  selectedText: string;
  canonicalText: string;
  intent?: string;
  slots: AsrCommandSlot[];
  slotConfidence: number;
  grammarScore: number;
  clarificationRequired: boolean;
  clarificationReason?: string;
  debug: {
    lexiconSize: number;
    aliasesApplied: number;
    grammarMatches: string[];
  };
};

export type StructuredFailureMemoryRecord = {
  id: string;
  failureClass: ComputerUseFailureClass;
  surface: ComputerUseEvalModality | "memory";
  scenarioId?: string;
  provenance: {
    evalRunId?: string;
    evalStepId?: string;
    capabilityJobId?: string;
    perceptionGraphId?: string;
    source: string;
  };
  calibration: {
    aliasUpdates?: Array<{ from: string; to: string; weight: number }>;
    badTargetPatterns?: string[];
    recoveryHints?: string[];
    abstentionTriggers?: string[];
    rankingDelta?: number;
  };
  safety: {
    mayAffectRanking: boolean;
    mayCompleteTask: false;
    mayBypassApproval: false;
    proofSource: false;
    boundaries: string[];
  };
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CapabilityDagNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "skipped"
  | "completed"
  | "failed"
  | "cancelled";

export type CapabilityDagNodeKind =
  | "setup"
  | "permission_check"
  | "capability_gap"
  | "dependency_prepare"
  | "observe"
  | "graph_merge"
  | "plan"
  | "task_plan"
  | "approval"
  | "implement_capability"
  | "tool_smoke"
  | "smoke_test"
  | "tool_execution"
  | "crawl_or_observe"
  | "extract"
  | "verify_sources"
  | "draft_markdown"
  | "render_pdf"
  | "store_artifact"
  | "verify_artifact"
  | "cleanup_or_rollback"
  | "action"
  | "verification"
  | "eval_ledger"
  | "fallback";

export type CapabilityDagRunSummary = {
  id: string;
  evalRunId?: string;
  sessionId?: string;
  status: CapabilityDagNodeStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  goal?: string;
  metadata?: Record<string, unknown>;
};

export type CapabilityDagNodeSummary = {
  id: string;
  dagRunId: string;
  kind: CapabilityDagNodeKind;
  status: CapabilityDagNodeStatus;
  capabilityKind?: CapabilityJobKind;
  capabilityJobId?: string;
  priority: CapabilityJobPriority;
  requestedBy: CapabilityJobRequestedBy;
  dependsOn: string[];
  confidenceGate?: number;
  input?: unknown;
  output?: unknown;
  resourceUsage?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type RoiDirtyRegion = {
  id: string;
  bbox: PerceptionGraphRect;
  changedPixelsEstimate: number;
  diffRatio: number;
  hashBefore?: string;
  hashAfter: string;
};

export type RoiCascadeStageSummary = {
  name:
    | "cached_graph"
    | "dom_uia_observe"
    | "tile_diff"
    | "roi_ocr"
    | "text_detector"
    | "recognizer"
    | "gui_parser"
    | "vlm_fallback";
  status: "hit" | "miss" | "skipped" | "completed" | "failed";
  confidence: number;
  elapsedMs: number;
  reason?: string;
};
