import type {
  CapabilityJobSummary,
  ComputerUseEvalMetricSummary,
  ComputerUseEvalModality,
  ComputerUseEvalRunSummary,
  ComputerUseEvalStatus,
  ComputerUseFailureClass,
  ComputerUseTaskSuccess
} from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";
export { auditComputerUseVerifier } from "./verifierAudit.js";

export function inferEvalModalitiesFromCapabilityKind(kind: CapabilityJobSummary["kind"]): ComputerUseEvalModality[] {
  if (kind === "browser_action" || kind === "browser_chrome") return ["browser"];
  if (kind === "desktop_action") return ["windows"];
  if (kind === "screen_observe" || kind === "ocr") return ["vision"];
  if (kind === "terminal") return ["terminal"];
  if (kind === "agent_tool") return ["cross_app"];
  return ["cross_app"];
}

export function recordCapabilityJobEvalStep(input: {
  storage: StorageService;
  job: CapabilityJobSummary;
  phase: string;
  summary: string;
  detail?: unknown;
}): void {
  const runId = readEvalRunId(input.job.inputJson);
  if (!runId || !input.storage.readComputerUseEvalRun(runId)) {
    return;
  }
  const completedAt = input.job.completedAt ?? input.job.updatedAt;
  const startedAt = input.job.startedAt ?? input.job.createdAt;
  const step = input.storage.appendComputerUseEvalStep({
    runId,
    kind: `capability:${input.job.kind}`,
    phase: input.phase,
    status: input.job.status,
    capabilityJobId: input.job.id,
    capabilityDagNodeId: readDagNodeId(input.job.inputJson),
    input: redactEvalInput(input.job.inputJson),
    output: {
      summary: input.summary,
      detail: input.detail,
      output: input.job.outputJson,
      outputBlobIds: input.job.outputBlobIds
    },
    startedAt,
    completedAt,
    elapsedMs: startedAt && completedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) : undefined,
    failureClass: mapCapabilityFailureClass(input.job)
  });
  if (isFinalCapabilityPhase(input.phase)) {
    for (const resource of input.storage.listCapabilityResources(input.job.id)) {
      input.storage.createComputerUseEvalResource({
        runId,
        stepId: step.id,
        capabilityResourceId: resource.id,
        blobId: resource.blobId,
        role: resource.role,
        retention: resource.retention,
        redaction: resource.redaction
      });
    }
  }
}

export function finalizeEvalRunFromSteps(input: {
  storage: StorageService;
  runId: string;
  status?: ComputerUseEvalStatus;
  taskSuccess?: ComputerUseTaskSuccess;
  failureClass?: ComputerUseFailureClass;
}): ComputerUseEvalRunSummary {
  const run = input.storage.readComputerUseEvalRun(input.runId);
  if (!run) {
    throw new Error(`Computer-use eval run not found: ${input.runId}`);
  }
  const steps = input.storage.listComputerUseEvalSteps(input.runId);
  const completedAt = new Date().toISOString();
  const failed = steps.some((step) => step.status === "failed" || step.status === "expired");
  const blocked = steps.some((step) => step.failureClass === "restricted_surface" || step.failureClass === "external_blocker");
  const taskSuccess = input.taskSuccess ?? (failed ? "failed" : blocked ? "blocked" : "passed");
  const failureClass = input.failureClass ?? firstFailureClass(steps.map((step) => step.failureClass)) ?? (failed ? "unknown" : "none");
  const actionCount = steps.reduce((sum, step) => sum + readEvalStepActionCount(step), 0);
  return input.storage.updateComputerUseEvalRun({
    id: input.runId,
    status: input.status ?? (taskSuccess === "failed" ? "failed" : "completed"),
    taskSuccess,
    failureClass,
    completedAt,
    metrics: {
      ...run.metrics,
      steps: steps.length,
      actionCount,
      proofRecorded: steps.some((step) => String(step.phase).includes("verif") || hasVerification(step.output)),
      clarificationCount: steps.filter((step) => step.phase === "clarifying").length
    }
  });
}

