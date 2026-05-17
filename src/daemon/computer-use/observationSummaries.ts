import type {
  CapabilityJobKind,
  CapabilityJobSummary,
  ComputerSessionActionFeedbackSummary,
  ComputerSessionObservationKind,
  ComputerSessionObservationSummary,
  PerceptionActionRisk,
  PerceptionGraphSummary
} from "../../shared/protocol.js";
import type { BrowserActionResult, BrowserObservation } from "../browser-action/index.js";
import { arbitratePerceptionTarget, buildPerceptionGraphFromNativeObservation } from "../perception-graph/index.js";
import type { StorageService } from "../storage/storage.js";
import { readUnknownRecord } from "./sessionRecordUtils.js";

export function mapCapabilityKindToObservationKind(kind: CapabilityJobKind): ComputerSessionObservationKind | null {
  if (kind === "screen_observe" || kind === "desktop_action") {
    return "screen";
  }
  if (kind === "ocr") {
    return "ocr";
  }
  if (kind === "terminal") {
    return "terminal";
  }
  if (kind === "browser_action" || kind === "browser_chrome") {
    return "browser_dom";
  }
  return null;
}

export function readComputerSessionIdFromBrowserAction(actionSessionId: string): string | undefined {
  const prefix = "computer-session-browser-action:";
  return actionSessionId.startsWith(prefix) ? actionSessionId.slice(prefix.length) : undefined;
}

export function summarizeBrowserObservationForSession(observation: BrowserObservation): Record<string, unknown> {
  return {
    id: observation.id,
    url: observation.url,
    title: observation.title,
    capturedAt: observation.capturedAt,
    readyState: observation.readyState,
    textLength: observation.text?.length ?? 0,
    elementCount: observation.elements.length,
    viewport: observation.viewport,
    focusedElementId: observation.focusedElementId
  };
}

export function summarizeObservationFeedbackReference(observation: ComputerSessionObservationSummary): Record<string, unknown> {
  const metadata = observation.metadata ?? {};
  return {
    observationId: observation.id,
    kind: observation.kind,
    source: observation.source,
    capturedAt: observation.capturedAt,
    freshness: observation.freshness,
    perceptionGraphId: observation.perceptionGraphId,
    elementCount: typeof metadata.elementCount === "number" ? metadata.elementCount : undefined,
    graphNodeCount: typeof metadata.perceptionGraphNodeCount === "number" ? metadata.perceptionGraphNodeCount : undefined,
    url: typeof metadata.url === "string" ? metadata.url : undefined,
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    verification: typeof metadata.verification === "string" ? metadata.verification : undefined
  };
}

export function mapBrowserActionStatusToFeedbackStatus(status: BrowserActionResult["status"]): ComputerSessionActionFeedbackSummary["status"] {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "failed" || status === "cancelled") {
    return "failed";
  }
  if (status === "needs_approval" || status === "needs_clarification") {
    return "blocked";
  }
  return "unknown";
}

export function summarizeBrowserActionTargetEvidence(
  result: BrowserActionResult,
  graphs: PerceptionGraphSummary[],
  currentGraphId?: string
): Record<string, unknown> | undefined {
  const elementId = result.target?.id ?? result.transaction?.candidateId;
  if (!elementId) {
    return undefined;
  }
  const risk = mapBrowserActionRiskToPerceptionRisk(result);
  const graphSet = summarizeTargetGraphSet(graphs, currentGraphId);
  const arbitration = arbitratePerceptionTarget({
    graphs,
    target: {
      elementId,
      label: result.target?.label,
      text: result.target?.text
    },
    risk,
    maxGraphAgeMs: 60_000
  });
  if (!arbitration.selected) {
    return {
      schemaVersion: "computer-session-target-evidence.v1",
      elementId,
      action: result.action.type,
      risk,
      allowed: false,
      confidence: 0,
      evidenceCount: 0,
      arbitration: {
        schemaVersion: arbitration.schemaVersion,
        graphCount: arbitration.graphCount,
        candidateCount: arbitration.candidateCount,
        staleGraphCount: arbitration.staleGraphCount,
        graphSet,
        candidateSources: summarizeArbitrationCandidateSources(arbitration.candidates),
        reason: arbitration.reason
      },
      reason: arbitration.reason
    };
  }
  const { graph, node, explanation, candidate } = arbitration.selected;
  const evidenceSources = [...new Set(node.evidence.map((edge) => edge.source))].slice(0, 8);
  const evidenceClasses = [...new Set(node.evidence.map((edge) => edge.class))].slice(0, 12);
  return {
    schemaVersion: "computer-session-target-evidence.v1",
    graphId: graph.id,
    nodeId: node.id,
    elementId,
    action: result.action.type,
    risk,
    threshold: explanation.threshold,
    allowed: explanation.allowed,
    confidence: Number(explanation.confidence.toFixed(3)),
    evidenceCount: explanation.evidenceCount,
    evidenceSources,
    evidenceClasses,
    disagreementNotes: explanation.disagreementNotes,
    arbitration: {
      schemaVersion: arbitration.schemaVersion,
      graphCount: arbitration.graphCount,
      candidateCount: arbitration.candidateCount,
      staleGraphCount: arbitration.staleGraphCount,
      selectedScore: Number(candidate.score.toFixed(3)),
      selectedMatchReason: candidate.matchReason,
      selectedGraphSource: candidate.graphSource,
      graphSet,
      candidateSources: summarizeArbitrationCandidateSources(arbitration.candidates),
      reason: arbitration.reason
    },
    reason: explanation.reason,
    target: {
      label: node.label,
      role: node.role,
      hasBbox: Boolean(node.bbox),
      actionable: node.actionable
    }
  };
}

