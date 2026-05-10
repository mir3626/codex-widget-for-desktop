import type {
  BrowserActionSource,
  BrowserElement,
  BrowserObservation,
  BrowserViewGraph,
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
  return {
    identity: {
      tabId: trimField(identityRecord?.tabId ?? fallback.source.tabId, 120),
      windowId: trimField(identityRecord?.windowId ?? fallback.source.windowId, 120),
      documentId: trimField(identityRecord?.documentId, 160),
      url: trimField(identityRecord?.url, MAX_FIELD_LENGTH) || fallback.url,
      route: trimField(identityRecord?.route, MAX_FIELD_LENGTH) || readRoute(fallback.url),
      viewRevision: trimField(identityRecord?.viewRevision, 160) || hashStable(`${fallback.url}:${fallback.text}:${fallback.elements.length}`).slice(0, 16),
      domRevision: trimField(identityRecord?.domRevision, 160) || hashStable(fallback.elements.map((element) => element.id).join("|")).slice(0, 16),
      capturedAt: trimField(identityRecord?.capturedAt, 128) || fallback.capturedAt,
      mutationQuietMs: Math.floor(clampNumber(identityRecord?.mutationQuietMs, 0)),
      textDigest: trimField(identityRecord?.textDigest, 160) || hashStable(fallback.text).slice(0, 16),
      interactiveDigest: trimField(identityRecord?.interactiveDigest, 160) || hashStable(fallback.elements.map((element) => `${element.id}:${element.label}`).join("|")).slice(0, 16)
    },
    nodes: (record.nodes as unknown[]).map((node, index) => normalizeViewNode(node, index)).filter((node): node is BrowserViewNode => Boolean(node)),
    edges: (record.edges as unknown[]).map((edge) => normalizeViewEdge(edge)).filter((edge): edge is BrowserViewGraph["edges"][number] => Boolean(edge))
  };
}

function normalizeViewNode(value: unknown, index: number): BrowserViewNode | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  return {
    id: trimField(record.id, 160) || `view-node-${index + 1}`,
    kind: normalizeViewNodeKind(record.kind),
    label: trimField(record.label, 700),
    role: trimField(record.role, 80),
    elementId: trimField(record.elementId, 120),
    regionRole: normalizeRegionRole(record.regionRole),
    bbox: normalizeRect(record.bbox),
    visible: record.visible === undefined ? true : Boolean(record.visible)
  };
}

function normalizeViewEdge(value: unknown): BrowserViewGraph["edges"][number] | undefined {
  const record = readRecord(value);
  const from = trimField(record?.from, 160);
  const to = trimField(record?.to, 160);
  if (!from || !to) return undefined;
  const relation = ["contains", "labels", "same_group", "filters", "submits", "navigates_to", "item_of"].includes(String(record?.relation))
    ? String(record?.relation) as BrowserViewGraph["edges"][number]["relation"]
    : "contains";
  return { from, to, relation, confidence: clampNumber(record?.confidence, 0.7) };
}
