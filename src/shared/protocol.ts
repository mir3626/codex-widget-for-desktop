export type WidgetMode = "agent" | "browser" | "screen" | "terminal";

export const MODEL_OPTIONS = [
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex", label: "Codex 5.3" },
  { id: "gpt-5.3-codex-spark", label: "Spark 5.3" },
  { id: "gpt-5.2", label: "GPT-5.2" }
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

export const REASONING_EFFORT_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "XHigh" }
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_OPTIONS)[number]["id"];

export const DEFAULT_MODEL_ID: ModelId = "gpt-5.5";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export function normalizeModelId(value: unknown): ModelId {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MODEL_OPTIONS.some((option) => option.id === normalized) ? (normalized as ModelId) : DEFAULT_MODEL_ID;
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return REASONING_EFFORT_OPTIONS.some((option) => option.id === normalized)
    ? (normalized as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT;
}

export type AuthStatus = {
  mode: "codex" | "oauth-proxy" | "mock";
  configured: boolean;
  authenticated: boolean;
  signInAvailable: boolean;
  signInMethod: "codex" | "pkce" | "token" | null;
  proxyUrl?: string;
  modelLabel?: string;
  reason?: string;
};

export type RuntimeInteractionKind = "approval" | "input";

export type RuntimeInteractionDecision = "approve" | "always_allow" | "decline" | "submit";

export type RuntimeInteraction = {
  id: string;
  requestId?: string;
  kind: RuntimeInteractionKind;
  title: string;
  body: string;
  action?: string;
  fields?: Array<{
    id: string;
    label: string;
    placeholder?: string;
    multiline?: boolean;
  }>;
};

export type ExecutionPermissionDecision = "ask" | "allow" | "deny";

export type ExecutionPermissionSummary = {
  action: string;
  decision: ExecutionPermissionDecision;
  updatedAt: string;
};

export type ProviderStatus = {
  mode: WidgetMode;
  label: string;
  state: "ready" | "stub" | "unavailable";
  detail: string;
  capabilities: string[];
};

export type RuntimeStatus = {
  uptimeSeconds: number;
  clients: number;
  activeRequests: number;
  storage: {
    state: "ready" | "error";
    databasePath: string;
    blobDir: string;
    schemaVersion: number;
    latestSchemaVersion: number;
    migrationsApplied: number;
    tableCount: number;
    journalMode: string;
    foreignKeys: boolean;
    integrity: string;
    lastError?: string;
  };
  codexAppServer: {
    state: "closed" | "starting" | "connected";
    pid?: number;
    hasThread: boolean;
    activeTurn: boolean;
    startCount: number;
    lastStartedAt?: string;
    lastExitedAt?: string;
    lastError?: string;
  };
};

export type ScreenCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisionStreamMode = "recording" | "agent_stream";

export type VisionStreamStatus = "pending" | "recording" | "streaming" | "stopped" | "error";

export type VisionStreamSummary = {
  id: string;
  sessionId?: string;
  mode: VisionStreamMode;
  status: VisionStreamStatus;
  fps?: number;
  frameIntervalMs?: number;
  recordingBlobId?: string;
  startedAt: string;
  stoppedAt?: string;
  detail?: unknown;
};

export type BranchContextMessage = {
  role: "user" | "assistant";
  text: string;
};

export type CodexUserInput =
  | {
      type: "text";
      text: string;
      text_elements: [];
    }
  | {
      type: "image";
      url: string;
    }
  | {
      type: "localImage";
      path: string;
    };

export type VisionContextSourceRequest = {
  kind?: "screen" | "window" | "browser_tab" | "app";
  appName?: string;
  windowTitle?: string;
  url?: string;
  viewport?: {
    width: number;
    height: number;
    devicePixelRatio?: number;
  };
};

export type VisionContextEventInput = {
  id?: string;
  t?: number;
  type: string;
  [key: string]: unknown;
};

export type BrowserActionMode = "read_only" | "ask_before_action" | "auto_safe_actions" | "full_control_dev";

export type BrowserActionSourceRequest = {
  kind?: "active_tab" | "tab" | "controlled_browser" | "debug_target";
  browser?: "chrome" | "edge" | "chromium" | "unknown";
  tabId?: string;
  url?: string;
  title?: string;
  windowId?: string;
};

export type BrowserActionTargetInput =
  | { kind: "element_id"; id: string }
  | { kind: "selector"; selector: string }
  | { kind: "text"; text: string; role?: string }
  | { kind: "bbox"; bbox: { x: number; y: number; w: number; h: number } }
  | { kind: "focused" };

export type BrowserActionInput =
  | { type: "read"; reason?: string }
  | { type: "click"; target: BrowserActionTargetInput; button?: "left" | "middle" | "right" }
  | { type: "type"; target: BrowserActionTargetInput; text: string; clearFirst?: boolean; submit?: boolean }
  | { type: "select"; target: BrowserActionTargetInput; value: string }
  | { type: "check"; target: BrowserActionTargetInput; checked: boolean }
  | { type: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: "small" | "medium" | "large" | number; target?: BrowserActionTargetInput }
  | { type: "navigate"; url: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "hotkey"; keys: string[] }
  | { type: "screenshot"; fullPage?: boolean }
  | {
      type: "evaluate";
      code: string;
      target?: BrowserActionTargetInput;
      timeoutMs?: number;
      resultLimitBytes?: number;
      allowCredentialAccess?: boolean;
    };

export type BrowserActionAdapterStatus = {
  id: string;
  label: string;
  state: "ready" | "unavailable" | "error";
  capabilities: string[];
  detail: string;
  checkedAt: string;
  diagnostics?: Record<string, unknown>;
};

export type BrowserExtensionBridgePermission = "unknown" | "allowed" | "needs_site_permission" | "restricted" | "unavailable";

export type BrowserExtensionBridgeMode =
  | "off"
  | "checking"
  | "disconnected"
  | "idle"
  | "running"
  | "permission_needed"
  | "restricted"
  | "error";

export type BrowserExtensionBridgeStatus = {
  extensionVersion?: string;
  daemonBaseUrl?: string;
  connected: boolean;
  mode: BrowserExtensionBridgeMode;
  reason?: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastObservationAt?: string;
  lastCommandId?: string;
  lastError?: string | null;
  nativeHost?: "enabled" | "disabled" | "available" | "unavailable" | "unknown";
  activeTab?: {
    tabId?: number | string;
    windowId?: number | string;
    url?: string;
    title?: string;
    origin?: string;
    permission: BrowserExtensionBridgePermission;
    detail?: string;
  };
  settings?: {
    daemonBaseUrl?: string;
    autoConnect?: boolean;
    autoObserve?: boolean;
    allowSafeReadScroll?: boolean;
    requireApprovalForClickType?: boolean;
    useNativeHost?: boolean;
    debugSnapshot?: boolean;
    pollIntervalSeconds?: number;
  };
};

export type BrowserActionPlanStepInput = {
  id?: string;
  action: BrowserActionInput;
  targetSummary?: string;
  reason?: string;
  expected?: unknown[];
};

export type BrowserActionPlanInput = {
  id?: string;
  goal: string;
  mode?: BrowserActionMode;
  adapterId?: string;
  steps: BrowserActionPlanStepInput[];
  expectedOutcome?: string;
  confidence?: number;
};

export type BrowserActionDirectCommandKind =
  | "adapter_status"
  | "observe"
  | "read"
  | "click"
  | "type"
  | "search"
  | "scroll"
  | "navigate"
  | "back"
  | "forward"
  | "reload"
  | "screenshot";

export type BrowserActionDirectCommandInput = {
  id?: string;
  kind: BrowserActionDirectCommandKind;
  actionSessionId?: string;
  sessionId?: string;
  mode?: BrowserActionMode;
  adapterId?: string;
  source?: BrowserActionSourceRequest;
  target?: BrowserActionTargetInput;
  targetText?: string;
  text?: string;
  url?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: "small" | "medium" | "large" | number;
  fullPage?: boolean;
};

export type BrowserActionPolicyDecision = "ask" | "allow" | "deny";

export type BrowserActionPolicySummary = {
  id: string;
  decision: BrowserActionPolicyDecision;
  actionFamily: BrowserActionInput["type"] | "safe_read_scroll" | "safe_click_type" | "all";
  origin?: string;
  targetRisk?: "low" | "medium" | "high" | "destructive" | "credential";
  mode?: BrowserActionMode | "any";
  expiresAt?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export type MessageSnapshotStatus = "pending" | "thinking" | "tooling" | "streaming" | "done" | "cancelled" | "error";

export type SessionStatus = "active" | "archived" | "trashed";

export type SessionSummary = {
  id: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  parentSessionId?: string;
  branchFromMessageId?: string;
  activeModel?: ModelId;
  activeReasoning?: ReasoningEffort;
  activeMode?: WidgetMode;
  artifactCount?: number;
  messageCount?: number;
};

export type SessionMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: MessageSnapshotStatus;
};

export type SessionSnapshot = {
  activeSessionId: string;
  sessions: SessionSummary[];
  trashedSessions: SessionSummary[];
  messages: SessionMessage[];
};

export type ArtifactKind = "generated" | "modified" | "deleted" | "external";

export type ArtifactFileVersionSummary = {
  id: string;
  label?: string;
  operation?: "create" | "modify" | "delete";
  sourcePath?: string;
  size?: number;
  createdAt: string;
  hasBefore: boolean;
  hasAfter: boolean;
  hasDiff: boolean;
};

export type ArtifactFilePreview = {
  kind: "text" | "image";
  mime: string;
  data: string;
  truncated?: boolean;
  size?: number;
};

export type ArtifactFileSummary = {
  id: string;
  artifactId: string;
  logicalPath: string;
  displayName: string;
  fileKind: string;
  mime: string;
  currentVersionId?: string;
  currentVersionLabel?: string;
  operation?: "create" | "modify" | "delete";
  sourcePath?: string;
  size?: number;
  createdAt: string;
  versions?: ArtifactFileVersionSummary[];
  preview?: ArtifactFilePreview;
};

export type ArtifactSummary = {
  id: string;
  sessionId?: string;
  messageId?: string;
  title: string;
  kind: ArtifactKind;
  status: "active" | "trashed";
  createdAt: string;
  updatedAt: string;
  files: ArtifactFileSummary[];
};

export type ActivityLogEntry = {
  id: string;
  sessionId?: string;
  level: "debug" | "info" | "warn" | "error";
  category: string;
  summary: string;
  detail?: unknown;
  createdAt: string;
};

export type ProviderSnapshotProvider = "dom" | "vision" | "terminal";

export type ProviderSnapshotSummary = {
  id: string;
  sessionId?: string;
  messageId?: string;
  provider: ProviderSnapshotProvider;
  title: string;
  summary: string;
  data?: unknown;
  capturedAt: string;
};

export type LedgerSnapshot = {
  sessionId: string;
  artifacts: ArtifactSummary[];
  activities: ActivityLogEntry[];
  providerSnapshots: ProviderSnapshotSummary[];
};

export type ArtifactFileChangePhase = "before" | "after";

export type ArtifactFileChangeEvent = {
  type: "artifact.fileChange";
  id: string;
  changeId: string;
  phase: ArtifactFileChangePhase;
  title: string;
  operation: "create" | "modify" | "delete";
  paths: string[];
  detail?: unknown;
};

export type ClientMessage =
  | {
      type: "ask";
      id: string;
      text: string;
      mode: WidgetMode;
      sessionId?: string;
      model?: ModelId;
      reasoningEffort?: ReasoningEffort;
      branchContext?: BranchContextMessage[];
      appServerInput?: CodexUserInput[];
      regenerate?: {
        dropTurns: number;
        replaceFromMessageId?: string;
      };
    }
  | {
      type: "cancel";
      id: string;
    }
  | {
      type: "session.reset";
    }
  | {
      type: "session.branch";
      messages?: BranchContextMessage[];
      sourceMessageId?: string;
      title?: string;
      model?: ModelId;
      reasoningEffort?: ReasoningEffort;
      mode?: WidgetMode;
    }
  | {
      type: "session.create";
      title?: string;
      model?: ModelId;
      reasoningEffort?: ReasoningEffort;
      mode?: WidgetMode;
    }
  | {
      type: "session.open";
      sessionId: string;
    }
  | {
      type: "session.trash";
      sessionId: string;
    }
  | {
      type: "session.discard";
      sessionId: string;
    }
  | {
      type: "session.delete";
      sessionId: string;
    }
  | {
      type: "session.restore";
      sessionId: string;
    }
  | {
      type: "ledger.refresh";
      sessionId?: string;
    }
  | {
      type: "artifact.open";
      artifactFileId: string;
      versionId?: string;
    }
  | {
      type: "interaction.respond";
      id: string;
      decision: RuntimeInteractionDecision;
      action?: string;
      answers?: Record<string, string>;
    }
  | {
      type: "execution.permissions.refresh";
    }
  | {
      type: "execution.permission.set";
      action: string;
      decision: ExecutionPermissionDecision;
    }
  | {
      type: "provider.captureScreen";
      description?: string;
      crop?: ScreenCrop;
    }
  | {
      type: "provider.vision.start";
      id: string;
      mode: VisionStreamMode;
      sessionId?: string;
      fps?: number;
      frameIntervalMs?: number;
      maxDurationMs?: number;
      detail?: Record<string, unknown>;
    }
  | {
      type: "provider.vision.stop";
      id: string;
      reason?: string;
    }
  | {
      type: "provider.vision.recording.complete";
      id: string;
      mime: string;
      dataUrl: string;
      durationMs?: number;
      size?: number;
    }
  | {
      type: "provider.vision.error";
      id: string;
      message: string;
    }
  | {
      type: "visionContext.start";
      captureId?: string;
      sessionId?: string;
      source?: VisionContextSourceRequest;
      retention?: "default" | "privacy";
      rawMedia?: {
        videoPath?: string;
        audioPath?: string;
        segmentPaths?: string[];
      };
    }
  | {
      type: "visionContext.event";
      captureId: string;
      event: VisionContextEventInput;
    }
  | {
      type: "visionContext.stop";
      captureId: string;
      sendToAgent: boolean;
      requestId?: string;
      sessionId?: string;
      model?: ModelId;
      reasoningEffort?: ReasoningEffort;
    }
  | {
      type: "visionContext.cancel";
      captureId: string;
    }
  | {
      type: "browserAction.start";
      actionSessionId?: string;
      sessionId?: string;
      mode?: BrowserActionMode;
      source?: BrowserActionSourceRequest;
    }
  | {
      type: "browserAction.adapters";
      actionSessionId?: string;
    }
  | {
      type: "browserAction.observe";
      actionSessionId: string;
      adapterId?: string;
    }
  | {
      type: "browserAction.execute";
      actionSessionId: string;
      action: BrowserActionInput;
      requestId?: string;
      adapterId?: string;
      approved?: boolean;
      targetHint?: string;
    }
  | {
      type: "browserAction.plan";
      actionSessionId?: string;
      sessionId?: string;
      plan: BrowserActionPlanInput;
      requestId?: string;
    }
  | {
      type: "browserAction.command";
      command: BrowserActionDirectCommandInput;
      requestId?: string;
    }
  | {
      type: "browserAction.policy.list";
    }
  | {
      type: "browserAction.policy.set";
      policy: Omit<BrowserActionPolicySummary, "id" | "createdAt" | "updatedAt"> & { id?: string };
    }
  | {
      type: "browserAction.policy.revoke";
      policyId: string;
    }
  | {
      type: "browserAction.cancel";
      actionSessionId: string;
    }
  | {
      type: "terminal.input";
      id: string;
      data: string;
      label?: string;
    }
  | {
      type: "ping";
    }
  | {
      type: "auth.start";
    }
  | {
      type: "auth.logout";
    }
  | {
      type: "auth.save-token";
      accessToken: string;
      proxyUrl: string;
      modelLabel?: string;
    };

export type ServerEvent =
  | {
      type: "connected";
      daemon: {
        port: number;
        model: string;
        liveModel: boolean;
        auth: AuthStatus;
      };
    }
  | {
      type: "auth.status";
      auth: AuthStatus;
    }
  | {
      type: "auth.url";
      url: string;
    }
  | {
      type: "external.url";
      url: string;
      reason?: string;
    }
  | {
      type: "session.state";
      state: "idle" | "thinking" | "streaming" | "tooling" | "cancelled" | "error";
      id?: string;
    }
  | {
      type: "message.delta";
      id: string;
      text: string;
    }
  | {
      type: "message.completed";
      id: string;
      text: string;
    }
  | {
      type: "message.snapshot";
      id: string;
      text: string;
      status: MessageSnapshotStatus;
    }
  | {
      type: "tool.started";
      id: string;
      tool: string;
      label: string;
    }
  | {
      type: "tool.output";
      id: string;
      tool: string;
      chunk: string;
    }
  | {
      type: "tool.completed";
      id: string;
      tool: string;
    }
  | {
      type: "approval.required";
      id: string;
      action: string;
      reason: string;
    }
  | {
      type: "interaction.required";
      interaction: RuntimeInteraction;
    }
  | {
      type: "execution.permissions";
      permissions: ExecutionPermissionSummary[];
    }
  | {
      type: "execution.permission.applied";
      id: string;
      action: string;
      decision: Exclude<ExecutionPermissionDecision, "ask">;
    }
  | {
      type: "session.reset";
    }
  | {
      type: "session.snapshot";
      snapshot: SessionSnapshot;
    }
  | {
      type: "ledger.snapshot";
      snapshot: LedgerSnapshot;
    }
  | ArtifactFileChangeEvent
  | {
      type: "provider.status";
      providers: ProviderStatus[];
    }
  | {
      type: "provider.capture";
      mode: "screen";
      state: "started" | "completed" | "error";
      message: string;
    }
  | {
      type: "provider.vision";
      state: "started" | "stopped" | "completed" | "error";
      stream: VisionStreamSummary;
      message: string;
    }
  | {
      type: "visionContext.started";
      captureId: string;
    }
  | {
      type: "visionContext.progress";
      captureId: string;
      status: string;
      detail?: unknown;
    }
  | {
      type: "visionContext.capsule";
      captureId: string;
      capsuleSummary: unknown;
    }
  | {
      type: "visionContext.sent";
      captureId: string;
      requestId: string;
    }
  | {
      type: "visionContext.error";
      captureId: string;
      error: string;
    }
  | {
      type: "browserAction.started";
      actionSessionId: string;
      summary: unknown;
    }
  | {
      type: "browserAction.observation";
      actionSessionId: string;
      observationSummary: unknown;
    }
  | {
      type: "browserAction.progress";
      actionSessionId: string;
      status: string;
      detail?: unknown;
    }
  | {
      type: "browserAction.adapters";
      actionSessionId?: string;
      adapters: BrowserActionAdapterStatus[];
    }
  | {
      type: "browserExtensionBridge.status";
      status: BrowserExtensionBridgeStatus;
    }
  | {
      type: "browserAction.plan";
      actionSessionId: string;
      plan: unknown;
    }
  | {
      type: "browserAction.policies";
      policies: BrowserActionPolicySummary[];
    }
  | {
      type: "browserAction.result";
      actionSessionId: string;
      result: unknown;
    }
  | {
      type: "browserAction.error";
      actionSessionId: string;
      error: string;
    }
  | {
      type: "terminal.output";
      id: string;
      chunk: string;
    }
  | {
      type: "runtime.status";
      status: RuntimeStatus;
    }
  | {
      type: "error";
      id?: string;
      message: string;
    }
  | {
      type: "pong";
    };

export type ToolEmitter = (event: ServerEvent) => void;
