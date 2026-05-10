import { randomUUID } from "node:crypto";
import { buildEvidenceGraph } from "./evidenceGraph.js";
import { readPointerEvents, renderUserUtterance, sortTimeline } from "./eventTimeline.js";
import { resolveIntent } from "./intentResolver.js";
import { resolveReferences } from "./referenceResolver.js";
import { buildCapsuleEvidence } from "./capsuleEvidence.js";
import { mergeObservations, observationsFromTimeline } from "./capsuleObservations.js";
import type {
  BuildTaskCapsuleInput,
  ContextEntity,
  TaskCapsule
} from "./types.js";

export { renderTaskCapsuleMarkdown, renderVisibleUserMessage } from "./capsuleRenderers.js";
export { observationsFromTimeline } from "./capsuleObservations.js";

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

function findActionTarget(entities: ContextEntity[]): ContextEntity | undefined {
  return entities.find((entity) => entity.role === "action_target");
}
