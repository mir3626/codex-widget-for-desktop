import type {
  BrowserAffordanceIndex,
  BrowserContentList,
  BrowserFormSummary,
  BrowserRegionSummary,
  BrowserViewEdge,
  BrowserViewGraph,
  BrowserViewNode
} from "../../browser-action/types.js";
import { classifyBrowserViewElement, isLikelyContentElement } from "./classification.js";
import { compactViewText, hashViewGraphParts, tokenizeViewText } from "./digest.js";
import { buildBrowserViewIdentityV2, classifyFreshness } from "./identity.js";
import type { BrowserViewGraphV2Input } from "./types.js";

export function buildBrowserViewGraphV2(input: BrowserViewGraphV2Input): BrowserViewGraph {
  const startedAt = Date.now();
  const surfaceId = "view-surface";
  const nodes: BrowserViewNode[] = [{
    id: surfaceId,
    stableKey: hashViewGraphParts(["surface", input.url, input.title]),
    kind: "surface",
    label: input.title || input.url || "Browser page",
    text: compactViewText(input.text, 1200),
    tokens: tokenizeViewText(`${input.title} ${input.url}`),
    regionRole: "main",
    visible: true,
    actionHint: "read",
    riskHints: ["safe_read"],
    confidence: 0.95,
    evidence: ["surface"]
  }];
  const edges: BrowserViewEdge[] = [];
  const regions = new Map<string, BrowserRegionSummary>();
  const forms = new Map<string, BrowserFormSummary>();
  const redactedNodeIds: string[] = [];
  const elementNodeIds: string[] = [];

  for (const [index, element] of input.elements.entries()) {
    const classification = classifyBrowserViewElement(element);
    const regionId = ensureRegion({
      surfaceId,
      regions,
      nodes,
      edges,
      role: classification.regionRole,
      label: element.nearestLandmark || classification.regionRole
    });
    const nodeId = `view-${element.id}`;
    const label = compactViewText(element.label || element.text || element.ariaLabel || element.title || element.href || element.id);
    const text = compactViewText(element.text || element.label || element.ariaLabel || element.title);
    const node: BrowserViewNode = {
      id: nodeId,
      stableKey: hashViewGraphParts([
        element.domPathHash,
        element.selector,
        element.role,
        element.tagName,
        label,
        element.href,
        bucketRect(element.bbox),
        element.domPathHash ? "" : element.sourceOrder ?? index
      ]),
      kind: classification.nodeKind,
      label,
      text,
      tokens: tokenizeViewText(`${label} ${text} ${element.placeholder ?? ""}`),
      role: element.role,
      elementId: element.id,
      regionRole: classification.regionRole,
      bbox: element.bbox,
      visible: element.visible,
      enabled: element.enabled,
      editable: element.editable,
      selected: element.selected || element.checked,
      href: element.href,
      actionHint: classification.actionHint,
      riskHints: classification.riskHints,
      regionId,
      sourceElementIds: [element.id],
      confidence: classification.confidence,
      evidence: classification.evidence
    };
    nodes.push(node);
    elementNodeIds.push(nodeId);
    regions.get(regionId)?.nodeIds.push(nodeId);
    edges.push(edge(regionId, nodeId, "contains", 0.88, ["region contains element"]));
    if (element.nearestHeading) {
      edges.push(edge(regionId, nodeId, "describes", 0.68, [`nearest heading:${element.nearestHeading}`]));
    }
    if (classification.actionHint === "filter") {
      edges.push(edge(nodeId, regionId, "filters", 0.76, ["filter-like control"]));
    }
    if (classification.actionHint === "submit") {
      edges.push(edge(nodeId, regionId, "submits", 0.74, ["submit-like control"]));
    }
    if (element.href) {
      edges.push(edge(nodeId, surfaceId, "navigates_to", 0.75, ["href"]));
    }
    if (element.editable || classification.actionHint === "submit") {
      addFormNode({ forms, node, regionId });
    }
    if (classification.riskHints.some((hint) => hint === "credential" || hint === "payment")) {
      redactedNodeIds.push(nodeId);
    }
  }

  const contentLists = buildContentLists({ input, nodes, edges });
  for (const list of contentLists) {
    nodes.push({
      id: list.id,
      stableKey: hashViewGraphParts(["list", list.regionId, list.itemNodeIds]),
      kind: "list",
      label: list.label,
      regionRole: "list",
      visible: true,
      actionHint: "read",
      riskHints: ["safe_read"],
      sourceElementIds: [],
      confidence: list.confidence,
      evidence: ["repeated content candidates"]
    });
    if (list.regionId) {
      edges.push(edge(list.regionId, list.id, "contains", 0.78, ["region content list"]));
    }
    for (const itemId of list.itemNodeIds) {
      const item = nodes.find((node) => node.id === itemId);
      if (item) {
        item.listId = list.id;
      }
      edges.push(edge(itemId, list.id, "list_item_of", 0.84, ["content list membership"]));
    }
  }

  for (const form of forms.values()) {
    nodes.push({
      id: form.id,
      stableKey: hashViewGraphParts(["form", form.fieldNodeIds, form.submitNodeIds]),
      kind: "form",
      label: form.label,
      regionRole: "form",
      visible: true,
      actionHint: "type",
      riskHints: form.riskHints,
      confidence: form.confidence,
      evidence: ["field/submit grouping"]
    });
    for (const fieldId of form.fieldNodeIds) {
      const field = nodes.find((node) => node.id === fieldId);
      if (field) {
        field.formId = form.id;
      }
      edges.push(edge(form.id, fieldId, "contains", 0.82, ["form field"]));
    }
    for (const submitId of form.submitNodeIds) {
      const submit = nodes.find((node) => node.id === submitId);
      if (submit) {
        submit.formId = form.id;
      }
      edges.push(edge(submitId, form.id, "submits", 0.8, ["form submit"]));
    }
  }

  const structureDigest = hashViewGraphParts(nodes.map((node) => [
    node.kind,
    node.regionRole,
    node.actionHint,
    node.riskHints,
    node.label,
    node.href,
    node.listId,
    node.formId
  ]));
  const freshness = classifyFreshness(input);
  const identity = buildBrowserViewIdentityV2(input, structureDigest);
  const graph: BrowserViewGraph = {
    schemaVersion: "browser-view-graph.v2",
    identity,
    nodes,
    edges,
    regions: Array.from(regions.values()),
    contentLists,
    forms: Array.from(forms.values()),
    affordanceIndex: buildAffordanceIndex(nodes),
    diagnostics: {
      buildTimeMs: Date.now() - startedAt,
      truncatedElements: Math.max(0, input.elements.length - elementNodeIds.length),
      totalElements: input.elements.length,
      graphNodeCount: nodes.length,
      graphEdgeCount: edges.length,
      freshnessReason: freshness.reason,
      warnings: buildWarnings(input, contentLists)
    },
    redaction: {
      redactedFieldCount: redactedNodeIds.length,
      redactedNodeIds,
      policy: "metadata_only"
    }
  };
  return graph;
}

