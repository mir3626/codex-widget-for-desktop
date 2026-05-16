import type {
  ComputerUseEvalRunSummary,
  ComputerUseEvalStepSummary,
  ComputerUseVerifierAuditClass,
  ComputerUseVerifierAuditSummary,
  ComputerUseVerifierStepAudit
} from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";

export function auditComputerUseVerifier(input: {
  storage: StorageService;
  runId?: string;
  sessionId?: string;
  scenarioId?: string;
  limit?: number;
  includePassing?: boolean;
}): ComputerUseVerifierAuditSummary {
  const createdAt = new Date().toISOString();
  const runs = listAuditRuns(input);
  const audits: ComputerUseVerifierStepAudit[] = [];
  let stepsAudited = 0;
  let verifierStepCount = 0;

  for (const run of runs) {
    const steps = input.storage.listComputerUseEvalSteps(run.id);
    stepsAudited += steps.length;
    const verifierSteps = steps.filter(isVerifierStep);
    verifierStepCount += verifierSteps.length;
    const verifierStepsByJob = groupVerifierStepsByJob(verifierSteps);

    for (const step of verifierSteps) {
      const audit = auditVerifierStep({ run, step, createdAt });
      if (input.includePassing || audit.auditClass !== "consistent_pass") {
        audits.push(audit);
      }
    }

    for (const step of steps) {
      if (!isActionStepWithExpectedEffect(step) || !step.capabilityJobId) {
        continue;
      }
      if ((verifierStepsByJob.get(step.capabilityJobId) ?? []).length > 0) {
        continue;
      }
      audits.push(auditMissingVerifierStep({
        run,
        step,
        createdAt,
        matchingVerifierStepIds: []
      }));
    }
  }

  return {
    schemaVersion: "computer-use-verifier-audit.v1",
    createdAt,
    runsAudited: runs.length,
    stepsAudited,
    verifierStepCount,
    falsePositiveCandidates: countAudits(audits, "false_positive_candidate"),
    falseNegativeRecords: countAudits(audits, "false_negative_record"),
    inconclusiveRecords: countAudits(audits, "inconclusive_verifier"),
    missingVerifierEvidence: countAudits(audits, "missing_verifier_evidence"),
    audits
  };
}

function listAuditRuns(input: {
  storage: StorageService;
  runId?: string;
  sessionId?: string;
  scenarioId?: string;
  limit?: number;
}): ComputerUseEvalRunSummary[] {
  if (input.runId) {
    const run = input.storage.readComputerUseEvalRun(input.runId);
    return run ? [run] : [];
  }
  return input.storage.listComputerUseEvalRuns({
    sessionId: input.sessionId,
    scenarioId: input.scenarioId,
    limit: normalizeLimit(input.limit)
  });
}

function auditVerifierStep(input: {
  run: ComputerUseEvalRunSummary;
  step: ComputerUseEvalStepSummary;
  createdAt: string;
}): ComputerUseVerifierStepAudit {
  const verifierStatus = readVerifierStatus(input.step);
  const verifierClass = readVerifierClass(input.step.output);
  const proofRecorded = hasProof(input.step.output);
  const recoveryAttempted = readRecoveryAttempted(input.step.output);
  const auditClass = classifyVerifierStep({
    run: input.run,
    step: input.step,
    verifierStatus
  });
  return {
    id: `verifier-audit:${input.step.id}`,
    runId: input.run.id,
    scenarioId: input.run.scenarioId,
    sessionId: input.run.sessionId,
    stepId: input.step.id,
    stepKind: input.step.kind,
    phase: input.step.phase,
    capabilityJobId: input.step.capabilityJobId,
    capabilityDagNodeId: input.step.capabilityDagNodeId,
    verifierStatus,
    verifierClass,
    failureClass: input.step.failureClass,
    auditClass,
    reason: reasonForVerifierAudit({ auditClass, verifierStatus, failureClass: input.step.failureClass }),
    evidence: {
      taskSuccess: input.run.taskSuccess,
      runFailureClass: input.run.failureClass,
      expectedDeclared: hasExpectedDeclaration(input.step.input) || hasExpectedDeclaration(input.step.output),
      proofRecorded,
      recoveryAttempted,
      matchingVerifierStepIds: [input.step.id]
    },
    createdAt: input.createdAt
  };
}

function auditMissingVerifierStep(input: {
  run: ComputerUseEvalRunSummary;
  step: ComputerUseEvalStepSummary;
  createdAt: string;
  matchingVerifierStepIds: string[];
}): ComputerUseVerifierStepAudit {
  return {
    id: `verifier-audit:missing:${input.step.id}`,
    runId: input.run.id,
    scenarioId: input.run.scenarioId,
    sessionId: input.run.sessionId,
    stepId: input.step.id,
    stepKind: input.step.kind,
    phase: input.step.phase,
    capabilityJobId: input.step.capabilityJobId,
    capabilityDagNodeId: input.step.capabilityDagNodeId,
    verifierStatus: "unknown",
    failureClass: input.step.failureClass,
    auditClass: "missing_verifier_evidence",
    reason: "The action step declared an expected effect but has no matching verifier eval step.",
    evidence: {
      taskSuccess: input.run.taskSuccess,
      runFailureClass: input.run.failureClass,
      expectedDeclared: true,
      proofRecorded: false,
      recoveryAttempted: false,
      matchingVerifierStepIds: input.matchingVerifierStepIds
    },
    createdAt: input.createdAt
  };
}

