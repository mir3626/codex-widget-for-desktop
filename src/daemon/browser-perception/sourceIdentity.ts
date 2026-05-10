import { createHash } from "node:crypto";
import type { BrowserExtensionBridgeStatus } from "../../shared/protocol.js";
import type { BrowserObservation } from "../browser-action/types.js";
import type { DomSnapshot } from "../providers/providerSnapshots.js";
import type {
  BrowserPerceptionFreshness,
  BrowserPerceptionStability,
  PreparedBrowserViewContext
} from "./types.js";

export function buildPreparedBrowserViewContext(input: {
  snapshot: DomSnapshot;
  observation: BrowserObservation;
  bridgeStatus?: BrowserExtensionBridgeStatus;
  reason: PreparedBrowserViewContext["lastObservedReason"];
  now?: Date;
}): PreparedBrowserViewContext {
  const now = input.now ?? new Date();
  const graph = input.observation.viewGraph;
  const source = {
    tabId: input.bridgeStatus?.activeTab?.tabId ?? input.observation.source.tabId,
    windowId: input.bridgeStatus?.activeTab?.windowId ?? input.observation.source.windowId,
    url: input.snapshot.url || input.observation.url || input.bridgeStatus?.activeTab?.url,
    title: input.snapshot.title || input.observation.title || input.bridgeStatus?.activeTab?.title,
    origin: input.bridgeStatus?.activeTab?.origin,
    permission: input.bridgeStatus?.activeTab?.permission
  };
  const graphDigest = hashParts([
    graph?.identity?.routeKey,
    graph?.identity?.viewRevision,
    graph?.identity?.structureDigest,
    graph?.identity?.interactiveDigest
  ]);
  const freshness = readPerceptionFreshness(input.observation);
  const stability = readPerceptionStability(input.observation);
  return {
    contextId: hashParts([
      source.windowId,
      source.tabId,
      source.url,
      graph?.identity?.routeKey,
      graph?.identity?.viewRevision,
      input.snapshot.capturedAt
    ]),
    schemaVersion: "browser-perception-context.v1",
    adapterId: "extension",
    tabKey: [source.windowId, source.tabId].filter(Boolean).join(":") || graph?.identity?.tabKey,
    source,
    snapshot: input.snapshot,
    observation: input.observation,
    viewGraph: graph,
    freshness,
    stability,
    viewRevision: graph?.identity?.viewRevision,
    mutationRevision: graph?.identity?.domRevision,
    routeKey: graph?.identity?.routeKey,
    graphDigest,
    capturedAt: input.snapshot.capturedAt,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    lastObservedReason: input.reason,
    diagnostics: {
      readyState: input.observation.readyState,
      mutationQuietMs: graph?.identity?.mutationQuietMs,
      graphFreshness: graph?.identity?.freshness,
      nodeCount: graph?.nodes?.length ?? 0,
      edgeCount: graph?.edges?.length ?? 0
    },
    redaction: {
      mode: "metadata_only",
      persistedFields: ["source", "viewRevision", "routeKey", "freshness", "stability", "diagnostics"]
    }
  };
}

export function contextMatchesBridgeStatus(
  context: PreparedBrowserViewContext | undefined,
  status: BrowserExtensionBridgeStatus
): boolean {
  if (!context) {
    return false;
  }
  const active = status.activeTab;
  if (!status.connected || active?.permission !== "allowed") {
    return false;
  }
  if (active.tabId !== undefined && context.source.tabId !== undefined && String(active.tabId) !== String(context.source.tabId)) {
    return false;
  }
  if (active.windowId !== undefined && context.source.windowId !== undefined && String(active.windowId) !== String(context.source.windowId)) {
    return false;
  }
  return urlsMatch(context.source.url, active.url);
}

export function urlsMatch(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return true;
  }
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    leftUrl.hash = "";
    rightUrl.hash = "";
    return leftUrl.href === rightUrl.href;
  } catch {
    return String(left).replace(/#.*$/, "") === String(right).replace(/#.*$/, "");
  }
}

export function readContextAgeMs(context: PreparedBrowserViewContext, now = new Date()): number {
  const capturedAt = Date.parse(context.capturedAt);
  return Number.isFinite(capturedAt) ? Math.max(0, now.getTime() - capturedAt) : Number.POSITIVE_INFINITY;
}

export function contextSatisfiesFreshness(input: {
  context: PreparedBrowserViewContext;
  requiredFreshness: "fresh" | "stable" | "any_visible";
  maxAgeMs: number;
  allowSettlingForRead?: boolean;
  minCapturedAt?: Date;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  if (readContextAgeMs(input.context, now) > input.maxAgeMs) {
    return false;
  }
  if (input.minCapturedAt && Date.parse(input.context.capturedAt) < input.minCapturedAt.getTime()) {
    return false;
  }
  if (input.requiredFreshness === "any_visible") {
    return input.context.observation.elements.length > 0 || Boolean(input.context.observation.text);
  }
  if (input.requiredFreshness === "fresh") {
    return input.context.freshness === "fresh";
  }
  if (input.context.freshness === "fresh" && input.context.stability === "stable") {
    return true;
  }
  return Boolean(input.allowSettlingForRead && input.context.freshness === "settling");
}

export function readPerceptionStatusForBridge(status: BrowserExtensionBridgeStatus): {
  status?: "permission_required" | "restricted_page" | "disconnected" | "blocked";
  userRecovery?: string;
} {
  if (!status.connected || status.mode === "disconnected" || status.mode === "off") {
    return { status: "disconnected", userRecovery: "Browser Bridge is disconnected. Check the extension popup daemon URL and auto-connect setting." };
  }
  if (status.activeTab?.permission === "needs_site_permission") {
    return { status: "permission_required", userRecovery: "Allow the current site or enable all-sites access in the Browser Bridge popup." };
  }
  if (status.activeTab?.permission === "restricted" || status.mode === "restricted") {
    return { status: "restricted_page", userRecovery: "This browser page is restricted by the browser and cannot be observed by the extension." };
  }
  if (status.activeTab?.permission === "unavailable") {
    return { status: "blocked", userRecovery: status.activeTab.detail ?? "The active tab is unavailable for Browser Bridge observation." };
  }
  return {};
}

function readPerceptionFreshness(observation: BrowserObservation): BrowserPerceptionFreshness {
  return observation.viewGraph?.identity?.freshness ?? "unknown";
}

function readPerceptionStability(observation: BrowserObservation): BrowserPerceptionStability {
  const graph = observation.viewGraph;
  if (observation.readyState === "loading") {
    return "navigating";
  }
  const quietMs = graph?.identity?.mutationQuietMs;
  if (typeof quietMs === "number" && quietMs < 500) {
    return "mutating";
  }
  if (graph?.identity?.freshness === "fresh") {
    return "stable";
  }
  return "unknown";
}

function hashParts(parts: unknown[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part ?? ""));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 24);
}