export function collectSessionTargetGraphs(input: {
  currentGraph: PerceptionGraphSummary;
  sessionId: string;
  storage: StorageService;
  observations: ComputerSessionObservationSummary[];
}): PerceptionGraphSummary[] {
  const graphs: PerceptionGraphSummary[] = [input.currentGraph];
  const observationGraphIds = new Set(input.observations
    .map((observation) => observation.perceptionGraphId)
    .filter((id): id is string => typeof id === "string" && id.length > 0));
  for (const graphId of observationGraphIds) {
    const graph = input.storage.readPerceptionGraph(graphId);
    if (graph) {
      graphs.push(graph);
    }
  }
  graphs.push(...input.storage.listPerceptionGraphs({ sessionId: input.sessionId, limit: 50 }));
  return uniqueGraphsById(graphs);
}

export function uniqueGraphsById(graphs: PerceptionGraphSummary[]): PerceptionGraphSummary[] {
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

export function summarizeTargetGraphSet(graphs: PerceptionGraphSummary[], currentGraphId?: string): Record<string, unknown> {
  const sources = new Map<string, { graphCount: number; nodeCount: number; actionableNodeCount: number }>();
  for (const graph of graphs) {
    const current = sources.get(graph.source) ?? { graphCount: 0, nodeCount: 0, actionableNodeCount: 0 };
    current.graphCount += 1;
    current.nodeCount += graph.nodes.length;
    current.actionableNodeCount += graph.nodes.filter((node) => node.actionable).length;
    sources.set(graph.source, current);
  }
  const sourceBreakdown = [...sources.entries()].map(([source, summary]) => ({
    source,
    ...summary
  }));
  return {
    schemaVersion: "computer-session-target-graph-set.v1",
    graphCount: graphs.length,
    sourceCount: sourceBreakdown.length,
    sourceBreakdown,
    currentGraphId,
    includesCurrentGraph: Boolean(currentGraphId && graphs.some((graph) => graph.id === currentGraphId)),
    observationLinkedGraphCount: graphs.filter((graph) => graph.id !== currentGraphId).length
  };
}

export function summarizeArbitrationCandidateSources(candidates: Array<{
  graphSource: string;
  allowed: boolean;
  evidenceSources: string[];
  evidenceClasses: string[];
}>): Array<Record<string, unknown>> {
  const grouped = new Map<string, {
    candidateCount: number;
    allowedCount: number;
    evidenceSources: Set<string>;
    evidenceClasses: Set<string>;
  }>();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.graphSource) ?? {
      candidateCount: 0,
      allowedCount: 0,
      evidenceSources: new Set<string>(),
      evidenceClasses: new Set<string>()
    };
    current.candidateCount += 1;
    if (candidate.allowed) {
      current.allowedCount += 1;
    }
    for (const source of candidate.evidenceSources) {
      current.evidenceSources.add(source);
    }
    for (const evidenceClass of candidate.evidenceClasses) {
      current.evidenceClasses.add(evidenceClass);
    }
    grouped.set(candidate.graphSource, current);
  }
  return [...grouped.entries()].map(([graphSource, summary]) => ({
    graphSource,
    candidateCount: summary.candidateCount,
    allowedCount: summary.allowedCount,
    evidenceSources: [...summary.evidenceSources].slice(0, 8),
    evidenceClasses: [...summary.evidenceClasses].slice(0, 12)
  }));
}

export function mapBrowserActionRiskToPerceptionRisk(result: BrowserActionResult): PerceptionActionRisk {
  if (result.safety.risk === "high") {
    return result.safety.metadata?.credentialRisk === true ? "credential" : "high_risk";
  }
  if (result.action.type === "read" || result.action.type === "screenshot") {
    return "read_only";
  }
  if (result.safety.risk === "medium" || result.safety.destructive) {
    return "side_effect";
  }
  return result.action.type === "navigate" || result.action.type === "back" || result.action.type === "forward" || result.action.type === "reload"
    ? "reversible"
    : "side_effect";
}

export function readPerceptionGraphIdFromCapabilityOutput(output: unknown): string | undefined {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const graph = record.perceptionGraph && typeof record.perceptionGraph === "object" ? record.perceptionGraph as Record<string, unknown> : undefined;
  return typeof graph?.id === "string" ? graph.id : undefined;
}

export function readNativeHelperSnapshotFromCapabilityOutput(output: unknown): Parameters<typeof buildPerceptionGraphFromNativeObservation>[0]["snapshot"] | undefined {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  for (const key of ["after", "observation"]) {
    const candidate = record[key];
    if (isNativeHelperSnapshotLike(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function isNativeHelperSnapshotLike(value: unknown): value is Parameters<typeof buildPerceptionGraphFromNativeObservation>[0]["snapshot"] {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Array.isArray(record.elements) &&
    (typeof record.title === "string" || typeof record.url === "string" || typeof record.text === "string");
}

export function readDagNodeIdFromCapabilityJob(job: CapabilityJobSummary): string | undefined {
  const record = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as Record<string, unknown> : {};
  return typeof record.dagNodeId === "string" ? record.dagNodeId : undefined;
}

export function readDagRunIdFromCapabilityJob(job: CapabilityJobSummary): string | undefined {
  const record = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as Record<string, unknown> : {};
  return typeof record.dagRunId === "string" ? record.dagRunId : undefined;
}

export function readTextFromCapabilityOutput(output: unknown): string | undefined {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const text = typeof record.text === "string" ? record.text : undefined;
  if (text?.trim()) {
    return text;
  }
  const nested = record.output && typeof record.output === "object" ? record.output as Record<string, unknown> : undefined;
  return typeof nested?.text === "string" && nested.text.trim() ? nested.text : undefined;
}
