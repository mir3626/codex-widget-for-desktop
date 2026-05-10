import type { BrowserExtensionBridgeStatus } from "../../shared/protocol.js";
import type {
  BrowserObservation,
  BrowserViewFreshness,
  BrowserViewGraph
} from "../browser-action/types.js";
import type { DomSnapshot } from "../providers/providerSnapshots.js";

type BrowserExtensionActiveTab = NonNullable<BrowserExtensionBridgeStatus["activeTab"]>;

export type BrowserPerceptionFreshness = BrowserViewFreshness | "blocked" | "unavailable";
export type BrowserPerceptionStability = "stable" | "mutating" | "navigating" | "unknown";

export type PreparedBrowserViewContext = {
  contextId: string;
  schemaVersion: "browser-perception-context.v1";
  adapterId: "extension" | "cdp" | "playwright" | "native" | "unknown";
  tabKey?: string;
  source: {
    tabId?: string | number;
    windowId?: string | number;
    url?: string;
    title?: string;
    origin?: string;
    permission?: BrowserExtensionActiveTab["permission"];
  };
  snapshot: DomSnapshot;
  observation: BrowserObservation;
  viewGraph?: BrowserViewGraph;
  freshness: BrowserPerceptionFreshness;
  stability: BrowserPerceptionStability;
  viewRevision?: string;
  mutationRevision?: string;
  routeKey?: string;
  graphDigest?: string;
  capturedAt: string;
  updatedAt: string;
  expiresAt: string;
  lastObservedReason: BrowserPerceptionObserveReason;
  diagnostics: Record<string, unknown>;
  redaction: {
    mode: "metadata_only";
    persistedFields: string[];
  };
};

export type BrowserPerceptionObserveReason =
  | "background"
  | "prompt"
  | "direct_action"
  | "before_step"
  | "after_step"
  | "retry"
  | "extension_poll"
  | "legacy_snapshot";

export type BrowserPerceptionObserveRequest = {
  requestId: string;
  reason: BrowserPerceptionObserveReason;
  requiredFreshness?: "fresh" | "stable" | "any_visible";
  maxAgeMs?: number;
  settleQuietMs?: number;
  timeoutMs?: number;
  allowSettlingForRead?: boolean;
  actionRisk?: "read" | "safe_navigation" | "side_effect" | "sensitive";
  minCapturedAt?: Date;
};

export type BrowserPerceptionObserveStatus =
  | "ready"
  | "settling_ready"
  | "blocked"
  | "permission_required"
  | "restricted_page"
  | "disconnected"
  | "timeout"
  | "cancelled"
  | "error";

export type BrowserPerceptionObserveResult = {
  status: BrowserPerceptionObserveStatus;
  context?: PreparedBrowserViewContext;
  commandId?: string;
  ack?: BrowserPerceptionObserveAck;
  wait?: {
    waitedMs: number;
    timeoutMs: number;
  };
  diagnostics: Record<string, unknown>;
  userRecovery?: string;
};

export type BrowserPerceptionObserveCommand = {
  kind: "observe_now";
  commandId: string;
  requestId: string;
  reason: BrowserPerceptionObserveReason;
  expectedActiveTab?: PreparedBrowserViewContext["source"];
  deadlineAt: string;
  settleQuietMs: number;
  includeMutationState: true;
  createdAt: string;
};

export type BrowserPerceptionObserveAck = {
  commandId: string;
  status: "accepted" | "busy" | "missing_permission" | "restricted_page" | "wrong_tab" | "unsupported" | "error";
  activeTab?: PreparedBrowserViewContext["source"];
  receivedAt: string;
  estimatedResultMs?: number;
  error?: string;
};

export type BrowserPerceptionObserveResultPayload = {
  commandId: string;
  status: "succeeded" | "failed" | "cancelled" | "expired";
  snapshot?: unknown;
  activeTab?: PreparedBrowserViewContext["source"];
  mutationRevision?: string;
  mutationQuietMs?: number;
  readyState?: string;
  resultPostedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};
