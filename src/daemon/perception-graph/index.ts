import { createHash, randomUUID } from "node:crypto";
import type {
  PerceptionActionRisk,
  PerceptionEvidenceEdge,
  PerceptionGraphNode,
  PerceptionGraphSummary
} from "../../shared/protocol.js";
import type { BrowserElement, BrowserObservation } from "../browser-action/types.js";

const DEFAULT_THRESHOLDS: Record<PerceptionActionRisk, number> = {
  read_only: 0.35,
  reversible: 0.5,
  side_effect: 0.68,
  high_risk: 0.82,
  credential: 0.92
};

export function buildPerceptionGraphFromBrowserObservation(input: {
  observation: BrowserObservation;
  sessionId?: string;
  memoryRanking?: Record<string, number>;
  createdAt?: string;
}): PerceptionGraphSummary {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const nodes = input.observation.elements.map((element) => browserElementToNode(element, input.observation, createdAt, input.memoryRanking?.[element.id]));
  return {
    id: `perception-graph-${stableHash(`${input.observation.id}:${createdAt}`).slice(0, 16)}`,
    sessionId: input.sessionId,
    source: "browser_action",
    createdAt,
    nodes,
    edges: buildGraphEdges(nodes),
    thresholds: DEFAULT_THRESHOLDS,
    diagnostics: {
      observationId: input.observation.id,
      url: input.observation.url,
      title: input.observation.title,
      nodeCount: nodes.length,
      sourceEvidence: ["dom", "browser_view_graph", "screenshot", "previous_observation"]
    }
  };
}

export function buildPerceptionGraphFromOcr(input: {
  sessionId?: string;
  text: string;
  boxes?: Array<{ text: string; bbox?: { x: number; y: number; w: number; h: number }; confidence?: number }>;
  source?: string;
  createdAt?: string;
}): PerceptionGraphSummary {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const boxes = input.boxes?.length ? input.boxes : input.text.split(/\r?\n/).filter(Boolean).slice(0, 40).map((text, index) => ({ text, confidence: 0.55, bbox: { x: 0, y: index * 24, w: Math.min(800, text.length * 12), h: 22 } }));
  const nodes: PerceptionGraphNode[] = boxes.map((box, index) => ({
    id: `ocr-node-${stableHash(`${box.text}:${index}:${createdAt}`).slice(0, 16)}`,
    role: "text",
    label: box.text.slice(0, 120),
    text: box.text,
    bbox: box.bbox,
    actionable: false,
    confidence: clamp01(box.confidence ?? 0.55),
    evidence: [
      evidence("ocr", "visible_text", box.text, box.confidence ?? 0.55, createdAt),
      evidence("ocr", "ocr_box", box.bbox, box.confidence ?? 0.55, createdAt)
    ],
    disagreementNotes: []
  }));
  return {
    id: `perception-graph-${stableHash(`ocr:${input.text}:${createdAt}`).slice(0, 16)}`,
    sessionId: input.sessionId,
    source: input.source ?? "ocr",
    createdAt,
    nodes,
    edges: buildGraphEdges(nodes),
    thresholds: DEFAULT_THRESHOLDS,
    diagnostics: { sourceEvidence: ["ocr"], textLength: input.text.length }
  };
}

