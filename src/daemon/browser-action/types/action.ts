import type { RuntimeInteractionDecision } from "../../../shared/protocol.js";
import type {
  BrowserActionMode,
  BrowserActionSource,
  BrowserElement
} from "./core.js";
import type {
  BrowserObservation,
  ElementTarget
} from "./observation.js";

export type BrowserAction =
  | { type: "read"; reason?: string }
  | { type: "click"; target: ElementTarget; button?: "left" | "middle" | "right" }
  | { type: "type"; target: ElementTarget; text: string; clearFirst?: boolean; submit?: boolean }
  | { type: "select"; target: ElementTarget; value: string }
  | { type: "check"; target: ElementTarget; checked: boolean }
  | { type: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: "small" | "medium" | "large" | number; target?: ElementTarget }
  | { type: "navigate"; url: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "hotkey"; keys: string[] }
  | { type: "screenshot"; fullPage?: boolean }
  | {
      type: "evaluate";
      code: string;
      target?: ElementTarget;
      timeoutMs?: number;
      resultLimitBytes?: number;
      allowCredentialAccess?: boolean;
    };

export type BrowserActionIntent = {
  id: string;
  utterance: string;
  actionType: BrowserAction["type"] | "unknown";
  actions: BrowserAction[];
  targetPhrase?: string;
  targetRole?: string;
  value?: string;
  confidence: number;
  reason: string;
  alternatives: string[];
};

export type BrowserActionPlanStep = {
  id: string;
  action: BrowserAction;
  targetSummary?: string;
  reason?: string;
  expected?: BrowserExpectedState[];
  safety?: BrowserActionSafetyDecision;
  status: "pending" | "running" | "awaiting_approval" | "awaiting_extension" | "succeeded" | "failed" | "skipped" | "cancelled";
  attempts?: number;
  resultId?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type BrowserActionPlan = {
  id: string;
  actionSessionId: string;
  createdAt: string;
  goal: string;
  adapterId?: string;
  status: "proposed" | "awaiting_approval" | "running" | "paused" | "completed" | "failed" | "cancelled";
  steps: BrowserActionPlanStep[];
  expectedOutcome?: string;
  confidence: number;
  summary?: string;
};

export type BrowserExpectedState =
  | { type: "url_contains"; value: string }
  | { type: "text_visible"; value: string }
  | { type: "element_state"; target: ElementTarget; state: Partial<BrowserElement> }
  | { type: "navigation_complete" }
  | { type: "network_idle" }
  | { type: "no_error_toast" }
  | { type: "custom"; description: string };

export type BrowserActionSafetyDecision = {
  decision: "allow" | "confirm" | "block" | "clarify";
  risk: "low" | "medium" | "high";
  reason: string;
  actionLabel: string;
  targetSummary?: string;
  destructive: boolean;
  metadata?: Record<string, unknown>;
};

export type TargetResolution = {
  primary?: BrowserElement;
  alternatives: BrowserElement[];
  confidence: number;
  reason: string;
  semantic?: {
    outcome: "act" | "confirm" | "abstain" | "block";
    selectedElementId?: string;
    rankedElementIds?: string[];
    trace: unknown;
  };
};

export type BrowserVerificationResult = {
  status: "passed" | "failed" | "unknown";
  reason: string;
};

export type BrowserActionResult = {
  id: string;
  actionSessionId: string;
  adapterId?: string;
  action: BrowserAction;
  expected?: BrowserExpectedState[];
  target?: BrowserElement;
  alternatives?: BrowserElement[];
  startedAt: string;
  completedAt?: string;
  status: "pending" | "succeeded" | "failed" | "needs_approval" | "needs_clarification" | "cancelled";
  safety: BrowserActionSafetyDecision;
  before?: BrowserObservation;
  after?: BrowserObservation;
  verification: BrowserVerificationResult;
  error?: string;
  transaction?: {
    transactionId?: string;
    leaseId?: string;
    contextId?: string;
    candidateId?: string;
    bindingId?: string;
    viewRevision?: string;
    graphDigest?: string;
  };
};

export type BrowserActionTimelineEvent = {
  id: string;
  t: number;
  type: "start" | "observe" | "resolve" | "approval" | "execute" | "result" | "cancel" | "error" | "plan" | "verify";
  summary: string;
  detail?: unknown;
};

export type BrowserActionApproval = {
  id: string;
  actionSessionId: string;
  resultId: string;
  adapterId?: string;
  createdAt: string;
  decision?: RuntimeInteractionDecision;
  action: BrowserAction;
  target?: BrowserElement;
  safety: BrowserActionSafetyDecision;
};

export type BrowserActionSession = {
  id: string;
  sessionId?: string;
  startedAt: string;
  stoppedAt?: string;
  source: BrowserActionSource;
  mode: BrowserActionMode;
  status: "active" | "completed" | "cancelled" | "error";
  timeline: BrowserActionTimelineEvent[];
  approvals: BrowserActionApproval[];
  latestObservation?: BrowserObservation;
};

export type BrowserActionAuditEntry = {
  id: string;
  actionSessionId: string;
  sessionId?: string;
  createdAt: string;
  level: "info" | "warn" | "error";
  category: "observe" | "resolve" | "approval" | "execute" | "verify" | "safety";
  summary: string;
  detail?: unknown;
};
