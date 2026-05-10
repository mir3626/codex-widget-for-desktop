import type { BrowserObservation } from "../../browser-action/types.js";
import { normalizeSemanticText } from "../ontology.js";
import type {
  SemanticEntity,
  SemanticEvidence,
  SemanticRelation,
  SemanticRelationType
} from "../types.js";

export function applyBrowserActionViewGraph(input: {
  observation: BrowserObservation;
  snapshotId: string;
  adapterId: string;
  surfaceId: string;
  evidence: SemanticEvidence[];
  entities: SemanticEntity[];
  relations: SemanticRelation[];
}): void {
  const graph = input.observation.viewGraph;
  if (!graph) {
    return;
  }
  const nodeToEntity = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.elementId) {
      nodeToEntity.set(node.id, `entity-${node.elementId}`);
      const entity = input.entities.find((candidate) => candidate.id === `entity-${node.elementId}`);
      if (entity) {
        entity.tier2 = {
          ...entity.tier2,
          viewNodeId: node.id,
          regionRole: node.regionRole ?? "",
          viewRevision: graph.identity.viewRevision
        };
      }
      continue;
    }
    if (node.kind !== "region" && node.kind !== "list" && node.kind !== "modal" && node.kind !== "form") {
      continue;
    }
    const evidenceId = `evidence-view-${node.id}`;
    const entityId = `entity-view-${node.id}`;
    input.evidence.push({
      id: evidenceId,
      snapshotId: input.snapshotId,
      adapterId: input.adapterId,
      source: "dom",
      observedAt: graph.identity.capturedAt,
      confidence: 0.7,
      locator: {
        bbox: node.bbox,
        role: node.role,
        name: node.label,
        opaque: { viewNodeId: node.id, regionRole: node.regionRole }
      },
      value: {
        label: node.label,
        role: node.role,
        attributes: {
          viewNodeKind: node.kind,
          regionRole: node.regionRole ?? "unknown",
          viewRevision: graph.identity.viewRevision
        }
      }
    });
    input.entities.push({
      id: entityId,
      kind: "region",
      surfaceId: input.surfaceId,
      label: node.label ?? node.regionRole ?? node.id,
      normalizedLabel: normalizeSemanticText(node.label ?? node.regionRole ?? node.id),
      affordances: ["read", "locate"],
      evidenceIds: [evidenceId],
      state: { visible: node.visible },
      tier1: { role: "locate", risk: "read_only" },
      tier2: {
        viewNodeId: node.id,
        regionRole: node.regionRole ?? "",
        viewRevision: graph.identity.viewRevision
      }
    });
    nodeToEntity.set(node.id, entityId);
  }
  for (const edge of graph.edges) {
    const from = nodeToEntity.get(edge.from);
    const to = nodeToEntity.get(edge.to);
    if (!from || !to) {
      continue;
    }
    input.relations.push({
      from,
      to,
      type: semanticRelationForViewEdge(edge.relation),
      confidence: edge.confidence,
      evidenceIds: []
    });
  }
}

function semanticRelationForViewEdge(relation: string): SemanticRelationType {
  if (relation === "same_group" || relation === "filters" || relation === "submits" || relation === "navigates_to" || relation === "item_of" || relation === "labels") {
    return relation;
  }
  return "contains";
}
