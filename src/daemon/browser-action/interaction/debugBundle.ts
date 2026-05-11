import { createCapabilityDebugBundle } from "../../capability-transaction/index.js";
import type { CapabilityDebugBundle, CapabilityGateSummary } from "../../capability-transaction/types.js";
import type { BrowserInteractionTransaction } from "./types.js";

export function createBrowserInteractionDebugBundle(input: {
  transaction: BrowserInteractionTransaction;
  gate?: CapabilityGateSummary;
  diagnostics?: Record<string, unknown>;
}): CapabilityDebugBundle {
  const lease = input.transaction.activeLease;
  return createCapabilityDebugBundle({
    capability: "browser_action",
    transactionId: input.transaction.transactionId,
    requestId: input.transaction.requestId,
    sessionId: input.transaction.sessionId,
    source: input.transaction.source,
    utterance: input.transaction.utterance,
    context: lease
      ? {
          leaseId: lease.leaseId,
          contextId: lease.contextId,
          sourceId: lease.adapterId,
          surfaceId: lease.tabKey ?? [lease.adapterId, lease.windowId, lease.tabId].filter(Boolean).join(":"),
          routeKey: lease.routeKey,
          revision: lease.viewRevision,
          mutationRevision: lease.mutationRevision,
          digest: lease.graphDigest,
          capturedAt: lease.capturedAt,
          expiresAt: lease.expiresAt
        }
      : undefined,
    candidates: input.transaction.candidateSteps.slice(0, 10).map((candidate) => ({
      id: candidate.candidateId,
      label: candidate.localeLabel || candidate.label,
      role: candidate.role,
      confidence: candidate.confidence,
      reasonCodes: candidate.reasonCodes
    })),
    gate: input.gate,
    timings: input.transaction.timings,
    events: input.transaction.events.map((event) => ({
      phase: event.phase,
      at: event.t,
      summary: event.summary
    })),
    diagnostics: input.diagnostics
  });
}

