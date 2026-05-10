import type {
  BrowserViewFreshness,
  BrowserViewGraph,
  BrowserViewGraphSource
} from "../../browser-action/types.js";
import type { BrowserViewGraphV2Input } from "./types.js";
import { hashViewGraphParts } from "./digest.js";

export function buildBrowserViewIdentityV2(input: BrowserViewGraphV2Input, structureDigest: string): BrowserViewGraph["identity"] {
  const parsed = parseUrl(input.url);
  const textDigest = hashViewGraphParts([input.text]);
  const interactiveDigest = hashViewGraphParts(input.elements.map((element) => [
    element.id,
    element.role,
    element.tagName,
    element.label,
    element.href,
    element.selector,
    element.domPathHash,
    element.sourceOrder
  ]));
  const freshness = classifyFreshness(input);
  const route = `${parsed.origin}${parsed.pathname}${parsed.querySignature ? "?query" : ""}`;
  const routeKey = hashViewGraphParts([parsed.origin, parsed.pathname, parsed.querySignature, input.title, structureDigest]);
  return {
    schemaVersion: "browser-view-graph.v2",
    tabId: input.source.tabId,
    windowId: input.source.windowId,
    tabKey: [input.source.browser, input.source.windowId, input.source.tabId].filter(Boolean).join(":") || undefined,
    documentId: readDocumentId(input),
    url: input.url,
    origin: parsed.origin,
    pathname: parsed.pathname,
    querySignature: parsed.querySignature,
    route,
    routeKey,
    viewRevision: hashViewGraphParts([input.url, input.title, textDigest, interactiveDigest, structureDigest]),
    domRevision: readDomRevision(input) || interactiveDigest,
    capturedAt: input.capturedAt,
    updatedAt: (input.now ?? new Date()).toISOString(),
    mutationQuietMs: readMutationQuietMs(input),
    textDigest,
    interactiveDigest,
    structureDigest,
    source: inferGraphSource(input),
    freshness: freshness.state
  };
}

export function classifyFreshness(input: BrowserViewGraphV2Input): { state: BrowserViewFreshness; reason: string } {
  const capturedAt = Date.parse(input.capturedAt);
  const ageMs = Number.isFinite(capturedAt) ? (input.now ?? new Date()).getTime() - capturedAt : undefined;
  const mutationQuietMs = readMutationQuietMs(input);
  if (input.readyState === "loading") {
    return { state: "settling", reason: "document readyState is loading" };
  }
  if (mutationQuietMs !== undefined && mutationQuietMs < 250) {
    return { state: "settling", reason: `mutation quiet window is ${mutationQuietMs}ms` };
  }
  if (ageMs !== undefined && ageMs > 30_000) {
    return { state: "stale", reason: `captured ${Math.round(ageMs / 1000)}s ago` };
  }
  if (!input.url && input.elements.length === 0) {
    return { state: "unknown", reason: "missing url and elements" };
  }
  return { state: "fresh", reason: "snapshot is recent and stable enough" };
}

function parseUrl(url: string): { origin: string; pathname: string; querySignature: string } {
  try {
    const parsed = new URL(url);
    const querySignature = Array.from(parsed.searchParams.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${hashViewGraphParts([key, value]).slice(0, 8)}`)
      .join("&");
    return {
      origin: parsed.origin,
      pathname: parsed.pathname || "/",
      querySignature
    };
  } catch {
    return { origin: "", pathname: url.split(/[?#]/)[0] || url, querySignature: "" };
  }
}

function readMutationQuietMs(input: BrowserViewGraphV2Input): number | undefined {
  const values = input.elements
    .map((element) => element.lastMutationAt ? Date.parse(element.lastMutationAt) : Number.NaN)
    .filter(Number.isFinite);
  if (values.length === 0) {
    return undefined;
  }
  const latest = Math.max(...values);
  return Math.max(0, (input.now ?? new Date()).getTime() - latest);
}

function readDocumentId(input: BrowserViewGraphV2Input): string | undefined {
  return input.elements.find((element) => element.frameId)?.frameId;
}

function readDomRevision(input: BrowserViewGraphV2Input): string | undefined {
  const revisions = input.elements.map((element) => element.mutationRevision).filter(Boolean);
  return revisions.length ? hashViewGraphParts(revisions) : undefined;
}

function inferGraphSource(input: BrowserViewGraphV2Input): BrowserViewGraphSource {
  if (input.source.kind === "controlled_browser") {
    return "playwright_observe";
  }
  if (input.source.kind === "debug_target") {
    return "cdp_observe";
  }
  if (input.source.kind === "active_tab" || input.source.kind === "tab") {
    return "extension_snapshot";
  }
  return "unknown";
}
