export type CapabilityJobKind =
  | "browser_action"
  | "browser_chrome"
  | "desktop_action"
  | "screen_observe"
  | "ocr"
  | "terminal"
  | "agent_tool";

export type CapabilityJobStatus =
  | "queued"
  | "scheduled"
  | "awaiting_approval"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type CapabilityJobPriority = "background" | "normal" | "interactive";

export type CapabilityJobRequestedBy =
  | "prompt"
  | "direct_ui"
  | "background"
  | "approval_resume";

export type CapabilityResourceRetention =
  | "ephemeral"
  | "session"
  | "evidence"
  | "user_saved";

export type CapabilityEventPhase =
  | "queued"
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
  | "blocked"
  | "expired";

export type CapabilityJobSummary = {
  id: string;
  transactionId: string;
  sessionId?: string;
  kind: CapabilityJobKind;
  status: CapabilityJobStatus;
  priority: CapabilityJobPriority;
  requestedBy: CapabilityJobRequestedBy;
  inputJson?: unknown;
  inputBlobIds: string[];
  outputJson?: unknown;
  outputBlobIds: string[];
  leaseId?: string;
  approvalId?: string;
  timeoutMs: number;
  deadlineAt: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  lastError?: string;
};

export type CapabilityJobEventSummary = {
  id: string;
  jobId: string;
  transactionId: string;
  phase: CapabilityEventPhase;
  status: CapabilityJobStatus;
  summary: string;
  detail?: unknown;
  createdAt: string;
};

export type CapabilityResourceSummary = {
  id: string;
  jobId: string;
  transactionId: string;
  blobId?: string;
  role: string;
  mime: string;
  size: number;
  retention: CapabilityResourceRetention;
  preview?: unknown;
  redaction?: unknown;
  createdAt: string;
};

export type CapabilityLockSummary = {
  id: string;
  jobId?: string;
  lockKey: string;
  kind: CapabilityJobKind;
  acquiredAt: string;
  expiresAt: string;
};

export type CapabilityStartInput = {
  id?: string;
  transactionId?: string;
  sessionId?: string;
  kind: CapabilityJobKind;
  priority?: CapabilityJobPriority;
  requestedBy?: CapabilityJobRequestedBy;
  input?: unknown;
  inputBlobIds?: string[];
  leaseId?: string;
  approvalId?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type CapabilityCancelInput = {
  jobId: string;
  reason?: string;
};

export type CapabilityJobEvent =
  | {
      type: "capability.job";
      jobId: string;
      transactionId: string;
      kind: CapabilityJobKind;
      status: CapabilityJobStatus;
      phase?: CapabilityEventPhase;
      summary: string;
      detail?: unknown;
    }
  | {
      type: "capability.resource";
      jobId: string;
      transactionId: string;
      resourceId: string;
      role: string;
      mime: string;
      preview?: unknown;
    }
  | {
      type: "capability.jobs";
      jobs: CapabilityJobSummary[];
    };
