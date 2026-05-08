import type { CapsuleEvidence, ContextEntity, TaskCapsule } from "../../vision-context/types.js";
import { compactSemanticText, hashSemanticParts, normalizeSemanticText } from "../ontology.js";
import { DEFAULT_SEMANTIC_CAPABILITIES } from "../observation.js";
import type {
  SemanticAffordance,
  SemanticEntity,
  SemanticEvidence,
  SemanticEvidenceSource,
  SemanticObservationAdapter,
  SemanticRelation,
  SemanticSnapshot,
  SemanticSurfaceKind
} from "../types.js";

export const visionContextSemanticAdapter: SemanticObservationAdapter<TaskCapsule> = {
  id: "vision-context",
  surfaceKinds: ["desktop_screen", "browser_page", "app_window", "media_stream"],
  capabilities() {
    return {
      ...DEFAULT_SEMANTIC_CAPABILITIES,
      execute: false,
      snapshotImmutable: true,
      revalidateBeforeExecute: false,
      supportsVisionOnly: true,
      supportsOcrLocator: true
    };
  },
  toSnapshot(input) {
    return taskCapsuleToSemanticSnapshot(input);
  }
};

export function taskCapsuleToSemanticSnapshot(input: {
  observation: TaskCapsule;
  previousSnapshotId?: string;
  previousActionResultId?: string;
  now?: Date;
}): SemanticSnapshot {
  const capsule = input.observation;
  const surfaceKind = readVisionSurfaceKind(capsule);
  const surfaceId = `surface-${hashSemanticParts([capsule.captureSessionId, capsule.source?.windowTitle, capsule.source?.url])}`;
  const snapshotId = `sem-vision-${hashSemanticParts([capsule.id, capsule.captureSessionId, capsule.evidence.length])}`;
  const evidence = capsule.evidence.map((item, index) => visionEvidenceToSemanticEvidence({
    evidence: item,
    snapshotId,
    index,
    observedAt: capsule.createdAt
  }));
  const entities: SemanticEntity[] = [
    {
      id: surfaceId,
      kind: "surface",
      surfaceId,
      label: capsule.source?.windowTitle || capsule.source?.appName || capsule.source?.url || "Captured visual context",
      normalizedLabel: normalizeSemanticText(capsule.source?.windowTitle || capsule.source?.appName || capsule.source?.url || "captured visual context"),
      affordances: ["read", "locate"],
      evidenceIds: [],
      tier1: { role: "observe", risk: "read_only" },
      state: { visible: true }
    }
  ];
  const relations: SemanticRelation[] = [];

  for (const entity of [...capsule.referents, ...(capsule.actionTarget ? [capsule.actionTarget] : []), ...capsule.alternatives]) {
    const semanticEntity = contextEntityToSemanticEntity({ entity, capsule, surfaceId });
    if (entities.some((candidate) => candidate.id === semanticEntity.id)) {
      continue;
    }
    entities.push(semanticEntity);
    relations.push({
      from: surfaceId,
      to: semanticEntity.id,
      type: entity.role === "action_target" ? "focused" : "contains",
      confidence: entity.confidence,
      evidenceIds: semanticEntity.evidenceIds
    });
  }

  for (const item of evidence) {
    if (!entities.some((entity) => entity.evidenceIds.includes(item.id))) {
      const entityId = `entity-${item.id}`;
      entities.push({
        id: entityId,
        kind: item.source === "visual" ? "region" : "content_item",
        surfaceId,
        label: item.value?.label || item.value?.text || item.locator?.name || item.id,
        normalizedLabel: normalizeSemanticText(item.value?.label || item.value?.text || item.locator?.name || item.id),
        affordances: ["read", "locate"],
        evidenceIds: [item.id],
        state: { visible: true },
        tier1: { role: "locate", risk: "read_only" }
      });
      relations.push({ from: surfaceId, to: entityId, type: "contains", confidence: item.confidence, evidenceIds: [item.id] });
    }
  }

  return {
    id: snapshotId,
    createdAt: input.now?.toISOString() ?? capsule.createdAt,
    surface: {
      id: surfaceId,
      kind: surfaceKind,
      title: capsule.source?.windowTitle || capsule.source?.appName,
      url: capsule.source?.url,
      adapterId: visionContextSemanticAdapter.id
    },
    capabilities: visionContextSemanticAdapter.capabilities(capsule),
    evidence,
    entities,
    relations,
    provenance: {
      rawObservationId: capsule.id,
      previousSnapshotId: input.previousSnapshotId,
      previousActionResultId: input.previousActionResultId
    }
  };
}

