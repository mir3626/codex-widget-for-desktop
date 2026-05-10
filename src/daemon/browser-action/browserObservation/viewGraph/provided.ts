import type {
  BrowserAffordanceIndex,
  BrowserActionSource,
  BrowserContentList,
  BrowserElement,
  BrowserFormSummary,
  BrowserObservation,
  BrowserRegionSummary,
  BrowserViewGraph,
  BrowserViewGraphDiagnostics,
  BrowserViewGraphRedactionSummary,
  BrowserViewNode
} from "../../types.js";
import {
  clampNumber,
  hashStable,
  normalizeRect,
  readRecord,
  trimField
} from "../utils.js";
import {
  normalizeRegionRole,
  normalizeViewNodeKind,
  readRoute
} from "./inference.js";

const MAX_FIELD_LENGTH = 2_000;

export function normalizeProvidedViewGraph(
  record: Record<string, unknown>,
  fallback: {
    source: Partial<BrowserActionSource>;
    url: string;
    title: string;
    capturedAt: string;
    text: string;
    elements: BrowserElement[];
  }
): BrowserViewGraph {
  const identityRecord = readRecord(record.identity);
  const nodes = (record.nodes as unknown[]).map((node, index) => normalizeViewNode(node, index)).filter((node): node is BrowserViewNode => Boolean(node));
  const edges = (record.edges as unknown[]).map((edge) => normalizeViewEdge(edge)).filter((edge): edge is BrowserViewGraph["edges"][number] => Boolean(edge));
  return {
    identity: {
      tabId: trimField(identityRecord?.tabId ?? fallback.source.tabId, 120),
      windowId: trimField(identityRecord?.windowId ?? fallback.source.windowId, 120),
      tabKey: trimField(identityRecord?.tabKey, 160),
      documentId: trimField(identityRecord?.documentId, 160),
      url: trimField(identityRecord?.url, MAX_FIELD_LENGTH) || fallback.url,
      origin: trimField(identityRecord?.origin, MAX_FIELD_LENGTH),
      pathname: trimField(identityRecord?.pathname, MAX_FIELD_LENGTH),
      querySignature: trimField(identityRecord?.querySignature, MAX_FIELD_LENGTH),
      route: trimField(identityRecord?.route, MAX_FIELD_LENGTH) || readRoute(fallback.url),
      routeKey: trimField(identityRecord?.routeKey, 160),
      viewRevision: trimField(identityRecord?.viewRevision, 160) || hashStable(`${fallback.url}:${fallback.text}:${fallback.elements.length}`).slice(0, 16),
      domRevision: trimField(identityRecord?.domRevision, 160) || hashStable(fallback.elements.map((element) => element.id).join("|")).slice(0, 16),
      capturedAt: trimField(identityRecord?.capturedAt, 128) || fallback.capturedAt,
      updatedAt: trimField(identityRecord?.updatedAt, 128),
      mutationQuietMs: Math.floor(clampNumber(identityRecord?.mutationQuietMs, 0)),
      textDigest: trimField(identityRecord?.textDigest, 160) || hashStable(fallback.text).slice(0, 16),
      interactiveDigest: trimField(identityRecord?.interactiveDigest, 160) || hashStable(fallback.elements.map((element) => `${element.id}:${element.label}`).join("|")).slice(0, 16),
      structureDigest: trimField(identityRecord?.structureDigest, 160),
      source: normalizeViewGraphSource(identityRecord?.source),
      freshness: normalizeFreshness(identityRecord?.freshness)
    },
    nodes,
    edges,
    schemaVersion: String(record.schemaVersion || identityRecord?.schemaVersion || "") === "browser-view-graph.v2" ? "browser-view-graph.v2" : "browser-view-graph.v1",
    regions: normalizeRegions(record.regions),
    contentLists: normalizeContentLists(record.contentLists, nodes),
    forms: normalizeForms(record.forms),
    affordanceIndex: normalizeAffordanceIndex(record.affordanceIndex),
    diagnostics: normalizeDiagnostics(record.diagnostics),
    redaction: normalizeRedaction(record.redaction)
  };
}