export function buildPerceptionGraphFromScreenObservation(input: {
  sessionId?: string;
  text?: string;
  boxes?: Array<{ text?: string; label?: string; bbox?: { x: number; y: number; w: number; h: number }; confidence?: number }>;
  dirtyRegions?: Array<{ id?: string; bbox?: { x: number; y: number; w: number; h: number }; changedPixelsEstimate?: number }>;
  source?: string;
  createdAt?: string;
}): PerceptionGraphSummary {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const boxes: Array<{ text?: string; label?: string; bbox?: { x: number; y: number; w: number; h: number }; confidence?: number }> = input.boxes?.length
    ? input.boxes
    : (input.text ?? "").split(/\r?\n/).filter(Boolean).slice(0, 40).map((text, index) => ({
        text,
        confidence: 0.5,
        bbox: { x: 0, y: index * 24, w: Math.min(800, text.length * 12), h: 22 }
      }));
  const nodes: PerceptionGraphNode[] = boxes.map((box, index) => {
    const label = (box.text ?? box.label ?? `screen region ${index + 1}`).slice(0, 120);
    const evidenceEdges: PerceptionEvidenceEdge[] = [
      evidence("screenshot", "screenshot_region", box.bbox, box.bbox ? 0.68 : 0.2, createdAt),
      evidence("screenshot", "bbox", box.bbox, box.bbox ? 0.64 : 0.2, createdAt),
      evidence("ocr", "visible_text", box.text ?? box.label, box.confidence ?? 0.5, createdAt),
      evidence("ocr", "ocr_box", box.bbox, box.bbox ? box.confidence ?? 0.5 : 0.22, createdAt),
      evidence("screenshot", "freshness", createdAt, 0.86, createdAt),
      evidence("screenshot", "source_reliability", "screen_observe", 0.66, createdAt)
    ].filter((edge) => edge.value !== undefined && edge.value !== "");
    const dirtyRegion = findContainingDirtyRegion(box.bbox, input.dirtyRegions ?? []);
    if (dirtyRegion) {
      evidenceEdges.push(evidence("screenshot", "screenshot_region", {
        dirtyRegionId: dirtyRegion.id,
        changedPixelsEstimate: dirtyRegion.changedPixelsEstimate
      }, 0.6, createdAt));
    }
    return {
      id: `screen-node-${stableHash(`${label}:${index}:${createdAt}`).slice(0, 16)}`,
      role: "text",
      label,
      text: box.text ?? box.label,
      bbox: box.bbox,
      actionable: false,
      confidence: scoreEvidence(evidenceEdges),
      evidence: evidenceEdges,
      disagreementNotes: [],
      metadata: {
        sourceOrder: index,
        dirtyRegionId: dirtyRegion?.id
      }
    };
  });
  return {
    id: `perception-graph-${stableHash(`screen:${input.text ?? ""}:${boxes.length}:${createdAt}`).slice(0, 16)}`,
    sessionId: input.sessionId,
    source: input.source ?? "screen_observe",
    createdAt,
    nodes,
    edges: buildGraphEdges(nodes),
    thresholds: DEFAULT_THRESHOLDS,
    diagnostics: {
      sourceEvidence: ["screenshot", "ocr"],
      textLength: input.text?.length ?? 0,
      dirtyRegionCount: input.dirtyRegions?.length ?? 0
    }
  };
}

export function buildPerceptionGraphFromNativeObservation(input: {
  sessionId?: string;
  snapshot: {
    url?: string;
    title?: string;
    text?: string;
    elements?: Array<{
      id?: string;
      role?: string;
      tagName?: string;
      label?: string;
      text?: string;
      selector?: string;
      bbox?: { x: number; y: number; w: number; h: number };
      visible?: boolean;
      enabled?: boolean;
      confidence?: number;
      riskHints?: string[];
    }>;
  };
  source?: string;
  createdAt?: string;
}): PerceptionGraphSummary {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const elements = input.snapshot.elements ?? [];
  const nodes: PerceptionGraphNode[] = elements.map((element, index) => {
    const evidenceEdges: PerceptionEvidenceEdge[] = [
      evidence("uia", "semantic_label", element.label || element.text || element.id, element.confidence ?? 0.7, createdAt),
      evidence("uia", "accessibility_role", element.role, roleReliability(element.role), createdAt),
      evidence("uia", "visible_text", element.text, element.text ? 0.72 : 0.25, createdAt),
      evidence("uia", "uia_selector", element.selector, element.selector ? 0.78 : 0.2, createdAt),
      evidence("uia", "bbox", element.bbox, element.bbox ? 0.68 : 0.2, createdAt),
      evidence("uia", "freshness", createdAt, 0.84, createdAt),
      evidence("uia", "source_reliability", "native_browser_window_helper", 0.78, createdAt)
    ].filter((edge) => edge.value !== undefined && edge.value !== "");
    return {
      id: `native-node-${stableHash(`${input.snapshot.url ?? ""}:${element.id ?? index}:${createdAt}`).slice(0, 16)}`,
      role: element.role,
      label: element.label || element.text?.slice(0, 120) || element.id,
      text: element.text,
      bbox: element.bbox,
      actionable: element.visible !== false && element.enabled !== false,
      confidence: scoreEvidence(evidenceEdges),
      evidence: evidenceEdges,
      disagreementNotes: detectNativeDisagreements(element),
      metadata: {
        elementId: element.id,
        tagName: element.tagName,
        sourceOrder: index,
        selector: element.selector,
        url: input.snapshot.url,
        title: input.snapshot.title
      }
    };
  });
  return {
    id: `perception-graph-${stableHash(`native:${input.snapshot.url ?? ""}:${input.snapshot.title ?? ""}:${createdAt}`).slice(0, 16)}`,
    sessionId: input.sessionId,
    source: input.source ?? "native_browser_window",
    createdAt,
    nodes,
    edges: buildGraphEdges(nodes),
    thresholds: DEFAULT_THRESHOLDS,
    diagnostics: {
      sourceEvidence: ["uia"],
      url: input.snapshot.url,
      title: input.snapshot.title,
      textLength: input.snapshot.text?.length ?? 0,
      nodeCount: nodes.length
    }
  };
}

