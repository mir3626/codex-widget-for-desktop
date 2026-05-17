import { randomUUID } from "node:crypto";
import type {
  ComputerSessionObservationSummary,
  ComputerUseFindElementsQuery,
  ComputerUseSnapshotResult
} from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";
import type { RuntimeSessionState } from "./sessionRuntimeTypes.js";
import {
  createComputerUseSemanticTree,
  createUnavailableComputerUseSemanticTree,
  findComputerUseSemanticRefs,
  readComputerUseSemanticTreeFixture
} from "./uiaSemanticTree.js";

export type ComputerSessionSemanticSnapshotRuntimeHost = {
  storage: StorageService;
  requireSession: (sessionId: string) => RuntimeSessionState;
  recordObservation: (sessionId: string, observation: ComputerSessionObservationSummary) => void;
};

export function captureComputerUseSnapshot(
  host: ComputerSessionSemanticSnapshotRuntimeHost,
  input: {
    sessionId?: string;
    fixture?: unknown;
    query?: ComputerUseFindElementsQuery;
    source?: "native_helper_uia" | "native_helper_snapshot" | "fixture" | "unavailable";
  }
): ComputerUseSnapshotResult {
  const now = new Date().toISOString();
  const state = input.sessionId ? host.requireSession(input.sessionId) : undefined;
  const snapshot = input.fixture
    ? createComputerUseSemanticTree({
        snapshot: readComputerUseSemanticTreeFixture(input.fixture),
        source: input.source ?? "fixture",
        surface: state?.summary.selectedSurface?.kind,
        capturedAt: now
      })
    : createUnavailableComputerUseSemanticTree({
        reason: "native_uia_observe_helper_not_configured",
        surface: state?.summary.selectedSurface?.kind,
        capturedAt: now
      });
  const matches = input.query ? findComputerUseSemanticRefs(snapshot, input.query) : undefined;
  let observationId: string | undefined;
  let evalStepId: string | undefined;
  if (state) {
    observationId = `observation:${randomUUID()}`;
    const evalStep = state.summary.evalRunId
      ? host.storage.appendComputerUseEvalStep({
          runId: state.summary.evalRunId,
          kind: "computer_use_snapshot",
          phase: "observe",
          status: snapshot.source === "unavailable" ? "blocked" : "passed",
          input: {
            source: snapshot.source,
            query: input.query
          },
          output: {
            schemaVersion: snapshot.schemaVersion,
            source: snapshot.source,
            refCount: Object.keys(snapshot.refs).length,
            windowCount: snapshot.stats.windowCount,
            elementCount: snapshot.stats.elementCount,
            roleCounts: snapshot.stats.roleCounts,
            matchCount: matches?.length ?? 0,
            warnings: snapshot.warnings
          },
          failureClass: snapshot.source === "unavailable" ? "external_blocker" : undefined,
          startedAt: now,
          completedAt: now,
          elapsedMs: 0
        })
      : undefined;
    evalStepId = evalStep?.id;
    host.recordObservation(state.summary.sessionId, {
      id: observationId,
      kind: "uia",
      source: "computer_use_snapshot",
      surface: state.summary.selectedSurface?.kind,
      capturedAt: now,
      evalRunId: state.summary.evalRunId,
      summary: `Computer Use semantic snapshot captured ${Object.keys(snapshot.refs).length} refs across ${snapshot.stats.windowCount} windows.`,
      freshness: snapshot.source === "unavailable" ? "unknown" : "fresh",
      metadata: {
        evalStepId,
        semanticTree: snapshot,
        matchRefs: matches?.map((match) => match.ref) ?? [],
        readOnlyObserve: true
      },
      redaction: snapshot.redaction
    });
  }
  return { snapshot, matches, observationId, evalStepId };
}