function normalizeViewNode(value: unknown, index: number): BrowserViewNode | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  return {
    id: trimField(record.id, 160) || `view-node-${index + 1}`,
    stableKey: trimField(record.stableKey, 240),
    kind: normalizeViewNodeKind(record.kind),
    label: trimField(record.label, 700),
    text: trimField(record.text, 1000),
    tokens: normalizeStringList(record.tokens, 80, 160),
    role: trimField(record.role, 80),
    elementId: trimField(record.elementId, 120),
    regionRole: normalizeRegionRole(record.regionRole),
    bbox: normalizeRect(record.bbox),
    visible: record.visible === undefined ? true : Boolean(record.visible),
    enabled: record.enabled === undefined ? undefined : Boolean(record.enabled),
    editable: record.editable === undefined ? undefined : Boolean(record.editable),
    selected: record.selected === undefined ? undefined : Boolean(record.selected),
    href: trimField(record.href, MAX_FIELD_LENGTH),
    actionHint: normalizeActionHint(record.actionHint),
    riskHints: normalizeRiskHints(record.riskHints),
    regionId: trimField(record.regionId, 160),
    listId: trimField(record.listId, 160),
    formId: trimField(record.formId, 160),
    sourceElementIds: Array.isArray(record.sourceElementIds) ? record.sourceElementIds.map((item) => trimField(item, 160)).filter(Boolean) : undefined,
    confidence: clampNumber(record.confidence, 0.7),
    evidence: normalizeStringList(record.evidence, 160, 400)
  };
}

function normalizeViewEdge(value: unknown): BrowserViewGraph["edges"][number] | undefined {
  const record = readRecord(value);
  const from = trimField(record?.from, 160);
  const to = trimField(record?.to, 160);
  if (!from || !to) return undefined;
  const relation = ["contains", "labels", "describes", "adjacent_to", "same_group", "filters", "controls", "submits", "navigates_to", "opens", "updates_region", "selected_in", "focused_in", "error_for", "depends_on", "item_of", "list_item_of"].includes(String(record?.relation))
    ? String(record?.relation) as BrowserViewGraph["edges"][number]["relation"]
    : "contains";
  return { from, to, relation, confidence: clampNumber(record?.confidence, 0.7) };
}

function normalizeActionHint(value: unknown): BrowserViewNode["actionHint"] {
  return ["read", "navigate", "filter", "expand", "submit", "delete", "type", "select", "check", "scroll", "unknown"].includes(String(value))
    ? String(value) as BrowserViewNode["actionHint"]
    : undefined;
}

function normalizeRiskHints(value: unknown): BrowserViewNode["riskHints"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item) => String(item))
    .filter((item): item is NonNullable<BrowserViewNode["riskHints"]>[number] => ["safe_read", "same_page_update", "navigation", "submit", "destructive", "credential", "payment", "download", "file_upload", "cross_origin", "unknown"].includes(item));
}

function normalizeRegions(value: unknown): BrowserRegionSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((item, index): BrowserRegionSummary[] => {
    const record = readRecord(item);
    if (!record) return [];
    return [{
      id: trimField(record.id, 160) || `region-${index + 1}`,
      role: normalizeRegionRole(record.role) ?? "unknown",
      label: trimField(record.label, 500) || "region",
      nodeIds: normalizeStringList(record.nodeIds, 500, 160),
      bbox: normalizeRect(record.bbox),
      confidence: clampNumber(record.confidence, 0.72)
    }];
  });
}

function normalizeContentLists(value: unknown, nodes: BrowserViewNode[]): BrowserContentList[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const lists = value.flatMap((item, index): BrowserContentList[] => {
    const record = readRecord(item);
    if (!record) return [];
    const itemNodeIds = normalizeStringList(record.itemNodeIds, 800, 160).filter((nodeId) => nodeIds.has(nodeId));
    const representativeNodeIds = normalizeStringList(record.representativeNodeIds, 100, 160).filter((nodeId) => nodeIds.has(nodeId));
    if (itemNodeIds.length === 0) {
      return [];
    }
    return [{
      id: trimField(record.id, 160) || `content-list-${index + 1}`,
      label: trimField(record.label, 500) || "content list",
      regionId: trimField(record.regionId, 160) || undefined,
      itemNodeIds,
      representativeNodeIds: representativeNodeIds.length > 0 ? representativeNodeIds : itemNodeIds.slice(0, 5),
      confidence: clampNumber(record.confidence, 0.7)
    }];
  });
  return lists.length > 0 ? lists : undefined;
}