export function explainPerceptionTarget(input: {
  graph: PerceptionGraphSummary;
  nodeId?: string;
  risk: PerceptionActionRisk;
}): {
  allowed: boolean;
  threshold: number;
  confidence: number;
  evidenceCount: number;
  disagreementNotes: string[];
  reason: string;
} {
  const node = input.graph.nodes.find((candidate) => candidate.id === input.nodeId || candidate.metadata?.elementId === input.nodeId);
  const threshold = input.graph.thresholds[input.risk] ?? DEFAULT_THRESHOLDS[input.risk];
  if (!node) {
    return { allowed: false, threshold, confidence: 0, evidenceCount: 0, disagreementNotes: [], reason: "No perception graph node matched the target." };
  }
  const confidence = scoreNodeEvidence(node);
  const disagreementNotes = node.disagreementNotes ?? [];
  const allowed = confidence >= threshold && (input.risk === "read_only" || disagreementNotes.length === 0);
  return {
    allowed,
    threshold,
    confidence,
    evidenceCount: node.evidence.length,
    disagreementNotes,
    reason: allowed
      ? `Perception evidence passed ${input.risk} threshold.`
      : disagreementNotes.length > 0
        ? "Perception evidence disagrees; clarification or abstention is required."
        : `Perception confidence ${confidence.toFixed(2)} is below ${input.risk} threshold ${threshold.toFixed(2)}.`
  };
}

export type PerceptionTargetArbitrationResult = {
  schemaVersion: "perception-target-arbitration.v1";
  graphCount: number;
  candidateCount: number;
  staleGraphCount: number;
  selected?: {
    graph: PerceptionGraphSummary;
    node: PerceptionGraphNode;
    explanation: ReturnType<typeof explainPerceptionTarget>;
    candidate: PerceptionTargetCandidate;
  };
  candidates: PerceptionTargetCandidate[];
  reason: string;
};

type PerceptionTargetCandidate = {
  graphId: string;
  graphSource: string;
  graphAgeMs: number;
  nodeId: string;
  elementId?: string;
  label?: string;
  role?: string;
  matchReason: string;
  matchConfidence: number;
  score: number;
  allowed: boolean;
  confidence: number;
  threshold: number;
  evidenceCount: number;
  disagreementNotes: string[];
  evidenceSources: string[];
  evidenceClasses: string[];
};