function classifyVerifierStep(input: {
  run: ComputerUseEvalRunSummary;
  step: ComputerUseEvalStepSummary;
  verifierStatus: "passed" | "failed" | "inconclusive" | "unknown";
}): ComputerUseVerifierAuditClass {
  if (input.step.failureClass === "verification_false_positive" || input.run.failureClass === "verification_false_positive") {
    return "false_positive_candidate";
  }
  if (input.verifierStatus === "inconclusive") {
    return "inconclusive_verifier";
  }
  if (input.step.failureClass === "verification_false_negative" || input.run.failureClass === "verification_false_negative") {
    return "false_negative_record";
  }
  if (
    input.verifierStatus === "passed" &&
    (input.run.taskSuccess === "failed" || input.run.failureClass !== "none" && input.run.failureClass !== "unknown")
  ) {
    return "false_positive_candidate";
  }
  if (input.verifierStatus === "passed") {
    return "consistent_pass";
  }
  return "consistent_failure";
}

function reasonForVerifierAudit(input: {
  auditClass: ComputerUseVerifierAuditClass;
  verifierStatus: "passed" | "failed" | "inconclusive" | "unknown";
  failureClass?: string;
}): string {
  if (input.auditClass === "false_positive_candidate") {
    return "Verifier success conflicts with the run failure state or an explicit verification_false_positive marker.";
  }
  if (input.auditClass === "false_negative_record") {
    return "Verifier failed or could not prove the expected effect and recorded verification_false_negative evidence.";
  }
  if (input.auditClass === "inconclusive_verifier") {
    return "Verifier result was inconclusive and must not be promoted as task success.";
  }
  if (input.auditClass === "consistent_pass") {
    return "Verifier passed and no run-level failure conflict was found.";
  }
  return input.failureClass && input.failureClass !== "none"
    ? `Verifier did not pass with failure class ${input.failureClass}.`
    : `Verifier status is ${input.verifierStatus}.`;
}

function groupVerifierStepsByJob(steps: ComputerUseEvalStepSummary[]): Map<string, ComputerUseEvalStepSummary[]> {
  const grouped = new Map<string, ComputerUseEvalStepSummary[]>();
  for (const step of steps) {
    if (!step.capabilityJobId) {
      continue;
    }
    grouped.set(step.capabilityJobId, [...(grouped.get(step.capabilityJobId) ?? []), step]);
  }
  return grouped;
}

function isVerifierStep(step: ComputerUseEvalStepSummary): boolean {
  return /verif/i.test(step.kind) || /verif/i.test(step.phase) || hasVerifierLikeOutput(step.output);
}

function isActionStepWithExpectedEffect(step: ComputerUseEvalStepSummary): boolean {
  if (isVerifierStep(step) || step.kind === "recovery_attempt") {
    return false;
  }
  if (!step.capabilityJobId || step.status !== "completed") {
    return false;
  }
  return hasExpectedDeclaration(step.input) || hasExpectedDeclaration(step.output);
}

function hasVerifierLikeOutput(value: unknown): boolean {
  const record = readRecord(value);
  return Boolean(
    readRecord(record.verification).status ||
    readRecord(record.capabilityVerification).status ||
    readVerifierStatusValue(record.status)
  );
}

function readVerifierStatus(step: ComputerUseEvalStepSummary): "passed" | "failed" | "inconclusive" | "unknown" {
  const output = readRecord(step.output);
  return readVerifierStatusValue(output.status) ??
    readVerifierStatusValue(readRecord(output.verification).status) ??
    readVerifierStatusValue(readRecord(output.capabilityVerification).status) ??
    (step.status === "completed" ? "passed" : step.status === "failed" ? "failed" : "unknown");
}

function readVerifierStatusValue(value: unknown): "passed" | "failed" | "inconclusive" | undefined {
  if (value === "passed" || value === "failed" || value === "inconclusive") {
    return value;
  }
  return undefined;
}

function readVerifierClass(value: unknown): string | undefined {
  const output = readRecord(value);
  return readString(output.class) ??
    readString(readRecord(output.verification).class) ??
    readString(readRecord(output.capabilityVerification).class);
}

function readRecoveryAttempted(value: unknown): boolean {
  const output = readRecord(value);
  const recovery = readRecord(output.recovery);
  return recovery.attempted === true;
}

function hasProof(value: unknown): boolean {
  const output = readRecord(value);
  if (Object.keys(readRecord(output.evidence)).length > 0) {
    return true;
  }
  if (Object.keys(readRecord(readRecord(output.verification).evidence)).length > 0) {
    return true;
  }
  if (Object.keys(readRecord(readRecord(output.capabilityVerification).evidence)).length > 0) {
    return true;
  }
  return Boolean(output.reason || readRecord(output.detail).reason);
}

function hasExpectedDeclaration(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const text = JSON.stringify(value);
  return /expectedOutcome|expectedEffect|expectedState|verificationTarget|expectedTextContains|expectedStdoutContains/i.test(text);
}

function countAudits(audits: ComputerUseVerifierStepAudit[], auditClass: ComputerUseVerifierAuditClass): number {
  return audits.filter((audit) => audit.auditClass === auditClass).length;
}

function normalizeLimit(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(500, Math.floor(number)) : 100;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