function ensureRegion(input: {
  surfaceId: string;
  regions: Map<string, BrowserRegionSummary>;
  nodes: BrowserViewNode[];
  edges: BrowserViewEdge[];
  role: NonNullable<BrowserViewNode["regionRole"]>;
  label: string;
}): string {
  const id = `region-${input.role}`;
  if (!input.regions.has(id)) {
    input.regions.set(id, {
      id,
      role: input.role,
      label: input.label,
      nodeIds: [],
      confidence: 0.72
    });
    input.nodes.push({
      id,
      stableKey: hashViewGraphParts(["region", input.role]),
      kind: input.role === "form" ? "form" : input.role === "list" ? "list" : input.role === "modal" || input.role === "dialog" ? "modal" : "region",
      label: input.label,
      regionRole: input.role,
      visible: true,
      actionHint: "read",
      riskHints: ["safe_read"],
      confidence: 0.72,
      evidence: ["region inferred from landmarks, geometry, and element metadata"]
    });
    input.edges.push(edge(input.surfaceId, id, "contains", 0.76, ["surface region"]));
  }
  return id;
}

function buildContentLists(input: {
  input: BrowserViewGraphV2Input;
  nodes: BrowserViewNode[];
  edges: BrowserViewEdge[];
}): BrowserContentList[] {
  const contentNodes = input.nodes
    .filter((node) => node.elementId)
    .filter((node) => node.regionRole === "list" || node.regionRole === "main")
    .filter((node) => {
      const element = input.input.elements.find((candidate) => candidate.id === node.elementId);
      return element ? isLikelyContentElement(element) : node.kind === "content_item";
    })
    .filter((node) => node.visible)
    .sort((left, right) => (left.bbox?.y ?? 0) - (right.bbox?.y ?? 0));
  const byRegion = new Map<string, BrowserViewNode[]>();
  for (const node of contentNodes) {
    const key = node.regionId || "region-main";
    const bucket = byRegion.get(key) ?? [];
    bucket.push(node);
    byRegion.set(key, bucket);
  }
  const lists: BrowserContentList[] = [];
  for (const [regionId, items] of byRegion.entries()) {
    if (items.length < 2) {
      continue;
    }
    const representative = items
      .map((node) => ({
        node,
        score: representativeContentScore(node, node.elementId ? input.input.elements.find((element) => element.id === node.elementId) : undefined)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
      .map((item) => item.node.id);
    lists.push({
      id: `list-${hashViewGraphParts([regionId, items.map((item) => item.stableKey ?? item.id)]).slice(0, 12)}`,
      label: `${regionId.replace(/^region-/, "")} content list`,
      regionId,
      itemNodeIds: items.map((item) => item.id),
      representativeNodeIds: representative,
      confidence: Math.min(0.94, 0.56 + items.length * 0.04)
    });
  }
  return lists;
}

function addFormNode(input: { forms: Map<string, BrowserFormSummary>; node: BrowserViewNode; regionId: string }): void {
  const formId = `form-${input.regionId}`;
  const form = input.forms.get(formId) ?? {
    id: formId,
    label: `${input.regionId.replace(/^region-/, "")} form`,
    fieldNodeIds: [],
    submitNodeIds: [],
    riskHints: [],
    confidence: 0.72
  };
  if (input.node.editable || input.node.kind === "field") {
    form.fieldNodeIds.push(input.node.id);
  }
  if (input.node.actionHint === "submit") {
    form.submitNodeIds.push(input.node.id);
  }
  for (const hint of input.node.riskHints ?? []) {
    if (!form.riskHints.includes(hint)) {
      form.riskHints.push(hint);
    }
  }
  input.forms.set(formId, form);
}

function buildAffordanceIndex(nodes: BrowserViewNode[]): BrowserAffordanceIndex {
  const index: BrowserAffordanceIndex = {
    byToken: {},
    byRole: {},
    byActionHint: {},
    byRiskHint: {},
    byRegion: {},
    byList: {},
    byForm: {},
    selected: [],
    primaryControls: [],
    contentCandidates: [],
    safeReadTargets: [],
    riskyActionTargets: []
  };
  for (const node of nodes) {
    for (const token of node.tokens ?? []) pushIndex(index.byToken, token, node.id);
    if (node.role) pushIndex(index.byRole, node.role, node.id);
    if (node.actionHint) pushIndex(index.byActionHint, node.actionHint, node.id);
    for (const hint of node.riskHints ?? []) pushIndex(index.byRiskHint, hint, node.id);
    if (node.regionId) pushIndex(index.byRegion, node.regionId, node.id);
    if (node.listId) pushIndex(index.byList, node.listId, node.id);
    if (node.formId) pushIndex(index.byForm, node.formId, node.id);
    if (node.selected) index.selected.push(node.id);
    if (node.kind === "control" && node.visible && node.enabled !== false) index.primaryControls.push(node.id);
    if (node.kind === "content_item" && node.visible) index.contentCandidates.push(node.id);
    if ((node.riskHints ?? []).includes("safe_read")) index.safeReadTargets.push(node.id);
    if ((node.riskHints ?? []).some((hint) => !["safe_read", "same_page_update", "navigation"].includes(hint))) {
      index.riskyActionTargets.push(node.id);
    }
  }
  return index;
}

function representativeContentScore(node: BrowserViewNode, element?: BrowserViewGraphV2Input["elements"][number]): number {
  let score = 0;
  const labelLength = (node.label ?? "").length;
  if (isPinnedOrAnnouncementText(`${node.label ?? ""} ${node.text ?? ""} ${element?.contextText ?? ""}`)) score -= 0.38;
  if (node.href) score += 0.2;
  if (labelLength >= 8 && labelLength <= 120) score += 0.18;
  if ((node.bbox?.y ?? 10_000) >= 0) score += 0.14;
  if ((node.regionRole ?? "") === "list" || (node.regionRole ?? "") === "main") score += 0.12;
  if (node.actionHint === "navigate") score += 0.08;
  return score + (node.confidence ?? 0.5);
}

function isPinnedOrAnnouncementText(text: string): boolean {
  return /(^|[\s\[\]()/|:：-])(?:공지|고정|알림|필독|notice|announcement|pinned|sticky)(?:$|[\s\[\]()/|:：-])/i.test(text);
}

function pushIndex(index: Record<string, string[]>, key: string, nodeId: string): void {
  const bucket = index[key] ?? [];
  if (!bucket.includes(nodeId)) {
    bucket.push(nodeId);
  }
  index[key] = bucket;
}

function edge(from: string, to: string, relation: BrowserViewEdge["relation"], confidence: number, evidence: string[]): BrowserViewEdge {
  return {
    id: `edge-${hashViewGraphParts([from, to, relation]).slice(0, 12)}`,
    from,
    to,
    relation,
    confidence,
    evidence
  };
}

function bucketRect(rect: BrowserViewNode["bbox"]): string {
  if (!rect) {
    return "";
  }
  return [rect.x, rect.y, rect.w, rect.h].map((value) => Math.round(value / 16) * 16).join(",");
}

function buildWarnings(input: BrowserViewGraphV2Input, contentLists: BrowserContentList[]): string[] {
  const warnings: string[] = [];
  if (input.elements.some((element) => element.shadowRootBoundary)) {
    warnings.push("shadow DOM boundary metadata present; inner content may be partial");
  }
  if (input.elements.some((element) => element.frameUrl)) {
    warnings.push("iframe metadata present; cross-frame graph may be partial");
  }
  if (contentLists.length === 0 && input.elements.length > 12) {
    warnings.push("no repeated content list detected");
  }
  return warnings;
}