export function arbitratePerceptionTarget(input: {
  graphs: PerceptionGraphSummary[];
  target: {
    nodeId?: string;
    elementId?: string;
    label?: string;
    text?: string;
  };
  risk: PerceptionActionRisk;
  now?: string;
  maxGraphAgeMs?: number;
}): PerceptionTargetArbitrationResult {
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const maxGraphAgeMs = input.maxGraphAgeMs ?? 60_000;
  const uniqueGraphs = uniquePerceptionGraphs(input.graphs);
  const candidates: PerceptionTargetCandidate[] = [];
  let staleGraphCount = 0;
  for (const graph of uniqueGraphs) {
    const graphAgeMs = Math.max(0, nowMs - Date.parse(graph.createdAt));
    if (!Number.isFinite(graphAgeMs) || graphAgeMs > maxGraphAgeMs) {
      staleGraphCount += 1;
      continue;
    }
    for (const node of graph.nodes) {
      const match = matchTargetNode(node, input.target);
      if (!match) {
        continue;
      }
      const explanation = explainPerceptionTarget({ graph, nodeId: node.id, risk: input.risk });
      const requiresActionable = input.risk !== "read_only";
      const allowed = explanation.allowed && (!requiresActionable || node.actionable);
      const disagreementNotes = [
        ...explanation.disagreementNotes,
        ...(requiresActionable && !node.actionable ? ["target_not_actionable"] : [])
      ];
      const freshnessBonus = Math.max(0, 1 - graphAgeMs / maxGraphAgeMs) * 0.08;
      const disagreementPenalty = disagreementNotes.length * 0.08;
      const score = clamp01((explanation.confidence * 0.7) + (match.confidence * 0.22) + freshnessBonus - disagreementPenalty);
      candidates.push({
        graphId: graph.id,
        graphSource: graph.source,
        graphAgeMs,
        nodeId: node.id,
        elementId: typeof node.metadata?.elementId === "string" ? node.metadata.elementId : undefined,
        label: node.label,
        role: node.role,
        matchReason: match.reason,
        matchConfidence: match.confidence,
        score,
        allowed,
        confidence: explanation.confidence,
        threshold: explanation.threshold,
        evidenceCount: explanation.evidenceCount,
        disagreementNotes,
        evidenceSources: [...new Set(node.evidence.map((edge) => edge.source))],
        evidenceClasses: [...new Set(node.evidence.map((edge) => edge.class))]
      });
    }
  }
  candidates.sort((left, right) => {
    if (left.allowed !== right.allowed) {
      return left.allowed ? -1 : 1;
    }
    return right.score - left.score;
  });
  const selectedCandidate = candidates[0];
  if (!selectedCandidate) {
    return {
      schemaVersion: "perception-target-arbitration.v1",
      graphCount: uniqueGraphs.length,
      candidateCount: 0,
      staleGraphCount,
      candidates: [],
      reason: staleGraphCount === uniqueGraphs.length && uniqueGraphs.length > 0
        ? "No fresh perception graph was available for target arbitration."
        : "No perception graph candidate matched the requested target."
    };
  }
  const selectedGraph = uniqueGraphs.find((graph) => graph.id === selectedCandidate.graphId);
  const selectedNode = selectedGraph?.nodes.find((node) => node.id === selectedCandidate.nodeId);
  if (!selectedGraph || !selectedNode) {
    return {
      schemaVersion: "perception-target-arbitration.v1",
      graphCount: uniqueGraphs.length,
      candidateCount: candidates.length,
      staleGraphCount,
      candidates: candidates.slice(0, 8),
      reason: "The selected perception graph candidate could not be reloaded."
    };
  }
  return {
    schemaVersion: "perception-target-arbitration.v1",
    graphCount: uniqueGraphs.length,
    candidateCount: candidates.length,
    staleGraphCount,
    selected: {
      graph: selectedGraph,
      node: selectedNode,
      explanation: explainArbitratedTarget(selectedGraph, selectedNode, input.risk),
      candidate: selectedCandidate
    },
    candidates: candidates.slice(0, 8),
    reason: selectedCandidate.allowed
      ? `Selected ${selectedCandidate.matchReason} target from ${selectedCandidate.graphSource}.`
      : `Best target candidate did not pass ${input.risk} threshold.`
  };
}

function explainArbitratedTarget(
  graph: PerceptionGraphSummary,
  node: PerceptionGraphNode,
  risk: PerceptionActionRisk
): ReturnType<typeof explainPerceptionTarget> {
  const explanation = explainPerceptionTarget({ graph, nodeId: node.id, risk });
  if (risk === "read_only" || node.actionable) {
    return explanation;
  }
  return {
    ...explanation,
    allowed: false,
    disagreementNotes: [...explanation.disagreementNotes, "target_not_actionable"],
    reason: "Perception target is visible but not actionable; structured or current UI evidence is required before a side-effect action."
  };
}

