import { randomUUID } from "node:crypto";
import type {
  ComputerSessionActionFeedbackSummary,
  ComputerSessionEvent,
  ComputerSessionObservationSummary,
  ComputerSessionSummary,
  NormalizedComputerActionBatch
} from "../../shared/protocol.js";
import { normalizeComputerActionBatch } from "../../shared/protocol.js";
import type {
  BrowserActionResult,
  BrowserObservation
} from "../browser-action/index.js";
import {
  buildPerceptionGraphFromBrowserObservation
} from "../perception-graph/index.js";
import type { StorageService } from "../storage/storage.js";
import {
  collectSessionTargetGraphs,
  mapBrowserActionStatusToFeedbackStatus,
  readComputerSessionIdFromBrowserAction,
  summarizeBrowserActionTargetEvidence,
  summarizeBrowserObservationForSession,
  summarizeObservationFeedbackReference
} from "./observationSummaries.js";
import { readRecordId } from "./sessionRecordUtils.js";
import type { RuntimeSessionState } from "./sessionRuntimeTypes.js";

export type ComputerSessionEvidenceRecorderHost = {
  storage: StorageService;
  hasSession: (sessionId: string) => boolean;
  requireSession: (sessionId: string) => RuntimeSessionState;
  block: (sessionId: string, reason: string) => ComputerSessionSummary;
  persistSessionState: (state: RuntimeSessionState) => void;
  emit: (event: ComputerSessionEvent) => void;
};

export function recordActionBatch(
  host: ComputerSessionEvidenceRecorderHost,
  sessionId: string,
  input: unknown
): NormalizedComputerActionBatch {
  const batch = normalizeComputerActionBatch(input);
  const state = host.requireSession(sessionId);
  state.actionBatches.push(batch);
  state.summary.latestActionBatchId = `action-batch:${state.actionBatches.length - 1}`;
  state.summary.updatedAt = new Date().toISOString();
  if (batch.blockedReason) {
    host.block(sessionId, batch.blockedReason);
  } else {
    host.emit({ type: "computer.session.action_started", sessionId, actionBatch: batch });
  }
  host.persistSessionState(state);
  return batch;
}

export function recordObservation(
  host: ComputerSessionEvidenceRecorderHost,
  sessionId: string,
  observation: ComputerSessionObservationSummary
): void {
  const state = host.requireSession(sessionId);
  state.observations.push(observation);
  state.summary.latestObservationId = readRecordId(observation) ?? `observation:${state.observations.length - 1}`;
  state.summary.updatedAt = new Date().toISOString();
  host.persistSessionState(state);
  host.emit({ type: "computer.session.observation", sessionId, observation });
}

export function recordBrowserActionResultObservation(
  host: ComputerSessionEvidenceRecorderHost,
  input: {
    result: BrowserActionResult;
    capabilityJobId?: string;
    dagNodeId?: string;
  }
): ComputerSessionObservationSummary | null {
  const sessionId = readComputerSessionIdFromBrowserAction(input.result.actionSessionId);
  if (!sessionId || !host.hasSession(sessionId)) {
    return null;
  }
  const records = [
    input.result.before ? recordBrowserActionDomObservation(host, {
      sessionId,
      result: input.result,
      observation: input.result.before,
      phase: "pre_action",
      capabilityJobId: input.capabilityJobId,
      dagNodeId: input.dagNodeId
    }) : null,
    input.result.after ? recordBrowserActionDomObservation(host, {
      sessionId,
      result: input.result,
      observation: input.result.after,
      phase: "post_action",
      capabilityJobId: input.capabilityJobId,
      dagNodeId: input.dagNodeId
    }) : null
  ].filter((record): record is ComputerSessionObservationSummary => Boolean(record));
  recordBrowserActionFeedback(host, {
    sessionId,
    result: input.result,
    capabilityJobId: input.capabilityJobId,
    dagNodeId: input.dagNodeId,
    records
  });
  return records.at(-1) ?? null;
}

export function recordVerifierResult(
  host: ComputerSessionEvidenceRecorderHost,
  sessionId: string,
  result: unknown
): void {
  const state = host.requireSession(sessionId);
  state.verifierResults.push(result);
  state.summary.latestVerifierResultId = readRecordId(result) ?? `verifier:${state.verifierResults.length - 1}`;
  state.summary.updatedAt = new Date().toISOString();
  host.persistSessionState(state);
  host.emit({ type: "computer.session.verifier_result", sessionId, result });
}

