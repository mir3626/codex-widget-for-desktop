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
    allowAllSites?: boolean;
    observeBlocklist?: string[];
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
