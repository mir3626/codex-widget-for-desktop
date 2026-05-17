import { randomUUID } from "node:crypto";
import type { ComputerStructuredOperation } from "../../shared/protocol.js";
import { routeComputerOperation } from "./operationRouting.js";
import type { ComputerSessionOperationRuntimeHost } from "./sessionOperationRuntime.js";
import type { ComputerSessionOperationResult, RuntimeSessionState } from "./sessionRuntimeTypes.js";

export function isSemanticSnapshotOperation(
  operation: ComputerStructuredOperation
): operation is Extract<ComputerStructuredOperation, { kind: "computer_use_snapshot" | "find_elements" }> {
  return operation.kind === "computer_use_snapshot" || operation.kind === "find_elements";
}

export function executeSemanticSnapshotOperation(
  host: ComputerSessionOperationRuntimeHost,
  input: {
    sessionId: string;
    operation: Extract<ComputerStructuredOperation, { kind: "computer_use_snapshot" | "find_elements" }>;
  },
  state: RuntimeSessionState
): ComputerSessionOperationResult {
  if (!state.summary.dagRunId) {
    throw new Error("Computer session must be started before semantic snapshot operations.");
  }
  const now = new Date().toISOString();
  const actionRoute = routeComputerOperation(input.operation, state.summary);
  const result = host.captureComputerUseSnapshot({
    sessionId: input.sessionId,
    fixture: input.operation.input.fixture ?? input.operation.input.snapshot,
    query: input.operation.kind === "find_elements"
      ? readFindElementsQuery(input.operation.input.query ?? input.operation.input)
      : readFindElementsQuery(input.operation.input.query),
    source: readSnapshotSource(input.operation.input.source)
  });
  const node = host.storage.upsertCapabilityDagNode({
    id: `${input.sessionId}:semantic-snapshot:${randomUUID()}`,
    dagRunId: state.summary.dagRunId,
    kind: "observe",
    status: result.snapshot.source === "unavailable" ? "failed" : "completed",
    input: { operation: summarizeSemanticSnapshotOperation(input.operation), actionRoute },
    output: {
      ok: result.snapshot.source !== "unavailable",
      schemaVersion: result.snapshot.schemaVersion,
      source: result.snapshot.source,
      refCount: Object.keys(result.snapshot.refs).length,
      windowCount: result.snapshot.stats.windowCount,
      elementCount: result.snapshot.stats.elementCount,
      roleCounts: result.snapshot.stats.roleCounts,
      matches: result.matches,
      observationId: result.observationId,
      evalStepId: result.evalStepId,
      warnings: result.snapshot.warnings
    },
    startedAt: now,
    completedAt: now,
    elapsedMs: 0,
    lastError: result.snapshot.source === "unavailable" ? "native_uia_observe_helper_not_configured" : undefined
  });
  if (result.snapshot.source === "unavailable") {
    host.block(input.sessionId, "native_uia_observe_helper_not_configured");
  } else {
    host.transition(input.sessionId, "completed");
  }
  return {
    session: host.requireSession(input.sessionId).summary,
    dagNode: node
  };
}

function summarizeSemanticSnapshotOperation(operation: Extract<ComputerStructuredOperation, { kind: "computer_use_snapshot" | "find_elements" }>): Record<string, unknown> {
  return {
    kind: operation.kind,
    source: readSnapshotSource(operation.input.source),
    query: readFindElementsQuery(operation.input.query ?? (operation.kind === "find_elements" ? operation.input : undefined)),
    fixtureProvided: Boolean(operation.input.fixture ?? operation.input.snapshot),
    redaction: {
      fixture: "not_stored",
      values: "redacted_when_sensitive"
    }
  };
}

function readFindElementsQuery(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readSnapshotSource(value: unknown): "native_helper_uia" | "native_helper_snapshot" | "fixture" | "unavailable" | undefined {
  return value === "native_helper_uia" ||
    value === "native_helper_snapshot" ||
    value === "fixture" ||
    value === "unavailable"
    ? value
    : undefined;
}