function browserElementToNode(
  element: BrowserElement,
  observation: BrowserObservation,
  createdAt: string,
  memoryRank?: number
): PerceptionGraphNode {
  const evidenceEdges: PerceptionEvidenceEdge[] = [
    evidence("dom", "semantic_label", element.label || element.text || element.id, element.confidence, createdAt),
    evidence("dom", "accessibility_role", element.role, roleReliability(element.role), createdAt),
    evidence("dom", "visible_text", element.text, element.text ? 0.78 : 0.25, createdAt),
    evidence("dom", "dom_selector", element.selector, element.selector ? 0.8 : 0.2, createdAt),
    evidence("dom", "bbox", element.bbox, element.bbox ? 0.72 : 0.2, createdAt),
    evidence("browser_view_graph", "freshness", observation.capturedAt, freshnessConfidence(observation.capturedAt), createdAt),
    evidence("dom", "source_reliability", "browser_dom", 0.82, createdAt)
  ].filter((edge) => edge.value !== undefined && edge.value !== "");
  if (memoryRank !== undefined) {
    evidenceEdges.push(evidence("memory", "memory_prior", { rankingDelta: memoryRank }, Math.min(0.2, Math.abs(memoryRank)), createdAt));
  }
  const confidence = scoreEvidence(evidenceEdges);
  return {
    id: `browser-node-${stableHash(`${observation.id}:${element.id}`).slice(0, 16)}`,
    role: element.role,
    label: element.label || element.text?.slice(0, 120) || element.id,
    text: element.text,
    bbox: element.bbox,
    actionable: element.visible && element.enabled !== false,
    confidence,
    evidence: evidenceEdges,
    disagreementNotes: detectDisagreements(element),
    metadata: {
      elementId: element.id,
      tagName: element.tagName,
      sourceOrder: element.sourceOrder,
      url: observation.url
    }
  };
}

function buildGraphEdges(nodes: PerceptionGraphNode[]): PerceptionGraphSummary["edges"] {
  const edges: PerceptionGraphSummary["edges"] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < Math.min(nodes.length, i + 6); j += 1) {
      const left = nodes[i];
      const right = nodes[j];
      if (!left || !right) continue;
      if (left.bbox && right.bbox && contains(left.bbox, right.bbox)) {
        edges.push({ from: left.id, to: right.id, relation: "contains", confidence: 0.7 });
      } else if (left.bbox && right.bbox && distance(left.bbox, right.bbox) < 180) {
        edges.push({ from: left.id, to: right.id, relation: "near", confidence: 0.55 });
      }
      if (left.label && right.text && right.text.includes(left.label)) {
        edges.push({ from: left.id, to: right.id, relation: "labels", confidence: 0.62 });
      }
    }
  }
  return edges;
}

function evidence(
  source: PerceptionEvidenceEdge["source"],
  evidenceClass: PerceptionEvidenceEdge["class"],
  value: unknown,
  confidence: number,
  observedAt: string
): PerceptionEvidenceEdge {
  return {
    id: `evidence-${randomUUID()}`,
    source,
    class: evidenceClass,
    value,
    confidence: clamp01(confidence),
    reliability: source === "memory" ? 0.2 : source === "ocr" ? 0.62 : source === "uia" ? 0.78 : 0.82,
    observedAt
  };
}

function scoreNodeEvidence(node: PerceptionGraphNode): number {
  return Math.max(node.confidence, scoreEvidence(node.evidence));
}

function scoreEvidence(edges: PerceptionEvidenceEdge[]): number {
  if (edges.length === 0) return 0;
  const weighted = edges.reduce((sum, edge) => sum + edge.confidence * edge.reliability, 0);
  const denom = edges.reduce((sum, edge) => sum + edge.reliability, 0);
  return clamp01(weighted / Math.max(0.001, denom) + Math.min(0.16, edges.length * 0.018));
}

