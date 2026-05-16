import type {
  CapabilityJobKind,
  CapabilityJobSummary
} from "./capability.js";
import type {
  CapabilityDagNodeSummary,
  CapabilityDagRunSummary,
  ComputerUseEvalResourceSummary,
  ComputerUseEvalRunSummary,
  ComputerUseVerifierAuditSummary,
  PerceptionGraphSummary,
  StructuredFailureMemoryRecord
} from "./researchArchitecture.js";

export type ComputerActionButton = "left" | "right" | "middle";

export type ComputerAction =
  | { type: "screenshot" }
  | { type: "click"; x: number; y: number; button?: ComputerActionButton }
  | { type: "double_click"; x: number; y: number; button?: ComputerActionButton }
  | { type: "move"; x: number; y: number }
  | { type: "drag"; path: Array<{ x: number; y: number }> }
  | { type: "scroll"; x: number; y: number; deltaX?: number; deltaY?: number }
  | { type: "type"; text: string }
  | { type: "keypress"; keys: string[] }
  | { type: "wait"; ms?: number };

export type ComputerActionSchemaSource =
  | "openai_single_action"
  | "openai_actions_array"
  | "widget_native";

export type NormalizedComputerActionBatch = {
  actions: ComputerAction[];
  sourceSchema: ComputerActionSchemaSource;
  warnings: string[];
  blockedReason?: string;
};

export type ComputerSessionState =
  | "created"
  | "permission_check"
  | "surface_selecting"
  | "observing"
  | "planning"
  | "awaiting_action_confirmation"
  | "executing"
  | "verifying"
  | "recovering"
  | "completed"
  | "blocked"
  | "cancelled"
  | "failed";

export type RiskClass =
  | "read_only"
  | "local_artifact_create"
  | "browser_state_mutation"
  | "local_file_disclosure"
  | "profile_private_data"
  | "external_submission"
  | "destructive_local_change"
  | "os_settings_mutation"
  | "credential_or_secret"
  | "security_boundary";

export type ExecutionSurfaceKind =
  | "isolated_browser"
  | "regular_browser_extension"
  | "tool_workspace"
  | "pty_workspace"
  | "foreground_desktop_watch"
  | "future_vm_session";

export type ExecutionSurface = {
  id: string;
  kind: ExecutionSurfaceKind;
  ownerSessionId?: string;
  isolationLevel: "process" | "profile" | "workspace" | "foreground" | "vm";
  supportsVisualActions: boolean;
  supportsStructuredDom: boolean;
  supportsBrowserChrome: boolean;
  supportsTerminal: boolean;
  supportsGeneratedTools: boolean;
  supportsFileArtifacts: boolean;
  requiresForeground: boolean;
  requiresUserProfileAccess: boolean;
  defaultRiskClass: RiskClass;
};

export type ExecutionSurfaceDecision = {
  surface: ExecutionSurface;
  reason: string;
  requiredGrants: string[];
  warnings: string[];
};

export type ComputerSessionSummary = {
  sessionId: string;
  userRequest: string;
  profileId?: string;
  selectedSurface?: ExecutionSurface;
  riskClass: RiskClass;
  state: ComputerSessionState;
  createdAt: string;
  updatedAt: string;
  evalRunId?: string;
  dagRunId?: string;
  latestObservationId?: string;
  latestActionBatchId?: string;
  latestVerifierResultId?: string;
  blockedReason?: string;
  requiresUserAction?: string;
};

export type ComputerSessionEvent =
  | { type: "computer.session.created"; session: ComputerSessionSummary }
  | { type: "computer.session.state"; session: ComputerSessionSummary; previousState: ComputerSessionState }
  | { type: "computer.session.observation"; sessionId: string; observation: ComputerSessionObservationSummary }
  | { type: "computer.session.plan"; sessionId: string; plan: unknown }
  | { type: "computer.session.prompt_run"; sessionId: string; promptRun: ComputerSessionPromptRunSummary }
  | { type: "computer.session.approval_required"; sessionId: string; requirement: unknown }
  | { type: "computer.session.action_started"; sessionId: string; actionBatch: NormalizedComputerActionBatch }
  | { type: "computer.session.action_completed"; sessionId: string; result: unknown }
  | { type: "computer.session.verifier_result"; sessionId: string; result: unknown }
  | { type: "computer.session.blocked"; session: ComputerSessionSummary; reason: string }
  | { type: "computer.session.completed"; session: ComputerSessionSummary }
  | { type: "computer.session.debug_bundle_ready"; sessionId: string; bundleId: string };

