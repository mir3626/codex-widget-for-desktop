import type {
  CapturePointerEvent,
  ContextEntity,
  EvidenceGraph,
  Observation,
  Rect,
  ReferenceResolution
} from "./types.js";

const TEMPORAL_REFERENCE_PATTERN = /(방금|아까|just now|a moment ago|previous)/i;

export function resolveReferences(input: {
  utterance: string;
  graph: EvidenceGraph;
  pointerEvents: CapturePointerEvent[];
}): ReferenceResolution {
  const pointerResolution = resolvePointerReference(input.graph, input.pointerEvents);
  if (pointerResolution.primary && pointerResolution.confidence >= 0.7) {
    return pointerResolution;
  }

  const temporalResolution = TEMPORAL_REFERENCE_PATTERN.test(input.utterance)
    ? resolveTemporalReference(input.graph)
    : undefined;
  if (temporalResolution?.primary && temporalResolution.confidence >= 0.65) {
    return temporalResolution;
  }

  const salientResolution = resolveSalientReference(input.graph);
  if (pointerResolution.primary && salientResolution.primary) {
    return {
      primary: pointerResolution.primary,
      alternatives: uniqueEntities([salientResolution.primary, ...pointerResolution.alternatives, ...salientResolution.alternatives]),
      confidence: pointerResolution.confidence,
      reason: pointerResolution.reason
    };
  }
  return salientResolution;
}

function resolvePointerReference(graph: EvidenceGraph, pointerEvents: CapturePointerEvent[]): ReferenceResolution {
  const meaningful = pointerEvents
    .filter((event) => event.action !== "move")
    .sort((left, right) => right.t - left.t);
  const pointer = meaningful[0];
  if (!pointer) {
    return { alternatives: [], confidence: 0, reason: "no pointer gesture" };
  }

  const targetBox = pointer.bbox ?? pointerToBox(pointer);
  const ranked = graph.observations
    .filter((observation) => observation.bbox)
    .map((observation) => ({
      observation,
      score: scorePointerMatch(targetBox, observation.bbox)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  const primary = entityForObservation(graph, ranked[0]?.observation, "referent");
  return {
    primary,
    alternatives: ranked.slice(1, 4).flatMap((candidate) => entityForObservation(graph, candidate.observation, "alternative") ?? []),
    confidence: primary ? Math.min(0.94, 0.62 + (ranked[0]?.score ?? 0) * 0.3) : 0.42,
    reason: `${pointer.action} gesture at T+${pointer.t}ms`
  };
}

function resolveTemporalReference(graph: EvidenceGraph): ReferenceResolution {
  const ranked = graph.observations
    .filter((observation) => observation.kind === "error" || observation.text?.match(/error|failed|오류|에러/i))
    .sort((left, right) => right.t - left.t);
  const primary = entityForObservation(graph, ranked[0], "referent");
  return {
    primary,
    alternatives: ranked.slice(1, 3).flatMap((observation) => entityForObservation(graph, observation, "alternative") ?? []),
    confidence: primary ? 0.78 : 0.35,
    reason: primary ? "temporal expression matched recent error evidence" : "temporal expression found but no error-like frame was available"
  };
}

function resolveSalientReference(graph: EvidenceGraph): ReferenceResolution {
  const ranked = graph.observations
    .map((observation) => ({
      observation,
      score: scoreSalientObservation(observation)
    }))
    .sort((left, right) => right.score - left.score);
  const primaryCandidate = ranked[0];
  const primary = entityForObservation(graph, primaryCandidate?.observation, "referent");
  return {
    primary,
    alternatives: ranked.slice(1, 4).flatMap((candidate) => entityForObservation(graph, candidate.observation, "alternative") ?? []),
    confidence: primary ? Math.max(0.35, Math.min(0.72, primaryCandidate.score)) : 0,
    reason: primary ? "selected highest-salience visible observation" : "no observations available"
  };
}

function entityForObservation(
  graph: EvidenceGraph,
  observation: Observation | undefined,
  role: ContextEntity["role"]
): ContextEntity | undefined {
  if (!observation) {
    return undefined;
  }
  const base = graph.entities.find((entity) => entity.observations.includes(observation.id));
  if (!base) {
    return undefined;
  }
  return {
    ...base,
    role,
    confidence: Math.min(base.confidence, observation.confidence)
  };
}

function pointerToBox(pointer: CapturePointerEvent): Rect {
  if (pointer.toX !== undefined && pointer.toY !== undefined) {
    const left = Math.min(pointer.x, pointer.toX);
    const top = Math.min(pointer.y, pointer.toY);
    return {
      x: left,
      y: top,
      w: Math.max(8, Math.abs(pointer.toX - pointer.x)),
      h: Math.max(8, Math.abs(pointer.toY - pointer.y))
    };
  }
  return { x: pointer.x - 24, y: pointer.y - 24, w: 48, h: 48 };
}

function scorePointerMatch(pointer: Rect, candidate: Rect | undefined): number {
  if (!candidate) {
    return 0;
  }
  const overlap = intersectionArea(pointer, candidate);
  const pointerArea = pointer.w * pointer.h;
  const candidateArea = candidate.w * candidate.h;
  if (overlap > 0) {
    return overlap / Math.max(1, Math.min(pointerArea, candidateArea));
  }
  const distance = centerDistance(pointer, candidate);
  return distance < 240 ? Math.max(0, 1 - distance / 240) * 0.55 : 0;
}

function scoreSalientObservation(observation: Observation): number {
  const bbox = observation.bbox;
  const areaScore = bbox ? Math.min(0.4, Math.log10(Math.max(1, bbox.w * bbox.h)) / 12) : 0;
  const kindScore = observation.kind === "media" || observation.kind === "image" ? 0.38
    : observation.kind === "error" ? 0.44
      : observation.kind === "selection" ? 0.4
        : observation.kind === "page" ? 0.22
          : 0.12;
  return Math.min(1, kindScore + areaScore + observation.confidence * 0.2);
}

function intersectionArea(left: Rect, right: Rect): number {
  const x = Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x));
  const y = Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y));
  return x * y;
}

function centerDistance(left: Rect, right: Rect): number {
  return Math.hypot(left.x + left.w / 2 - (right.x + right.w / 2), left.y + left.h / 2 - (right.y + right.h / 2));
}

function uniqueEntities(entities: ContextEntity[]): ContextEntity[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) {
      return false;
    }
    seen.add(entity.id);
    return true;
  });
}
