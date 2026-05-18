import type { BrowserExtensionBridgeStatus } from "../../shared/protocol.js";
import type { DomSnapshot } from "../providers/providerSnapshots.js";
import type {
  BrowserPerceptionObserveAck,
  BrowserPerceptionObserveCommand,
  BrowserPerceptionObserveRequest,
  BrowserPerceptionObserveStatus
} from "./types.js";

export type RequiredObserveRequest = Required<Omit<BrowserPerceptionObserveRequest, "minCapturedAt">> & {
  minCapturedAt?: Date;
};

export function isObserveAckStatus(value: unknown): value is BrowserPerceptionObserveAck["status"] {
  return value === "accepted" ||
    value === "busy" ||
    value === "missing_permission" ||
    value === "restricted_page" ||
    value === "wrong_tab" ||
    value === "unsupported" ||
    value === "error";
}

export function snapshotMatchesBridgeStatus(snapshot: DomSnapshot, status: BrowserExtensionBridgeStatus): boolean {
  const active = status.activeTab;
  if (!status.connected || active?.permission !== "allowed") {
    return true;
  }
  const bridge = snapshot.bridge;
  if (bridge?.tabId !== undefined && active.tabId !== undefined && String(bridge.tabId) !== String(active.tabId)) {
    return false;
  }
  if (bridge?.windowId !== undefined && active.windowId !== undefined && String(bridge.windowId) !== String(active.windowId)) {
    return false;
  }
  if (bridge?.url && active.url && bridge.url !== active.url) {
    return false;
  }
  return true;
}

export function normalizeObserveRequest(request: BrowserPerceptionObserveRequest): RequiredObserveRequest {
  return {
    requestId: request.requestId,
    reason: request.reason,
    requiredFreshness: request.requiredFreshness ?? "stable",
    maxAgeMs: request.maxAgeMs ?? 10_000,
    settleQuietMs: request.settleQuietMs ?? 500,
    timeoutMs: request.timeoutMs ?? 35_000,
    allowSettlingForRead: request.allowSettlingForRead ?? request.actionRisk === "read",
    actionRisk: request.actionRisk ?? "side_effect",
    minCapturedAt: request.minCapturedAt
  };
}

export function mapAckStatusToObserveStatus(status: BrowserPerceptionObserveAck["status"]): BrowserPerceptionObserveStatus {
  if (status === "missing_permission") {
    return "permission_required";
  }
  if (status === "restricted_page" || status === "unsupported") {
    return "restricted_page";
  }
  if (status === "wrong_tab" || status === "busy") {
    return "blocked";
  }
  return "error";
}

export function readBridgeSourceKey(status: BrowserExtensionBridgeStatus): string | undefined {
  const active = status.activeTab;
  if (!active?.url) {
    return undefined;
  }
  return [
    active.windowId ?? "",
    active.tabId ?? "",
    active.url,
    active.title ?? "",
    active.permission ?? ""
  ].join("|");
}

export function readCommandSourceKey(command: BrowserPerceptionObserveCommand): string | undefined {
  const source = command.expectedActiveTab;
  if (!source?.url) {
    return undefined;
  }
  return [
    source.windowId ?? "",
    source.tabId ?? "",
    source.url,
    source.title ?? "",
    source.permission ?? ""
  ].join("|");
}

export function readObserveResultReason(metadata: Record<string, unknown> | undefined): BrowserPerceptionObserveRequest["reason"] {
  const value = metadata?.reason;
  return value === "background" ||
    value === "prompt" ||
    value === "direct_action" ||
    value === "before_step" ||
    value === "after_step" ||
    value === "retry" ||
    value === "extension_poll" ||
    value === "legacy_snapshot"
    ? value
    : "background";
}