function visionEvidenceToSemanticEvidence(input: {
  evidence: CapsuleEvidence;
  snapshotId: string;
  index: number;
  observedAt: string;
}): SemanticEvidence {
  const evidence = input.evidence;
  const source = readEvidenceSource(evidence);
  const text = evidence.text?.slice(0, 2000);
  const label = evidence.title || text;
  return {
    id: `vision-evidence-${input.index + 1}-${hashSemanticParts([evidence.kind, evidence.title, evidence.t, evidence.path, text])}`,
    snapshotId: input.snapshotId,
    adapterId: visionContextSemanticAdapter.id,
    source,
    observedAt: input.observedAt,
    confidence: evidence.kind === "text" ? 0.78 : evidence.kind === "event" ? 0.74 : 0.82,
    locator: {
      bbox: evidence.bbox,
      path: evidence.path,
      name: label,
      opaque: {
        sourceObservationIds: evidence.sourceObservationIds.join(","),
        t: evidence.t
      }
    },
    value: {
      text,
      label,
      attributes: {
        kind: evidence.kind,
        compactLabel: compactSemanticText(label)
      }
    }
  };
}

function contextEntityToSemanticEntity(input: {
  entity: ContextEntity;
  capsule: TaskCapsule;
  surfaceId: string;
}): SemanticEntity {
  const evidenceIds = input.capsule.evidence
    .map((evidence, index) => ({ evidence, id: `vision-evidence-${index + 1}-${hashSemanticParts([evidence.kind, evidence.title, evidence.t, evidence.path, evidence.text?.slice(0, 2000)])}` }))
    .filter((item) => item.evidence.sourceObservationIds.some((id) => input.entity.observations.includes(id)))
    .map((item) => item.id);
  const label = input.entity.name || input.capsule.evidence.find((item) => item.sourceObservationIds.some((id) => input.entity.observations.includes(id)))?.title || input.entity.role;
  return {
    id: `entity-${hashSemanticParts([input.entity.id, label])}`,
    kind: input.entity.role === "action_target" || input.entity.role === "referent" ? "region" : "content_item",
    surfaceId: input.surfaceId,
    label,
    normalizedLabel: normalizeSemanticText(label),
    affordances: readVisionAffordances(input.entity),
    evidenceIds,
    state: { visible: true, focused: input.entity.role === "action_target" },
    tier1: { role: "locate", risk: "read_only" },
    tier2: {
      contextEntityId: input.entity.id,
      role: input.entity.role
    }
  };
}

function readVisionAffordances(entity: ContextEntity): SemanticAffordance[] {
  return entity.role === "action_target" ? ["read", "locate"] : ["read", "locate"];
}

function readVisionSurfaceKind(capsule: TaskCapsule): SemanticSurfaceKind {
  if (capsule.source?.kind === "browser_tab") return "browser_page";
  if (capsule.source?.kind === "app" || capsule.source?.kind === "window") return "app_window";
  return "desktop_screen";
}

function readEvidenceSource(evidence: CapsuleEvidence): SemanticEvidenceSource {
  if (evidence.kind === "image" || evidence.kind === "crop") return "visual";
  if (evidence.kind === "text") return "ocr";
  if (evidence.kind === "semantic") return "accessibility";
  return "action_result";
}
