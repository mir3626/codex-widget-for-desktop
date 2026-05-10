import { readScreenshotEvents } from "./eventTimeline.js";
import type {
  CapsuleEvidence,
  CaptureEvent,
  ContextEntity,
  Observation
} from "./types.js";

export function buildCapsuleEvidence(input: {
  observations: Observation[];
  referents: ContextEntity[];
  alternatives: ContextEntity[];
  timeline: CaptureEvent[];
}): CapsuleEvidence[] {
  const selectedObservationIds = new Set([
    ...input.referents.flatMap((entity) => entity.observations),
    ...input.alternatives.flatMap((entity) => entity.observations)
  ]);
  const evidence: CapsuleEvidence[] = [];

  for (const observation of input.observations) {
    if ((observation.path || observation.dataUrl) && (selectedObservationIds.has(observation.id) || observation.kind === "image" || observation.kind === "media" || observation.kind === "error")) {
      evidence.push({
        kind: observation.kind === "media" || observation.bbox ? "crop" : "image",
        title: observation.label ?? "visual evidence",
        path: observation.path,
        dataUrl: observation.dataUrl,
        t: observation.t,
        bbox: observation.bbox,
        sourceObservationIds: [observation.id]
      });
    }
    if (observation.text && (selectedObservationIds.has(observation.id) || observation.kind === "error" || observation.source === "ocr" || observation.source === "browser" || observation.source === "terminal")) {
      evidence.push({
        kind: observation.kind === "error" ? "event" : "text",
        title: observation.label ?? `${observation.source} ${observation.kind}`,
        text: observation.text,
        t: observation.t,
        bbox: observation.bbox,
        sourceObservationIds: [observation.id]
      });
    }
  }

  const screenshots = readScreenshotEvents(input.timeline);
  if (!evidence.some((item) => item.kind === "image" || item.kind === "crop")) {
    const screenshot = screenshots.find((event) => event.path || event.dataUrl);
    if (screenshot) {
      evidence.unshift({
        kind: screenshot.bbox ? "crop" : "image",
        title: screenshot.purpose,
        path: screenshot.path,
        dataUrl: screenshot.dataUrl,
        t: screenshot.t,
        bbox: screenshot.bbox,
        sourceObservationIds: [`obs:${screenshot.id}`]
      });
    }
  }

  return dedupeEvidence(evidence).slice(0, 12);
}

function dedupeEvidence(evidence: CapsuleEvidence[]): CapsuleEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.kind}:${item.path ?? item.dataUrl ?? item.text ?? item.title}:${item.t ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
