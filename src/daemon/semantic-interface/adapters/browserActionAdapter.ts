import type { BrowserObservation } from "../../browser-action/types.js";
import { hashSemanticParts, normalizeSemanticText } from "../ontology.js";
import { DEFAULT_SEMANTIC_CAPABILITIES } from "../observation.js";
import {
  buildElementAttributes,
  inferAffordances,
  inferEntityKind,
  inferTier1Risk,
  inferTier1Role,
  isSensitiveElement,
  readElementLabel
} from "./browserActionElementMapper.js";
import { applyBrowserActionViewGraph } from "./browserActionViewGraph.js";
import type {
  SemanticEntity,
  SemanticEvidence,
  SemanticObservationAdapter,
  SemanticRelation,
  SemanticSnapshot,
} from "../types.js";

export { readElementLabel } from "./browserActionElementMapper.js";

export const browserActionSemanticAdapter: SemanticObservationAdapter<BrowserObservation> = {
  id: "browser-action",
  surfaceKinds: ["browser_page"],
  capabilities() {
    return {
      ...DEFAULT_SEMANTIC_CAPABILITIES,
      execute: true,
      snapshotImmutable: false,
      supportsDomLocator: true
    };
  },
  toSnapshot(input) {
    return browserObservationToSemanticSnapshot(input);
  }
};

export function browserObservationToSemanticSnapshot(input: {
  observation: BrowserObservation;
  previousSnapshotId?: string;
  previousActionResultId?: string;
  now?: Date;
}): SemanticSnapshot {
  const observation = input.observation;
  const createdAt = input.now?.toISOString() ?? observation.capturedAt;
  const snapshotId = `sem-browser-${hashSemanticParts([observation.id, observation.url, observation.title, observation.elements.length])}`;
  const surfaceId = `surface-${hashSemanticParts([observation.url, observation.title])}`;
  const evidence: SemanticEvidence[] = [];
  const entities: SemanticEntity[] = [
    {
      id: surfaceId,
      kind: "surface",
      surfaceId,
      label: observation.title || observation.url || "Browser page",
      normalizedLabel: normalizeSemanticText(observation.title || observation.url),
      affordances: ["read", "locate"],
      evidenceIds: [],
      tier1: { role: "observe", risk: "read_only" },
      state: { visible: true }
    }
  ];
  const relations: SemanticRelation[] = [];
  const viewNodeByElementId = new Map(
    (observation.viewGraph?.nodes ?? [])
      .filter((node) => node.elementId)
      .map((node) => [node.elementId!, node])
  );

  for (const element of observation.elements) {
    const evidenceId = `evidence-${element.id}`;
    const sensitive = isSensitiveElement(element);
    const label = sensitive ? "[redacted field]" : readElementLabel(element);
    const viewNode = viewNodeByElementId.get(element.id);
    evidence.push({
      id: evidenceId,
      snapshotId,
      adapterId: browserActionSemanticAdapter.id,
      source: "dom",
      observedAt: observation.capturedAt,
      confidence: element.confidence,
      locator: {
        selector: element.selector,
        xpath: element.xpath,
        role: element.role,
        name: label,
        bbox: element.bbox,
        opaque: { browserElementId: element.id }
      },
      value: {
        text: element.text,
        role: element.role,
        label,
        state: {
          visible: element.visible,
          enabled: element.enabled,
          editable: element.editable,
          selected: element.selected,
          checked: element.checked
        },
        attributes: buildElementAttributes(element)
      },
      redaction: sensitive
        ? { redacted: true, reason: "credential-like browser element" }
        : undefined
    });
    entities.push({
      id: `entity-${element.id}`,
      kind: inferEntityKind(element),
      surfaceId,
      label,
      normalizedLabel: normalizeSemanticText(label),
      description: `${element.role || element.tagName} ${label}`.trim(),
      affordances: inferAffordances(element),
      evidenceIds: [evidenceId],
      state: {
        selected: element.selected,
        focused: observation.focusedElementId === element.id,
        disabled: !element.enabled,
        visible: element.visible
      },
      tier1: {
        role: inferTier1Role(element),
        risk: inferTier1Risk(element)
      },
      tier2: {
        browserElementId: element.id,
        viewNodeId: viewNode?.id ?? "",
        regionRole: viewNode?.regionRole ?? "",
        role: element.role ?? "",
        tagName: element.tagName,
        redacted: sensitive ? "true" : "false"
      }
    });
    relations.push({
      from: surfaceId,
      to: `entity-${element.id}`,
      type: "contains",
      confidence: 0.9,
      evidenceIds: [evidenceId]
    });
    if (observation.focusedElementId === element.id) {
      relations.push({
        from: surfaceId,
        to: `entity-${element.id}`,
        type: "focused",
        confidence: 0.95,
        evidenceIds: [evidenceId]
      });
    }
  }
  applyBrowserActionViewGraph({
    observation,
    snapshotId,
    adapterId: browserActionSemanticAdapter.id,
    surfaceId,
    evidence,
    entities,
    relations
  });

  return {
    id: snapshotId,
    createdAt,
    surface: {
      id: surfaceId,
      kind: "browser_page",
      title: observation.title,
      url: observation.url,
      adapterId: browserActionSemanticAdapter.id,
      viewIdentityHash: observation.viewGraph?.identity.viewRevision
    },
    capabilities: browserActionSemanticAdapter.capabilities(observation),
    evidence,
    entities,
    relations,
    provenance: {
      rawObservationId: observation.id,
      previousSnapshotId: input.previousSnapshotId,
      previousActionResultId: input.previousActionResultId
    }
  };
}
