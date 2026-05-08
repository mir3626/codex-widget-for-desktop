import type { RuntimeInteractionDecision } from "../../shared/protocol.js";

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BrowserActionMode = "read_only" | "ask_before_action" | "auto_safe_actions" | "full_control_dev";

export type BrowserActionSource = {
  kind: "active_tab" | "tab" | "controlled_browser" | "debug_target";
  browser?: "chrome" | "edge" | "chromium" | "unknown";
  tabId?: string;
  url?: string;
  title?: string;
  windowId?: string;
};

export type BrowserViewport = {
  width: number;
  height: number;
  devicePixelRatio?: number;
  scrollX?: number;
  scrollY?: number;
};

export type BrowserElementRiskHint =
  | "password"
  | "payment"
  | "delete"
  | "submit"
  | "file_upload"
  | "download"
  | "external_navigation"
  | "auth"
  | "unknown_side_effect";

export type BrowserElement = {
  id: string;
  role?: string;
  tagName: string;
  label?: string;
  text?: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  selector?: string;
  xpath?: string;
  bbox?: Rect;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  checked?: boolean;
  selected?: boolean;
  href?: string;
  inputType?: string;
  confidence: number;
  riskHints: BrowserElementRiskHint[];
};

export type BrowserImageEvidence = {
  path?: string;
  dataUrl?: string;
  title?: string;
};

export type BrowserConsoleSummary = {
  errors: number;
  warnings: number;
  latest?: string;
};

export type BrowserNetworkSummary = {
  inflight?: number;
  failed?: number;
  latestFailure?: string;
};

export type BrowserObservation = {
  id: string;
  capturedAt: string;
  source: BrowserActionSource;
  url: string;
  title: string;
  readyState?: "loading" | "interactive" | "complete";
  viewport?: BrowserViewport;
  selection?: string;
  focusedElementId?: string;
  text?: string;
  elements: BrowserElement[];
  screenshot?: BrowserImageEvidence;
  console?: BrowserConsoleSummary;
  network?: BrowserNetworkSummary;
};

export type BrowserElementGroup = {
  id: string;
  label: string;
  elementIds: string[];
  riskHints: BrowserElementRiskHint[];
};

export type BrowserElementEdge = {
  from: string;
  to: string;
  relation: "labels" | "contains" | "submits" | "near" | "navigates_to" | "candidate_for";
  confidence: number;
};

export type ElementGraph = {
  observationId: string;
  focusedElementId?: string;
  elements: BrowserElement[];
  groups: BrowserElementGroup[];
  edges: BrowserElementEdge[];
};

export type ElementTarget =
  | { kind: "element_id"; id: string }
  | { kind: "selector"; selector: string }
  | { kind: "text"; text: string; role?: string }
  | { kind: "bbox"; bbox: Rect }
  | { kind: "focused" };

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
  target?: BrowserElement;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "succeeded" | "failed" | "needs_approval" | "needs_clarification" | "cancelled";
  safety: BrowserActionSafetyDecision;
  before?: BrowserObservation;
  after?: BrowserObservation;
  verification: BrowserVerificationResult;
  error?: string;
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

export type BrowserActionPolicyDecision = "ask" | "allow" | "deny";

export type BrowserActionPolicyInput = {
  id?: string;
  decision: BrowserActionPolicyDecision;
  actionFamily: BrowserAction["type"] | "safe_read_scroll" | "safe_click_type" | "all";
  origin?: string;
  targetRisk?: "low" | "medium" | "high" | "destructive" | "credential";
  mode?: BrowserActionMode | "any";
  expiresAt?: string;
  note?: string;
};

export type BrowserActionPolicy = Required<Pick<BrowserActionPolicyInput, "id" | "decision" | "actionFamily">> &
  Omit<BrowserActionPolicyInput, "id" | "decision" | "actionFamily"> & {
    createdAt: string;
    updatedAt: string;
    revokedAt?: string;
  };

export type BrowserActionPolicyMatch = {
  decision: BrowserActionPolicyDecision;
  policy?: BrowserActionPolicy;
  reason: string;
};

export type BrowserActionCapability =
  | "observe_dom"
  | "observe_accessibility"
  | "screenshot"
  | "click"
  | "type"
  | "select"
  | "scroll"
  | "navigate"
  | "hotkey"
  | "console"
  | "network"
  | "evaluate"
  | "download"
  | "tab_control";

export type BrowserAdapterAvailabilityInput = {
  session: BrowserActionSession;
};

export type BrowserObserveInput = {
  session: BrowserActionSession;
  providerState?: unknown;
};

export type BrowserExecuteInput = {
  session: BrowserActionSession;
  observation: BrowserObservation;
  action: BrowserAction;
  target?: BrowserElement;
  timeoutMs?: number;
};

export type BrowserActionExecutionResult = {
  requestId: string;
  ok: boolean;
  adapterId?: string;
  before?: unknown;
  after?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type BrowserActionAdapterStatus = {
  id: string;
  label: string;
  state: "ready" | "unavailable" | "error";
  capabilities: BrowserActionCapability[];
  detail: string;
  checkedAt: string;
  diagnostics?: Record<string, unknown>;
};

export type BrowserActionAdapter = {
  id: string;
  label: string;
  capabilities: BrowserActionCapability[];
  isAvailable(input: BrowserAdapterAvailabilityInput): Promise<boolean>;
  getStatus?(input: BrowserAdapterAvailabilityInput): Promise<BrowserActionAdapterStatus>;
  observe(input: BrowserObserveInput): Promise<BrowserObservation>;
  execute(input: BrowserExecuteInput): Promise<BrowserActionExecutionResult>;
};

export type BrowserQueuedCommand = {
  requestId: string;
  actionSessionId: string;
  resultId: string;
  adapterId?: string;
  action: BrowserAction;
  target?: BrowserElement;
  expectedSource?: BrowserActionSource;
  createdAt: string;
  expiresAt?: string;
};

export type BrowserActionPromptPlan = {
  id: string;
  goal: string;
  mode: BrowserActionMode;
  adapterId?: string;
  source?: Partial<BrowserActionSource>;
  steps: Array<Omit<BrowserActionPlanStep, "status">>;
  confidence: number;
  simulatedTool: true;
  reason: string;
};