export function rollupComputerUseEvalMetrics(runs: ComputerUseEvalRunSummary[]): ComputerUseEvalMetricSummary {
  const completed = runs.filter((run) => run.status === "completed" || run.status === "failed");
  const latencies = completed.map((run) => run.elapsedMs ?? elapsed(run)).filter(isFiniteNumber).sort((a, b) => a - b);
  const perceptionLatencies = completed
    .map((run) => Number(run.metrics?.perceptionLatencyMs ?? run.metrics?.p95PerceptionLatencyMs))
    .filter(isFiniteNumber)
    .sort((a, b) => a - b);
  const denominator = Math.max(1, completed.length);
  return {
    taskSuccessRate: ratio(completed, (run) => run.taskSuccess === "passed"),
    proofRate: ratio(completed, (run) => Boolean(run.metrics?.proofRecorded || run.metrics?.proofRate)),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    p50PerceptionLatencyMs: percentile(perceptionLatencies, 0.5),
    p95PerceptionLatencyMs: percentile(perceptionLatencies, 0.95),
    averageActionCount: completed.reduce((sum, run) => sum + Number(run.metrics?.actionCount ?? 0), 0) / denominator,
    clarificationRate: ratio(completed, (run) => Number(run.metrics?.clarificationCount ?? 0) > 0),
    abstentionRate: ratio(completed, (run) => run.taskSuccess === "abstained"),
    unsafeActionRejectionRate: ratio(completed, (run) => run.failureClass === "unsafe_action_rejected"),
    recoverySuccessRate: ratio(completed, (run) => run.taskSuccess === "passed" && Number(run.metrics?.recoveryCount ?? 0) > 0),
    verifierFalsePositiveCount: completed.filter((run) => run.failureClass === "verification_false_positive").length,
    verifierFalseNegativeCount: completed.filter((run) => run.failureClass === "verification_false_negative").length,
    runs: completed.length
  };
}

export function createReleaseReadinessSummary(runs: ComputerUseEvalRunSummary[]): Record<string, unknown> {
  const metrics = rollupComputerUseEvalMetrics(runs);
  return {
    schemaVersion: "computer-use-readiness.v1",
    metrics,
    promotable:
      metrics.taskSuccessRate > 0 &&
      metrics.unsafeActionRejectionRate >= 0 &&
      metrics.verifierFalsePositiveCount === 0,
    budgets: {
      p95LatencyTracked: metrics.p95LatencyMs > 0,
      perceptionP95Tracked: metrics.p95PerceptionLatencyMs > 0
    }
  };
}

function readEvalRunId(input: unknown): string | undefined {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return typeof record.evalRunId === "string" ? record.evalRunId : undefined;
}

function readDagNodeId(input: unknown): string | undefined {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return typeof record.dagNodeId === "string" ? record.dagNodeId : undefined;
}

function redactEvalInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[key] = /token|cookie|credential|secret|password|audio|imageDataUrl/i.test(key)
      ? "[redacted]"
      : value;
  }
  return output;
}

function mapCapabilityFailureClass(job: CapabilityJobSummary): ComputerUseFailureClass | undefined {
  if (job.status === "completed") return "none";
  if (job.status === "expired") return "timeout";
  if (job.lastError?.includes("restricted")) return "restricted_surface";
  if (job.lastError?.includes("approval")) return "approval_denied";
  if (job.lastError?.includes("unsafe")) return "unsafe_action_rejected";
  if (job.status === "failed") return "action_failed";
  return undefined;
}

function firstFailureClass(classes: Array<ComputerUseFailureClass | undefined>): ComputerUseFailureClass | undefined {
  return classes.find((value) => value && value !== "none");
}

function hasVerification(value: unknown): boolean {
  return Boolean(JSON.stringify(value ?? {}).includes("verification"));
}

function readEvalStepActionCount(step: { kind: string; output?: unknown }): number {
  if (step.output && typeof step.output === "object" && !Array.isArray(step.output)) {
    const record = step.output as Record<string, unknown>;
    const explicitCount = Number(record.actionCount ?? record.succeededActionCount);
    if (Number.isFinite(explicitCount) && explicitCount > 0) {
      return Math.floor(explicitCount);
    }
  }
  return step.kind.includes("capability:") ? 1 : 0;
}

function isFinalCapabilityPhase(phase: string): boolean {
  return phase === "completed" || phase === "failed" || phase === "cancelled" || phase === "expired";
}

function elapsed(run: ComputerUseEvalRunSummary): number {
  return run.completedAt ? Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt)) : 0;
}

function ratio(runs: ComputerUseEvalRunSummary[], predicate: (run: ComputerUseEvalRunSummary) => boolean): number {
  if (runs.length === 0) return 0;
  return runs.filter(predicate).length / runs.length;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * percentileValue) - 1));
  return values[index] ?? 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
