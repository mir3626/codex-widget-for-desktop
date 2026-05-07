import { randomUUID } from "node:crypto";
import { buildEvidenceGraph } from "./evidenceGraph.js";
import { readPointerEvents, readScreenshotEvents, renderUserUtterance, sortTimeline } from "./eventTimeline.js";
import { resolveIntent } from "./intentResolver.js";
import { resolveReferences } from "./referenceResolver.js";
import type {
  BuildTaskCapsuleInput,
  CapsuleEvidence,
  CaptureEvent,
  ContextEntity,
  Observation,
  TaskCapsule
} from "./types.js";

export function buildTaskCapsule(input: BuildTaskCapsuleInput): TaskCapsule {
  const timeline = sortTimeline(input.captureSession.timeline);
  const eventObservations = observationsFromTimeline(timeline);
  const observations = mergeObservations([...eventObservations, ...(input.observations ?? [])]);
  const graph = buildEvidenceGraph({ sessionId: input.captureSession.id, observations });
  const utterance = renderUserUtterance(timeline) || "Use the captured visual context.";
  const reference = resolveReferences({
    utterance,
    graph,
    pointerEvents: readPointerEvents(timeline)
  });
  const intent = resolveIntent({ utterance, captureSession: input.captureSession });
  const evidence = buildCapsuleEvidence({
    observations,
    referents: reference.primary ? [reference.primary] : [],
    alternatives: reference.alternatives,
    timeline
  });
  const uncertainties = [];
  if (!reference.primary || reference.confidence < 0.65) {
    uncertainties.push({
      reason: reference.primary
        ? `Reference confidence is ${reference.confidence.toFixed(2)}: ${reference.reason}.`
        : "No primary visual referent could be resolved.",
      severity: "medium" as const,
      sourceObservationIds: reference.primary?.observations
    });
  }
  if (intent.confidence < 0.55) {
    uncertainties.push({
      reason: "User intent is ambiguous from the available utterance.",
      severity: "medium" as const
    });
  }

  return {
    id: `capsule-${randomUUID()}`,
    createdAt: (input.now ?? new Date()).toISOString(),
    captureSessionId: input.captureSession.id,
    userUtterance: utterance,
    source: input.captureSession.source,
    resolvedIntent: intent,
    referents: reference.primary ? [reference.primary] : [],
    alternatives: reference.alternatives,
    actionTarget: findActionTarget(graph.entities),
    evidence,
    uncertainties,
    instructions: [
      "Use the attached images and text evidence.",
      "Do not pretend certainty when evidence is ambiguous.",
      "If external or current information is needed, say what should be verified.",
      "Never assume raw video or audio was sent; only this capsule and selected images are model-visible."
    ],
    retention: input.captureSession.retention
  };
}

export function renderTaskCapsuleMarkdown(capsule: TaskCapsule): string {
  return [
    "# Vision Context Task",
    "",
    "## User Utterance",
    capsule.userUtterance,
    "",
    "## Resolved Intent",
    `- Kind: ${capsule.resolvedIntent.kind}`,
    `- Summary: ${capsule.resolvedIntent.summary}`,
    `- Confidence: ${capsule.resolvedIntent.confidence.toFixed(2)}`,
    "",
    "## Reference Resolution",
    ...renderEntityList("Primary referent", capsule.referents),
    ...renderEntityList("Alternatives", capsule.alternatives),
    "",
    "## Environment",
    capsule.source?.appName ? `- App: ${capsule.source.appName}` : "",
    capsule.source?.windowTitle ? `- Window title: ${capsule.source.windowTitle}` : "",
    capsule.source?.url ? `- URL: ${capsule.source.url}` : "",
    capsule.source?.viewport ? `- Viewport: ${capsule.source.viewport.width}x${capsule.source.viewport.height}` : "",
    "",
    "## Evidence",
    ...capsule.evidence.map(renderEvidenceLine),
    "",
    "## Uncertainties",
    ...(capsule.uncertainties.length > 0
      ? capsule.uncertainties.map((item) => `- ${item.reason}`)
      : ["- None recorded."]),
    "",
    "## Agent Instructions",
    ...capsule.instructions.map((instruction) => `- ${instruction}`)
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function renderVisibleUserMessage(capsule: TaskCapsule): string {
  return [
    "Vision Context:",
    capsule.userUtterance,
    "",
    `Intent: ${capsule.resolvedIntent.kind} (${capsule.resolvedIntent.confidence.toFixed(2)})`,
    capsule.evidence.length > 0 ? `Evidence: ${capsule.evidence.length} item(s), ${capsule.evidence.filter((item) => item.path).length} image file(s).` : "Evidence: none.",
    capsule.uncertainties.length > 0 ? `Uncertainty: ${capsule.uncertainties[0]?.reason}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

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

function buildCapsuleEvidence(input: {
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

function mergeObservations(observations: Observation[]): Observation[] {
  const seen = new Set<string>();
  return observations.filter((observation) => {
    if (seen.has(observation.id)) {
      return false;
    }
    seen.add(observation.id);
    return true;
  });
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

function findActionTarget(entities: ContextEntity[]): ContextEntity | undefined {
  return entities.find((entity) => entity.role === "action_target");
}

function renderEntityList(label: string, entities: ContextEntity[]): string[] {
  if (entities.length === 0) {
    return [`- ${label}: none`];
  }
  return entities.map((entity, index) => {
    const name = entity.name ? ` ${entity.name}` : "";
    const prefix = label === "Alternatives" ? `- Alternative ${index + 1}:` : `- ${label}:`;
    return `${prefix}${name} (confidence ${entity.confidence.toFixed(2)}, salience ${entity.salience.toFixed(2)})`;
  });
}

function renderEvidenceLine(item: CapsuleEvidence): string {
  const where = item.path ?? item.title;
  const detail = item.text ? `: ${item.text.slice(0, 240).replace(/\s+/g, " ")}` : "";
  const bbox = item.bbox ? ` bbox=${item.bbox.x},${item.bbox.y},${item.bbox.w},${item.bbox.h}` : "";
  const time = item.t !== undefined ? ` at T+${item.t}ms` : "";
  return `- ${where} (${item.kind}${time}${bbox})${detail}`;
}