export type ComputerSessionObservationKind =
  | "session_skeleton"
  | "browser_dom"
  | "screen"
  | "ocr"
  | "terminal"
  | "file"
  | "unknown";

export type ComputerSessionObservationResourceSummary = {
  evalResourceId?: string;
  capabilityResourceId?: string;
  blobId?: string;
  role: string;
  retention?: string;
};

export type ComputerSessionObservationSummary = {
  id: string;
  kind: ComputerSessionObservationKind;
  source: string;
  surface?: ExecutionSurfaceKind;
  capturedAt: string;
  capabilityJobId?: string;
  dagNodeId?: string;
  evalRunId?: string;
  perceptionGraphId?: string;
  resourceIds?: ComputerSessionObservationResourceSummary[];
  summary?: string;
  freshness?: "fresh" | "stale" | "unknown";
  metadata?: Record<string, unknown>;
  redaction?: Record<string, unknown>;
};

export type ComputerSessionFreshnessSummary = {
  checkedAt: string;
  fresh: number;
  stale: number;
  unknown: number;
  maxAgeMs?: number;
  staleObservationIds: string[];
};

export type ComputerSessionRollbackActionSummary = {
  id: string;
  kind:
    | "close_surface"
    | "cancel_capability_job"
    | "delete_temp_workspace"
    | "delete_artifact"
    | "clear_file_upload"
    | "none_available";
  label: string;
  status: "planned" | "running" | "completed" | "failed" | "skipped" | "blocked";
  riskClass: RiskClass;
  createdAt: string;
  completedAt?: string;
  capabilityJobId?: string;
  target?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type ComputerSessionActionFeedbackSummary = {
  id: string;
  sessionId: string;
  operationKind: ComputerStructuredOperation["kind"] | "action_batch";
  actionType: string;
  status: "completed" | "failed" | "blocked" | "unknown";
  capturedAt: string;
  capabilityJobId?: string;
  dagNodeId?: string;
  evalStepId?: string;
  actionBatchId?: string;
  beforeObservationId?: string;
  afterObservationId?: string;
  perceptionGraphId?: string;
  verifierStatus?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  redaction?: Record<string, unknown>;
};

export type ComputerSessionPromptStepStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export type ComputerSessionPromptStepSummary = {
  id: string;
  index: number;
  actionType: string;
  targetSummary?: string;
  status: ComputerSessionPromptStepStatus;
  dagNodeId?: string;
  capabilityJobId?: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
};

export type ComputerSessionPromptRunSummary = {
  id: string;
  sessionId: string;
  prompt: string;
  planId: string;
  goal: string;
  status: ComputerSessionPromptStepStatus;
  currentStepIndex: number;
  confidence: number;
  reason: string;
  steps: ComputerSessionPromptStepSummary[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastError?: string;
};

export type ComputerSessionDebugBundle = {
  schemaVersion: "computer-session-debug-bundle.v1";
  session: ComputerSessionSummary;
  evalRun?: ComputerUseEvalRunSummary | null;
  dagRun?: CapabilityDagRunSummary | null;
  dagNodes: CapabilityDagNodeSummary[];
  capabilityJobs: CapabilityJobSummary[];
  evalResources: ComputerUseEvalResourceSummary[];
  perceptionGraphs: PerceptionGraphSummary[];
  failureMemory: StructuredFailureMemoryRecord[];
  freshnessSummary?: ComputerSessionFreshnessSummary;
  promptRuns: ComputerSessionPromptRunSummary[];
  observations: ComputerSessionObservationSummary[];
  actionFeedbacks: ComputerSessionActionFeedbackSummary[];
  actionBatches: NormalizedComputerActionBatch[];
  rollbackActions: ComputerSessionRollbackActionSummary[];
  safetyDecisions: unknown[];
  verifierResults: unknown[];
  verifierAudit?: ComputerUseVerifierAuditSummary | null;
  redaction: {
    credentials: "redacted";
    browserHistory: "redacted_by_default";
    localPaths: "minimized";
    screenshots: "blob_retention_policy";
  };
};

export type ComputerSessionCreateInput = {
  sessionId?: string;
  userRequest: string;
  profileId?: string;
  requestedSurface?: ExecutionSurfaceKind;
  riskClass?: RiskClass;
  metadata?: Record<string, unknown>;
};

export type ComputerSessionStartResult = {
  session: ComputerSessionSummary;
  evalRun: ComputerUseEvalRunSummary;
  dagRun: CapabilityDagRunSummary;
  dagNodes: CapabilityDagNodeSummary[];
};

export type ForegroundWatchAbortReason =
  | "foreground_watch_user_input_abort"
  | "foreground_watch_active_window_drift_abort";

export type ForegroundWatchPreflightState = {
  schemaVersion: "foreground-watch-preflight.v1";
  oneTimeApprovalGranted: boolean;
  visibleCountdownArmed: boolean;
  activeWindowAsserted: boolean;
  targetIdentityAsserted: boolean;
  processAllowed: boolean;
  surfaceLockArmed: boolean;
  userIdle: boolean;
  abortOnUserInputArmed: boolean;
  userInputDetected: boolean;
  activeWindowDriftDetected: boolean;
  timeoutArmed: boolean;
  preActionEvidenceReady: boolean;
  postActionEvidenceReady: boolean;
  effectVerifierReady: boolean;
  rollbackProofReady: boolean;
  notReversibleRecordReady: boolean;
  signedHelperV2Available: boolean;
  actualInputSent: false;
  abortReason?: ForegroundWatchAbortReason;
};

export type ForegroundWatchPreflightInput =
  Partial<Omit<ForegroundWatchPreflightState, "schemaVersion" | "actualInputSent" | "abortReason">> &
  Record<string, unknown>;

export type ForegroundWatchExecutorState = {
  schemaVersion: "browser-native-desktop-helper-foreground-watch-executor.v1";
  helperCommand: "foreground_watch_execute";
  helperScope: "browser_windows_only";
  enabled: false;
  supported: false;
  dryRunOnly: true;
  actualInputSent: false;
  signedHelperV2Available: false;
  releaseGate: "browser-native-helper-signing";
  blocker: "signed_helper_v2_unavailable";
  requiredPreconditions: string[];
  disabledReason: string;
};

export type ComputerStructuredOperation =
  | { kind: "browser_action"; input: Record<string, unknown> }
  | { kind: "browser_chrome"; input: Record<string, unknown> }
  | { kind: "terminal"; input: Record<string, unknown> }
  | { kind: "toolsmith"; input: Record<string, unknown> }
  | { kind: "screen_observe"; input: Record<string, unknown> }
  | { kind: "ocr"; input: Record<string, unknown> }
  | { kind: "native_browser_window_action"; input: Record<string, unknown> }
  | { kind: "browser_permission_bubble_action"; input: Record<string, unknown> }
  | { kind: "native_file_picker_action"; input: Record<string, unknown> }
  | { kind: "visual_desktop_action"; action: ComputerAction; watchPreflight?: ForegroundWatchPreflightInput };

export type ComputerCapabilityBridgeInput = {
  kind: CapabilityJobKind;
  input: Record<string, unknown>;
};

export function normalizeComputerActionBatch(input: unknown): NormalizedComputerActionBatch {
  const warnings: string[] = [];
  const { actions: rawActions, sourceSchema } = readRawActions(input, warnings);
  const actions: ComputerAction[] = [];
  for (const [index, rawAction] of rawActions.entries()) {
    const normalized = normalizeOneComputerAction(rawAction, warnings, index);
    if (!normalized) {
      return {
        actions: [],
        sourceSchema,
        warnings,
        blockedReason: `Unknown or unsafe computer action at index ${index}.`
      };
    }
    actions.push(normalized);
  }
  if (actions.length === 0) {
    return {
      actions,
      sourceSchema,
      warnings,
      blockedReason: "No executable computer action was provided."
    };
  }
  return { actions, sourceSchema, warnings };
}

function readRawActions(input: unknown, warnings: string[]): { actions: unknown[]; sourceSchema: ComputerActionSchemaSource } {
  if (input && typeof input === "object" && Array.isArray((input as Record<string, unknown>).actions)) {
    return { actions: (input as Record<string, unknown>).actions as unknown[], sourceSchema: "openai_actions_array" };
  }
  if (input && typeof input === "object" && (input as Record<string, unknown>).action !== undefined) {
    return { actions: [(input as Record<string, unknown>).action], sourceSchema: "openai_single_action" };
  }
  if (input && typeof input === "object" && typeof (input as Record<string, unknown>).type === "string") {
    warnings.push("Received a raw action object; treating it as widget_native schema.");
    return { actions: [input], sourceSchema: "widget_native" };
  }
  warnings.push("Input did not contain action/actions fields.");
  return { actions: [], sourceSchema: "widget_native" };
}

function normalizeOneComputerAction(input: unknown, warnings: string[], index: number): ComputerAction | null {
  if (!input || typeof input !== "object") {
    warnings.push(`Action ${index} is not an object.`);
    return null;
  }
  const action = input as Record<string, unknown>;
  const type = normalizeActionType(action.type);
  switch (type) {
    case "screenshot":
      return { type };
    case "click":
    case "double_click": {
      const point = readPoint(action);
      if (!point) {
        warnings.push(`Action ${index} is missing finite x/y coordinates.`);
        return null;
      }
      const button = readButton(action.button);
      return button ? { type, ...point, button } : { type, ...point };
    }
    case "move": {
      const point = readPoint(action);
      if (!point) {
        warnings.push(`Action ${index} is missing finite x/y coordinates.`);
        return null;
      }
      return { type, ...point };
    }
    case "drag": {
      const path = Array.isArray(action.path)
        ? action.path.map(readPoint).filter((point): point is { x: number; y: number } => Boolean(point))
        : [];
      if (path.length < 2) {
        warnings.push(`Action ${index} drag path requires at least two finite points.`);
        return null;
      }
      return { type, path };
    }
    case "scroll": {
      const point = readPoint(action) ?? { x: 0, y: 0 };
      const directionDeltas = readDirectionDeltas(action.direction);
      const deltaX = readFiniteNumber(action.deltaX ?? action.scrollX ?? action.dx) ?? directionDeltas.deltaX;
      const deltaY = readFiniteNumber(action.deltaY ?? action.scrollY ?? action.dy) ?? directionDeltas.deltaY;
      if (deltaX === undefined && deltaY === undefined) {
        warnings.push(`Action ${index} scroll is missing deltas or direction; defaulting to one page down.`);
      }
      return {
        type,
        ...point,
        deltaX,
        deltaY: deltaY ?? 720
      };
    }
    case "type": {
      const text = typeof action.text === "string" ? action.text : typeof action.value === "string" ? action.value : undefined;
      if (text === undefined) {
        warnings.push(`Action ${index} type action is missing text.`);
        return null;
      }
      return { type, text };
    }
    case "keypress": {
      const keys = readKeys(action);
      if (keys.length === 0) {
        warnings.push(`Action ${index} keypress action is missing keys.`);
        return null;
      }
      return { type, keys };
    }
    case "wait": {
      const ms = readFiniteNumber(action.ms ?? action.durationMs ?? action.duration);
      return ms === undefined ? { type } : { type, ms: Math.max(0, Math.round(ms)) };
    }
    default:
      warnings.push(`Action ${index} has unsupported type: ${String(action.type)}`);
      return null;
  }
}

function normalizeActionType(value: unknown): ComputerAction["type"] | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/[-\s]/g, "_").replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`).replace(/^_/, "").toLowerCase();
  if (normalized === "doubleclick" || normalized === "double_click") return "double_click";
  if (normalized === "key_press" || normalized === "keypress" || normalized === "key") return "keypress";
  if (
    normalized === "screenshot" ||
    normalized === "click" ||
    normalized === "move" ||
    normalized === "drag" ||
    normalized === "scroll" ||
    normalized === "type" ||
    normalized === "wait"
  ) {
    return normalized;
  }
  return null;
}

function readPoint(value: unknown): { x: number; y: number } | null {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const x = readFiniteNumber(record.x ?? record.left);
  const y = readFiniteNumber(record.y ?? record.top);
  return x === undefined || y === undefined ? null : { x, y };
}

function readFiniteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readButton(value: unknown): ComputerActionButton | undefined {
  return value === "left" || value === "right" || value === "middle" ? value : undefined;
}

function readKeys(action: Record<string, unknown>): string[] {
  if (Array.isArray(action.keys)) {
    return action.keys.filter((key): key is string => typeof key === "string" && key.length > 0);
  }
  if (typeof action.key === "string" && action.key.length > 0) {
    return [action.key];
  }
  if (typeof action.text === "string" && action.text.length > 0) {
    return [action.text];
  }
  return [];
}

function readDirectionDeltas(value: unknown): { deltaX?: number; deltaY?: number } {
  if (value === "up") return { deltaY: -720 };
  if (value === "down") return { deltaY: 720 };
  if (value === "left") return { deltaX: -720 };
  if (value === "right") return { deltaX: 720 };
  return {};
}
