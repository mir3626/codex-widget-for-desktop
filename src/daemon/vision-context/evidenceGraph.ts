import type { ContextEdge, ContextEntity, EvidenceGraph, Observation, Rect } from "./types.js";

export function buildEvidenceGraph(input: {
  sessionId: string;
  observations: Observation[];
}): EvidenceGraph {
  const observations = [...input.observations].sort((left, right) => left.t - right.t || left.id.localeCompare(right.id));
  const entities = observations.map((observation) => observationToEntity(observation));
  const edges = buildEdges(observations, entities);
  return {
    sessionId: input.sessionId,
    observations,
    entities,
    edges
  };
}

function observationToEntity(observation: Observation): ContextEntity {
  return {
    id: `entity:${observation.id}`,
    name: observation.label ?? observation.text?.slice(0, 80),
    role: observation.kind === "command" || observation.kind === "file" || observation.kind === "selection" ? "action_target" : "evidence",
    observations: [observation.id],
    salience: scoreObservationSalience(observation),
    confidence: observation.confidence
  };
}

function buildEdges(observations: Observation[], entities: ContextEntity[]): ContextEdge[] {
  const edges: ContextEdge[] = [];
  const byObservation = new Map(entities.flatMap((entity) => entity.observations.map((id) => [id, entity] as const)));

  for (let index = 0; index < observations.length; index += 1) {
    const current = observations[index];
    const currentEntity = byObservation.get(current.id);
    if (!currentEntity) {
      continue;
    }

    for (const candidate of observations.slice(index + 1, index + 6)) {
      const candidateEntity = byObservation.get(candidate.id);
      if (!candidateEntity || candidateEntity.id === currentEntity.id) {
        continue;
      }
      if (current.app && candidate.app && current.app === candidate.app) {
        edges.push({ from: currentEntity.id, to: candidateEntity.id, relation: "same_app", confidence: 0.72 });
      }
      if (current.bbox && candidate.bbox) {
        const relation = contains(current.bbox, candidate.bbox) ? "contains" : distance(current.bbox, candidate.bbox) < 180 ? "near" : undefined;
        if (relation) {
          edges.push({ from: currentEntity.id, to: candidateEntity.id, relation, confidence: relation === "contains" ? 0.82 : 0.58 });
        }
      }
      if (candidate.t > current.t) {
        edges.push({ from: currentEntity.id, to: candidateEntity.id, relation: "before", confidence: 0.5 });
      }
    }
  }

  return edges;
}

export function scoreObservationSalience(observation: Observation): number {
  const area = observation.bbox ? Math.max(0, observation.bbox.w) * Math.max(0, observation.bbox.h) : 0;
  const areaScore = area > 0 ? Math.min(0.45, Math.log10(area + 1) / 12) : 0;
  const kindScore = observation.kind === "media" || observation.kind === "image" ? 0.35
    : observation.kind === "error" ? 0.42
      : observation.kind === "selection" ? 0.38
        : observation.kind === "ui_element" ? 0.25
          : 0.12;
  return clamp01(kindScore + areaScore + observation.confidence * 0.22);
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h;
}

function distance(left: Rect, right: Rect): number {
  const leftCx = left.x + left.w / 2;
  const leftCy = left.y + left.h / 2;
  const rightCx = right.x + right.w / 2;
  const rightCy = right.y + right.h / 2;
  return Math.hypot(leftCx - rightCx, leftCy - rightCy);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
