import { randomUUID } from "node:crypto";
import type { PreparedBrowserViewContext } from "../../browser-perception/types.js";
import type { PreparedContextLease } from "../../prepared-context/types.js";
import type { BrowserAction, BrowserObservation } from "../types.js";
import type { BrowserInteractionRiskClass, BrowserViewContextLease } from "./types.js";

export function classifyBrowserActionRisk(action: BrowserAction): BrowserInteractionRiskClass {
  if (action.type === "read" || action.type === "screenshot" || action.type === "scroll") {
    return "read";
  }
  if (action.type === "navigate" || action.type === "back" || action.type === "forward" || action.type === "reload") {
    return "safe_side_effect";
  }
  if (action.type === "type" && action.submit !== true) {
    return "safe_side_effect";
  }
  return "risky_side_effect";
}

export function createBrowserViewContextLease(input: {
  context: PreparedBrowserViewContext;
  leaseReason: BrowserViewContextLease["leaseReason"];
  requiredRiskClass: BrowserInteractionRiskClass;
  ttlMs?: number;
}): BrowserViewContextLease {
  const now = Date.now();
  const ttlMs = input.ttlMs ?? (input.requiredRiskClass === "read" ? 10_000 : 15_000);
  const leaseId = `browser-view-lease-${randomUUID()}`;
  const preparedContextLease: PreparedContextLease = {
    leaseId,
    contextId: input.context.contextId,
    identity: {
      surface: "browser_page",
      sourceId: input.context.adapterId,
      surfaceId: input.context.tabKey ?? [
        input.context.adapterId,
        input.context.source.windowId,
        input.context.source.tabId
      ].filter(Boolean).join(":"),
      url: input.context.source.url ?? input.context.observation.url,
      title: input.context.source.title ?? input.context.observation.title,
      origin: input.context.source.origin,
      routeKey: input.context.routeKey ?? input.context.viewGraph?.identity.routeKey,
      revision: input.context.viewRevision ?? input.context.viewGraph?.identity.viewRevision,
      mutationRevision: input.context.mutationRevision ?? input.context.viewGraph?.identity.domRevision,
      digest: input.context.graphDigest ?? input.context.viewGraph?.identity.structureDigest
    },
    capturedAt: input.context.capturedAt,
    expiresAt: new Date(now + ttlMs).toISOString(),
    requiredRisk: input.requiredRiskClass,
    freshness: input.context.freshness === "settling" ? "settling_ready" : input.context.freshness,
    stability: input.context.stability,
    diagnostics: {
      lastObservedReason: input.context.lastObservedReason
    }
  };
  return {
    leaseId,
    contextId: input.context.contextId,
    adapterId: input.context.adapterId,
    tabKey: input.context.tabKey,
    tabId: input.context.source.tabId === undefined ? undefined : String(input.context.source.tabId),
    windowId: input.context.source.windowId === undefined ? undefined : String(input.context.source.windowId),
    url: input.context.source.url ?? input.context.observation.url,
    origin: input.context.source.origin,
    routeKey: input.context.routeKey ?? input.context.viewGraph?.identity.routeKey,
    viewRevision: input.context.viewRevision ?? input.context.viewGraph?.identity.viewRevision,
    mutationRevision: input.context.mutationRevision ?? input.context.viewGraph?.identity.domRevision,
    graphDigest: input.context.graphDigest ?? input.context.viewGraph?.identity.structureDigest,
    capturedAt: input.context.capturedAt,
    expiresAt: new Date(now + ttlMs).toISOString(),
    freshness: input.context.freshness === "settling" ? "settling_ready" : input.context.freshness,
    stability: input.context.stability,
    leaseReason: input.leaseReason,
    requiredRiskClass: input.requiredRiskClass,
    diagnostics: {
      source: input.context.source,
      lastObservedReason: input.context.lastObservedReason,
      contextFreshness: input.context.freshness,
      contextStability: input.context.stability
    },
    context: input.context,
    preparedContextLease
  };
}

export function isBrowserViewContextLeaseFresh(lease: BrowserViewContextLease, now = Date.now()): boolean {
  if (Date.parse(lease.expiresAt) <= now) {
    return false;
  }
  if (lease.freshness === "stale" || lease.freshness === "blocked" || lease.freshness === "unavailable") {
    return false;
  }
  if (lease.requiredRiskClass !== "read" && lease.stability !== "stable" && lease.stability !== "unknown") {
    return false;
  }
  return true;
}

export function isBrowserViewContextLeaseUsableForAction(lease: BrowserViewContextLease, action: BrowserAction, now = Date.now()): boolean {
  if (Date.parse(lease.expiresAt) <= now) {
    return false;
  }
  if (lease.freshness === "stale" || lease.freshness === "blocked" || lease.freshness === "unavailable") {
    return false;
  }
  if (isTargetlessBrowserNavigationAction(action)) {
    return true;
  }
  return isBrowserViewContextLeaseFresh(lease, now);
}

export function isTargetlessBrowserNavigationAction(action: BrowserAction): boolean {
  return action.type === "navigate" || action.type === "back" || action.type === "forward" || action.type === "reload";
}

export function isBrowserViewContextLeaseCompatible(input: {
  lease?: BrowserViewContextLease;
  observation?: BrowserObservation;
}): boolean {
  if (!input.lease || !input.observation) {
    return true;
  }
  const identity = input.observation.viewGraph?.identity;
  if (input.lease.tabId && input.observation.source.tabId && input.lease.tabId !== String(input.observation.source.tabId)) {
    return false;
  }
  if (input.lease.windowId && input.observation.source.windowId && input.lease.windowId !== String(input.observation.source.windowId)) {
    return false;
  }
  if (input.lease.routeKey && identity?.routeKey && input.lease.routeKey !== identity.routeKey) {
    return false;
  }
  if (input.lease.viewRevision && identity?.viewRevision && input.lease.viewRevision !== identity.viewRevision) {
    return false;
  }
  return true;
}

export function summarizeBrowserViewContextLease(lease?: BrowserViewContextLease): Record<string, unknown> | undefined {
  if (!lease) {
    return undefined;
  }
  return {
    leaseId: lease.leaseId,
    contextId: lease.contextId,
    adapterId: lease.adapterId,
    tabKey: lease.tabKey,
    tabId: lease.tabId,
    windowId: lease.windowId,
    url: lease.url,
    routeKey: lease.routeKey,
    viewRevision: lease.viewRevision,
    mutationRevision: lease.mutationRevision,
    graphDigest: lease.graphDigest,
    freshness: lease.freshness,
    stability: lease.stability,
    expiresAt: lease.expiresAt,
    leaseReason: lease.leaseReason,
    requiredRiskClass: lease.requiredRiskClass
  };
}
