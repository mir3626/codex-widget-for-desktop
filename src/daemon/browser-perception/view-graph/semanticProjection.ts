import type {
  BrowserViewGraph,
  BrowserViewNode
} from "../../browser-action/types.js";

export type BrowserViewGraphEvidencePacket = {
  nodeId: string;
  kind: BrowserViewNode["kind"];
  label?: string;
  role?: string;
  regionRole?: BrowserViewNode["regionRole"];
  actionHint?: BrowserViewNode["actionHint"];
  riskHints: NonNullable<BrowserViewNode["riskHints"]>;
  listId?: string;
  formId?: string;
  freshness?: BrowserViewGraph["identity"]["freshness"];
  confidence: number;
};

export function projectBrowserViewGraphEvidence(graph: BrowserViewGraph | undefined): BrowserViewGraphEvidencePacket[] {
  if (!graph) {
    return [];
  }
  return graph.nodes
    .filter((node) => node.kind !== "surface")
    .map((node) => ({
      nodeId: node.id,
      kind: node.kind,
      label: node.label,
      role: node.role,
      regionRole: node.regionRole,
      actionHint: node.actionHint,
      riskHints: node.riskHints ?? [],
      listId: node.listId,
      formId: node.formId,
      freshness: graph.identity.freshness,
      confidence: node.confidence ?? 0.5
    }));
}
