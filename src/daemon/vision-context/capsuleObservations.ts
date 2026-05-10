import type {
  CaptureEvent,
  Observation
} from "./types.js";

export function observationsFromTimeline(events: CaptureEvent[]): Observation[] {
  return events.flatMap((event): Observation[] => {
    if (event.type === "speech") {
      return [{
        id: `obs:${event.id}`,
        t: event.t,
        source: "speech",
        kind: "text",
        text: event.text,
        confidence: event.confidence
      }];
    }
    if (event.type === "pointer") {
      return [{
        id: `obs:${event.id}`,
        t: event.t,
        source: "pointer",
        kind: "gesture",
        label: event.action,
        bbox: event.bbox ?? { x: event.x - 4, y: event.y - 4, w: 8, h: 8 },
        metadata: { action: event.action, x: event.x, y: event.y, toX: event.toX, toY: event.toY },
        confidence: event.action === "move" ? 0.25 : 0.82
      }];
    }
    if (event.type === "screenshot") {
      return [{
        id: `obs:${event.id}`,
        t: event.t,
        source: event.text ? "ocr" : "screen",
        kind: event.purpose === "error_evidence" ? "error" : event.purpose === "primary_media" ? "media" : "image",
        label: event.purpose,
        text: event.text,
        bbox: event.bbox,
        path: event.path,
        dataUrl: event.dataUrl,
        metadata: { cropOf: event.cropOf, perceptualHash: event.perceptualHash },
        confidence: event.purpose === "full" ? 0.72 : 0.82
      }];
    }
    if (event.type === "active_window") {
      return [{
        id: `obs:${event.id}`,
        t: event.t,
        source: "accessibility",
        kind: "window",
        app: event.appName,
        label: event.windowTitle,
        text: event.url,
        metadata: { url: event.url },
        confidence: 0.75
      }];
    }
    if (event.type === "artifact") {
      return [{
        id: `obs:${event.id}`,
        t: event.t,
        source: "document",
        kind: event.path ? "file" : "text",
        label: event.title,
        text: event.text,
        path: event.path,
        metadata: event.metadata,
        confidence: 0.7
      }];
    }
    if (event.type === "semantic") {
      return [{
        id: `obs:${event.id}`,
        t: event.t,
        source: event.source,
        kind: event.kind,
        label: event.label,
        text: event.text,
        bbox: event.bbox,
        path: event.path,
        metadata: event.metadata,
        confidence: event.confidence ?? 0.68
      }];
    }
    if (event.type === "keyboard") {
      return [{
        id: `obs:${event.id}`,
        t: event.t,
        source: "accessibility",
        kind: "text",
        label: event.action,
        text: event.text ?? event.key,
        confidence: 0.55
      }];
    }
    return [];
  });
}

export function mergeObservations(observations: Observation[]): Observation[] {
  const seen = new Set<string>();
  return observations.filter((observation) => {
    if (seen.has(observation.id)) {
      return false;
    }
    seen.add(observation.id);
    return true;
  });
}