function recordBrowserActionFeedback(
  host: ComputerSessionEvidenceRecorderHost,
  input: {
    sessionId: string;
    result: BrowserActionResult;
    capabilityJobId?: string;
    dagNodeId?: string;
    records: ComputerSessionObservationSummary[];
  }
): ComputerSessionActionFeedbackSummary {
  const state = host.requireSession(input.sessionId);
  const before = input.records.find((record) => record.metadata?.observationPhase === "pre_action");
  const after = input.records.find((record) => record.metadata?.observationPhase === "post_action");
  const metadata = {
    resultId: input.result.id,
    actionSessionId: input.result.actionSessionId,
    targetEvidence: before?.metadata?.targetEvidence,
    before: before ? summarizeObservationFeedbackReference(before) : undefined,
    after: after ? summarizeObservationFeedbackReference(after) : undefined,
    verification: input.result.verification
  };
  const feedback: ComputerSessionActionFeedbackSummary = {
    id: `action-feedback:${randomUUID()}`,
    sessionId: input.sessionId,
    operationKind: "browser_action",
    actionType: input.result.action.type,
    status: mapBrowserActionStatusToFeedbackStatus(input.result.status),
    capturedAt: input.result.completedAt ?? after?.capturedAt ?? before?.capturedAt ?? new Date().toISOString(),
    capabilityJobId: input.capabilityJobId,
    dagNodeId: input.dagNodeId,
    beforeObservationId: before?.id,
    afterObservationId: after?.id,
    perceptionGraphId: after?.perceptionGraphId ?? before?.perceptionGraphId,
    verifierStatus: input.result.verification.status,
    summary: `Browser Action ${input.result.action.type} feedback: ${input.result.verification.status}.`,
    metadata,
    redaction: {
      screenshots: "not_stored",
      credentials: "redacted_by_browser_action_policy",
      rawDom: "not_stored"
    }
  };
  if (state.summary.evalRunId) {
    const step = host.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "browser_action_feedback",
      phase: "observe",
      status: feedback.status === "completed" ? "completed" : feedback.status === "blocked" ? "blocked" : "failed",
      capabilityJobId: input.capabilityJobId,
      capabilityDagNodeId: input.dagNodeId,
      perceptionGraphId: feedback.perceptionGraphId,
      input: {
        resultId: input.result.id,
        actionSessionId: input.result.actionSessionId,
        action: input.result.action.type
      },
      output: {
        feedbackId: feedback.id,
        beforeObservationId: feedback.beforeObservationId,
        afterObservationId: feedback.afterObservationId,
        verifierStatus: feedback.verifierStatus,
        targetEvidence: before?.metadata?.targetEvidence
      },
      failureClass: feedback.status === "completed" ? "none" : "action_failed"
    });
    feedback.evalStepId = step.id;
    feedback.metadata = {
      ...metadata,
      evalStepId: step.id
    };
  }
  state.actionFeedbacks.push(feedback);
  state.summary.updatedAt = new Date().toISOString();
  host.persistSessionState(state);
  host.emit({ type: "computer.session.action_completed", sessionId: input.sessionId, result: feedback });
  return feedback;
}

function recordBrowserActionDomObservation(
  host: ComputerSessionEvidenceRecorderHost,
  input: {
    sessionId: string;
    result: BrowserActionResult;
    observation: BrowserObservation;
    phase: "pre_action" | "post_action";
    capabilityJobId?: string;
    dagNodeId?: string;
  }
): ComputerSessionObservationSummary | null {
  const state = host.requireSession(input.sessionId);
  if (!input.observation) {
    return null;
  }
  const graph = input.observation.elements.length > 0
    ? host.storage.recordPerceptionGraph({
        graph: buildPerceptionGraphFromBrowserObservation({
          observation: input.observation,
          sessionId: input.sessionId
        }),
        sessionId: input.sessionId,
        source: `computer_session_browser_action_${input.phase}`
      })
    : undefined;
  const targetGraphs = graph ? collectSessionTargetGraphs({
    currentGraph: graph,
    sessionId: input.sessionId,
    storage: host.storage,
    observations: state.observations
  }) : [];
  const targetEvidence = graph
    ? summarizeBrowserActionTargetEvidence(input.result, targetGraphs, graph.id)
    : undefined;
  const step = state.summary.evalRunId ? host.storage.appendComputerUseEvalStep({
    runId: state.summary.evalRunId,
    kind: `browser_action_${input.phase}_observation`,
    phase: "observe",
    status: "completed",
    capabilityJobId: input.capabilityJobId,
    capabilityDagNodeId: input.dagNodeId,
    perceptionGraphId: graph?.id,
    input: {
      actionSessionId: input.result.actionSessionId,
      action: input.result.action.type,
      resultId: input.result.id,
      observationPhase: input.phase
    },
    output: {
      ...summarizeBrowserObservationForSession(input.observation),
      targetEvidence
    },
    failureClass: "none"
  }) : undefined;
  const resources = graph && state.summary.evalRunId
    ? [host.storage.createComputerUseEvalResource({
        runId: state.summary.evalRunId,
        stepId: step?.id,
        role: "perception_graph",
        retention: "evidence",
        redaction: {
          screenshots: "not_stored",
          source: "structured_dom_metadata"
        }
      })]
    : [];
  const record: ComputerSessionObservationSummary = {
    id: `observation:${randomUUID()}`,
    kind: "browser_dom",
    source: `browser_action_${input.phase}`,
    surface: state.summary.selectedSurface?.kind,
    capturedAt: input.observation.capturedAt,
    capabilityJobId: input.capabilityJobId,
    dagNodeId: input.dagNodeId,
    evalRunId: state.summary.evalRunId,
    perceptionGraphId: graph?.id,
    resourceIds: resources.map((resource) => ({
      evalResourceId: resource.id,
      role: resource.role,
      retention: resource.retention
    })),
    summary: `Browser Action ${input.result.action.type} ${input.phase}; observed ${input.observation.elements.length} DOM elements.`,
    freshness: "fresh",
    metadata: {
      action: input.result.action.type,
      observationPhase: input.phase,
      status: input.result.status,
      verification: input.result.verification.status,
      url: input.observation.url,
      title: input.observation.title,
      elementCount: input.observation.elements.length,
      perceptionGraphNodeCount: graph?.nodes.length,
      targetEvidence
    },
    redaction: {
      screenshots: "not_stored",
      credentials: "redacted_by_browser_action_policy"
    }
  };
  recordObservation(host, input.sessionId, record);
  return record;
}