function normalizeForms(value: unknown): BrowserFormSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((item, index): BrowserFormSummary[] => {
    const record = readRecord(item);
    if (!record) return [];
    return [{
      id: trimField(record.id, 160) || `form-${index + 1}`,
      label: trimField(record.label, 500) || "form",
      fieldNodeIds: normalizeStringList(record.fieldNodeIds, 300, 160),
      submitNodeIds: normalizeStringList(record.submitNodeIds, 100, 160),
      riskHints: normalizeRiskHints(record.riskHints) ?? [],
      confidence: clampNumber(record.confidence, 0.7)
    }];
  });
}

function normalizeAffordanceIndex(value: unknown): BrowserAffordanceIndex | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    byToken: normalizeStringIndex(record.byToken),
    byRole: normalizeStringIndex(record.byRole),
    byActionHint: normalizeStringIndex(record.byActionHint),
    byRiskHint: normalizeStringIndex(record.byRiskHint),
    byRegion: normalizeStringIndex(record.byRegion),
    byList: normalizeStringIndex(record.byList),
    byForm: normalizeStringIndex(record.byForm),
    focused: trimField(record.focused, 160),
    selected: normalizeStringList(record.selected, 100, 160),
    primaryControls: normalizeStringList(record.primaryControls, 300, 160),
    contentCandidates: normalizeStringList(record.contentCandidates, 800, 160),
    safeReadTargets: normalizeStringList(record.safeReadTargets, 800, 160),
    riskyActionTargets: normalizeStringList(record.riskyActionTargets, 300, 160)
  };
}

function normalizeDiagnostics(value: unknown): BrowserViewGraphDiagnostics | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    buildTimeMs: Math.floor(clampNumber(record.buildTimeMs, 0)),
    truncatedElements: Math.floor(clampNumber(record.truncatedElements, 0)),
    totalElements: Math.floor(clampNumber(record.totalElements, 0)),
    graphNodeCount: Math.floor(clampNumber(record.graphNodeCount, 0)),
    graphEdgeCount: Math.floor(clampNumber(record.graphEdgeCount, 0)),
    freshnessReason: trimField(record.freshnessReason, 500),
    warnings: normalizeStringList(record.warnings, 50, 500)
  };
}

function normalizeRedaction(value: unknown): BrowserViewGraphRedactionSummary | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    redactedFieldCount: Math.floor(clampNumber(record.redactedFieldCount, 0)),
    redactedNodeIds: normalizeStringList(record.redactedNodeIds, 300, 160),
    policy: "metadata_only"
  };
}

function normalizeStringIndex(value: unknown): Record<string, string[]> {
  const record = readRecord(value);
  if (!record) {
    return {};
  }
  const entries: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(record)) {
    const normalizedKey = trimField(key, 160);
    if (!normalizedKey) {
      continue;
    }
    entries[normalizedKey] = normalizeStringList(list, 800, 160);
  }
  return entries;
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, maxItems)
    .map((item) => trimField(item, maxLength))
    .filter(Boolean);
}

function normalizeViewGraphSource(value: unknown): BrowserViewGraph["identity"]["source"] {
  return ["extension_snapshot", "extension_delta", "extension_action_result", "playwright_observe", "cdp_observe", "native_diagnostics", "test_fixture", "unknown"].includes(String(value))
    ? String(value) as BrowserViewGraph["identity"]["source"]
    : undefined;
}

function normalizeFreshness(value: unknown): BrowserViewGraph["identity"]["freshness"] {
  return ["fresh", "settling", "stale", "unknown"].includes(String(value))
    ? String(value) as BrowserViewGraph["identity"]["freshness"]
    : undefined;
}
