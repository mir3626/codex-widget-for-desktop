export type SafetyRiskLevel = "low" | "medium" | "high" | "destructive" | "credential";

export type SafetyDecisionKind = "allow" | "confirm" | "clarify" | "block";

export type SafetySubjectKind =
  | "browser_action"
  | "terminal_command"
  | "vision_intent"
  | "agent_tool"
  | "desktop_action";

export type SafetyDecision = {
  schemaVersion: "safety-decision.v1";
  subjectKind: SafetySubjectKind;
  actionFamily: string;
  decision: SafetyDecisionKind;
  risk: SafetyRiskLevel;
  reason: string;
  targetSummary?: string;
  destructive: boolean;
  sensitive: boolean;
  redaction: {
    mode: "metadata_only";
    secretValuesPersisted: false;
  };
  metadata?: Record<string, unknown>;
};

