import type {
  BrowserActionSource,
  BrowserElement,
  BrowserViewGraph,
  BrowserViewNode
} from "../../types.js";
import { hashStable } from "../utils.js";
import {
  inferRegionRole,
  inferViewNodeKind,
  isFilterLikeElement,
  readRoute
} from "./inference.js";

export function buildFallbackViewGraph(input: {
  source: Partial<BrowserActionSource>;
  url: string;
  title: string;
  capturedAt: string;
  text: string;
  elements: BrowserElement[];
}): BrowserViewGraph {
  const route = readRoute(input.url);
  const textDigest = hashStable(input.text).slice(0, 16);
  const interactiveDigest = hashStable(input.elements.map((element) => `${element.id}:${element.role}:${element.label}:${element.selector}`).join("|")).slice(0, 16);
  const surfaceId = "view-surface";
  const regionIds = new Set<string>();
  const nodes: BrowserViewNode[] = [{
    id: surfaceId,
    kind: "surface",
    label: input.title || input.url,
    regionRole: "main",
    visible: true
  }];
  const edges: BrowserViewGraph["edges"] = [];
  for (const element of input.elements) {
    addElementViewNode({ element, surfaceId, regionIds, nodes, edges });
  }
  return {
    identity: {
      tabId: input.source.tabId,
      windowId: input.source.windowId,
      url: input.url,
      route,
      viewRevision: hashStable(`${input.url}:${textDigest}:${interactiveDigest}`).slice(0, 16),
      domRevision: interactiveDigest,
      capturedAt: input.capturedAt,
      mutationQuietMs: 0,
      textDigest,
      interactiveDigest
    },
    nodes,
    edges
  };
}

function addElementViewNode(input: {
  element: BrowserElement;
  surfaceId: string;
  regionIds: Set<string>;
  nodes: BrowserViewNode[];
  edges: BrowserViewGraph["edges"];
}): void {
  const { element, surfaceId, regionIds, nodes, edges } = input;
  const regionRole = inferRegionRole(element);
  const regionId = `region-${regionRole}`;
  if (!regionIds.has(regionId)) {
    regionIds.add(regionId);
    nodes.push({
      id: regionId,
      kind: regionRole === "list" ? "list" : regionRole === "form" ? "form" : regionRole === "modal" ? "modal" : "region",
      label: regionRole,
      regionRole,
      visible: true
    });
    edges.push({ from: surfaceId, to: regionId, relation: "contains", confidence: 0.7 });
  }
  const nodeId = `view-${element.id}`;
  nodes.push({
    id: nodeId,
    kind: inferViewNodeKind(element),
    label: element.label || element.text || element.ariaLabel,
    role: element.role,
    elementId: element.id,
    regionRole,
    bbox: element.bbox,
    visible: element.visible
  });
  edges.push({ from: regionId, to: nodeId, relation: "contains", confidence: 0.82 });
  if (isFilterLikeElement(element)) {
    edges.push({ from: nodeId, to: regionId, relation: "filters", confidence: 0.72 });
  }
  if (element.href) {
    edges.push({ from: nodeId, to: surfaceId, relation: "navigates_to", confidence: 0.75 });
  }
}
