import type { SafetyDecision, SafetyDecisionKind, SafetyRiskLevel, SafetySubjectKind } from "./types.js";

export function createSafetyDecision(input: {
  subjectKind: SafetySubjectKind;
  actionFamily: string;
  decision: SafetyDecisionKind;
  risk: SafetyRiskLevel;
  reason: string;
  targetSummary?: string;
  destructive?: boolean;
  sensitive?: boolean;
  metadata?: Record<string, unknown>;
}): SafetyDecision {
  return {
    schemaVersion: "safety-decision.v1",
    subjectKind: input.subjectKind,
    actionFamily: input.actionFamily,
    decision: input.decision,
    risk: input.risk,
    reason: input.reason,
    targetSummary: input.targetSummary,
    destructive: input.destructive ?? input.risk === "destructive",
    sensitive: input.sensitive ?? input.risk === "credential",
    redaction: {
      mode: "metadata_only",
      secretValuesPersisted: false
    },
    metadata: input.metadata
  };
}

export function normalizeSafetyRisk(input: string | undefined): SafetyRiskLevel {
  if (input === "credential" || input === "destructive" || input === "high" || input === "medium" || input === "low") {
    return input;
  }
  return "medium";
}