function roleReliability(role: string | undefined): number {
  return role && role !== "generic" ? 0.76 : 0.35;
}

function freshnessConfidence(capturedAt: string): number {
  const ageMs = Date.now() - Date.parse(capturedAt);
  if (!Number.isFinite(ageMs)) return 0.45;
  if (ageMs < 2_000) return 0.95;
  if (ageMs < 10_000) return 0.78;
  if (ageMs < 60_000) return 0.48;
  return 0.22;
}

function detectDisagreements(element: BrowserElement): string[] {
  const notes: string[] = [];
  if (!element.visible) notes.push("element_not_visible");
  if (element.enabled === false) notes.push("element_disabled");
  if (element.riskHints?.some((hint) => hint === "password" || hint === "payment" || hint === "auth")) notes.push("credential_risk_hint");
  return notes;
}

function detectNativeDisagreements(element: { visible?: boolean; enabled?: boolean; riskHints?: string[] }): string[] {
  const notes: string[] = [];
  if (element.visible === false) notes.push("element_not_visible");
  if (element.enabled === false) notes.push("element_disabled");
  if (element.riskHints?.some((hint) => hint === "password" || hint === "payment" || hint === "auth")) notes.push("credential_risk_hint");
  return notes;
}

function contains(outer: NonNullable<PerceptionGraphNode["bbox"]>, inner: NonNullable<PerceptionGraphNode["bbox"]>): boolean {
  return inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h;
}

function distance(left: NonNullable<PerceptionGraphNode["bbox"]>, right: NonNullable<PerceptionGraphNode["bbox"]>): number {
  return Math.hypot(left.x + left.w / 2 - (right.x + right.w / 2), left.y + left.h / 2 - (right.y + right.h / 2));
}

function findContainingDirtyRegion(
  bbox: { x: number; y: number; w: number; h: number } | undefined,
  dirtyRegions: Array<{ id?: string; bbox?: { x: number; y: number; w: number; h: number }; changedPixelsEstimate?: number }>
): { id?: string; bbox?: { x: number; y: number; w: number; h: number }; changedPixelsEstimate?: number } | undefined {
  if (!bbox) {
    return undefined;
  }
  return dirtyRegions.find((region) => region.bbox && contains(region.bbox, bbox));
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function uniquePerceptionGraphs(graphs: PerceptionGraphSummary[]): PerceptionGraphSummary[] {
  const seen = new Set<string>();
  const unique: PerceptionGraphSummary[] = [];
  for (const graph of graphs) {
    if (seen.has(graph.id)) {
      continue;
    }
    seen.add(graph.id);
    unique.push(graph);
  }
  return unique;
}

function matchTargetNode(
  node: PerceptionGraphNode,
  target: { nodeId?: string; elementId?: string; label?: string; text?: string }
): { reason: string; confidence: number } | null {
  const elementId = typeof node.metadata?.elementId === "string" ? node.metadata.elementId : undefined;
  if (target.nodeId && (node.id === target.nodeId || elementId === target.nodeId)) {
    return { reason: "node_id", confidence: 1 };
  }
  if (target.elementId && (elementId === target.elementId || node.id === target.elementId)) {
    return { reason: "element_id", confidence: 1 };
  }
  const targetLabel = normalizeTargetText(target.label);
  const targetText = normalizeTargetText(target.text);
  const nodeLabel = normalizeTargetText(node.label);
  const nodeText = normalizeTargetText(node.text);
  if (targetLabel && nodeLabel) {
    if (targetLabel === nodeLabel) {
      return { reason: "label_exact", confidence: 0.82 };
    }
    if (targetLabel.includes(nodeLabel) || nodeLabel.includes(targetLabel)) {
      return { reason: "label_partial", confidence: 0.62 };
    }
  }
  if (targetText && nodeText) {
    if (targetText === nodeText) {
      return { reason: "text_exact", confidence: 0.74 };
    }
    if (targetText.includes(nodeText) || nodeText.includes(targetText)) {
      return { reason: "text_partial", confidence: 0.54 };
    }
  }
  return null;
}

function normalizeTargetText(value: string | undefined): string {
  return value?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
}
