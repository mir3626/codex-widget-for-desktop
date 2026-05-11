import { createHash } from "node:crypto";
import type {
  CapabilityCandidateSummary,
  CapabilityContextLeaseIdentity,
  CapabilityDebugBundle,
  CapabilityGateSummary,
  CapabilityKind,
  CapabilityTimingEvent,
  CapabilityTransactionSource,
  CapabilityTransactionPhase
} from "./types.js";

export function createCapabilityDebugBundle(input: {
  capability: CapabilityKind;
  transactionId: string;
  requestId: string;
  sessionId?: string;
  source: CapabilityTransactionSource;
  utterance?: string;
  context?: CapabilityContextLeaseIdentity;
  candidates?: CapabilityCandidateSummary[];
  gate?: CapabilityGateSummary;
  timings?: CapabilityTimingEvent[];
  events?: Array<{ phase: CapabilityTransactionPhase; at: string; summary: string }>;
  diagnostics?: Record<string, unknown>;
}): CapabilityDebugBundle {
  return {
    schemaVersion: "capability-debug-bundle.v1",
    capability: input.capability,
    transactionId: input.transactionId,
    requestId: input.requestId,
    sessionId: input.sessionId,
    createdAt: new Date().toISOString(),
    redaction: {
      mode: "redacted_text",
      omittedFields: ["rawObservation", "rawSnapshot", "secretValues", "fullPrompt"]
    },
    request: {
      source: input.source,
      utterancePreview: redactDebugText(input.utterance).slice(0, 160),
      utteranceHash: hashDebugText(input.utterance)
    },
    context: input.context,
    candidates: input.candidates ?? [],
    gate: input.gate,
    timings: input.timings ?? [],
    events: input.events ?? [],
    diagnostics: input.diagnostics ?? {}
  };
}

export function redactDebugText(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:sk|sess|tok|key|pat|ghp)_[A-Za-z0-9_\-]{12,}\b/g, "[redacted-secret]")
    .replace(/\b\d{13,19}\b/g, "[redacted-number]");
}

export function hashDebugText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return createHash("sha256").update(value).digest("hex");
}

