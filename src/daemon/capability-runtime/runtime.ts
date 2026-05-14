import { randomUUID } from "node:crypto";
import type {
  CapabilityEventPhase,
  CapabilityJobKind,
  CapabilityJobStatus,
  CapabilityJobSummary
} from "../../shared/protocol.js";
import { CapabilityCancellationRegistry } from "./cancellation.js";
import { CapabilityDurableQueue } from "./durableQueue.js";
import { CapabilityHelperSupervisor } from "./helperSupervisor.js";
import { CapabilityResourceManager } from "./resourceManager.js";
import { decideCapabilitySafety } from "./safety.js";
import { CapabilityScheduler } from "./scheduler.js";
import { attachCapabilityVerification, verifyCapabilityHandlerOutput } from "./verification.js";
import {
  finalizeEvalRunFromSteps,
  inferEvalModalitiesFromCapabilityKind,
  recordCapabilityJobEvalStep
} from "../computer-use-eval/index.js";
import type {
  CapabilityHandler,
  CapabilityHandlerOutput,
  CapabilityRuntimeEnqueueInput,
  CapabilityRuntimeEvent,
  CapabilityRuntimeOptions
} from "./types.js";

export class CapabilityRuntime {
  private readonly queue: CapabilityDurableQueue;
  private readonly scheduler: CapabilityScheduler;
  private readonly cancellations = new CapabilityCancellationRegistry();
  private readonly resources: CapabilityResourceManager;
  private readonly helpers = new CapabilityHelperSupervisor();
  private readonly handlers = new Map<CapabilityJobKind, CapabilityHandler>();
  private readonly activeRuns = new Map<string, Promise<void>>();
  private dispatchTimer: NodeJS.Timeout | undefined;
  private shuttingDown = false;

  constructor(private readonly options: CapabilityRuntimeOptions) {
    this.queue = new CapabilityDurableQueue(options.storage);
    this.resources = new CapabilityResourceManager(options.storage);
    this.scheduler = new CapabilityScheduler(options.maxActiveJobs, options.perKindLimits);
  }

  register(kind: CapabilityJobKind, handler: CapabilityHandler): void {
    this.handlers.set(kind, handler);
  }

  reconcileStartup(): CapabilityJobSummary[] {
    const jobs = this.options.storage.reconcileCapabilityJobsOnStartup();
    for (const job of jobs) {
      this.emit({
        type: "job",
        job,
        phase: job.status === "expired" ? "expired" : "failed",
        summary: job.lastError ?? "Capability job reconciled during daemon startup."
      });
    }
    for (const job of this.options.storage.listCapabilityJobs({ statuses: ["queued", "scheduled"], limit: 100 })) {
      if (!isStartupRecoverable(job)) {
        continue;
      }
      this.emitJobEvent(job, "queued", "Capability read-only job resumed after daemon startup.", { recovery: "startup_resume" });
      this.startRun(job.id);
    }
    return jobs;
  }

  markShutdown(): CapabilityJobSummary[] {
    this.shuttingDown = true;
    this.cancellations.cancelAll("daemon_shutdown");
    const jobs = this.options.storage.markActiveCapabilityJobsForShutdown();
    for (const job of jobs) {
      this.emit({
        type: "job",
        job,
        phase: "cancelled",
        summary: "Capability job cancelled by daemon shutdown."
      });
    }
    return jobs;
  }

  async shutdown(timeoutMs = 3000): Promise<CapabilityJobSummary[]> {
    const jobs = this.markShutdown();
    if (this.activeRuns.size === 0) {
      return jobs;
    }
    await Promise.race([
      Promise.allSettled([...this.activeRuns.values()]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
    return jobs;
  }

  async enqueue(input: CapabilityRuntimeEnqueueInput): Promise<CapabilityJobSummary> {
    const safety = decideCapabilitySafety(input);
    const persistedInput = this.attachAutomaticEvalRun(input, sanitizeCapabilityInputForPersistence(input.kind, input.input));
    const job = this.queue.create({
      ...input,
      input: persistedInput,
      leaseId: input.leaseId ?? input.lockKey,
      approvalId: safety.approvalId ?? input.approvalId
    });
    this.emitJobEvent(job, "queued", `Capability job queued: ${job.kind}`, { safety: safety.reason });
    if (safety.requiresApproval) {
      const waiting = this.options.storage.updateCapabilityJob({
        id: job.id,
        status: "awaiting_approval",
        approvalId: safety.approvalId ?? job.approvalId ?? `approval:${job.id}`
      });
      this.emitJobEvent(waiting, "awaiting_approval", `Capability job awaiting approval: ${job.kind}`, { safety: safety.reason });
      return waiting;
    }
    this.startRun(job.id);
    return job;
  }

  list(input: { sessionId?: string; statuses?: CapabilityJobStatus[]; limit?: number } = {}): CapabilityJobSummary[] {
    return this.queue.list(input);
  }

  read(jobId: string): CapabilityJobSummary | null {
    return this.queue.read(jobId);
  }

  async approve(jobId: string): Promise<CapabilityJobSummary> {
    const job = this.requireJob(jobId);
    if (job.status !== "awaiting_approval") {
      return job;
    }
    if (Date.parse(job.deadlineAt) <= Date.now()) {
      const expired = this.options.storage.updateCapabilityJob({
        id: job.id,
        status: "expired",
        completedAt: new Date().toISOString(),
        lastError: "approval_deadline_expired"
      });
      this.emitJobEvent(expired, "expired", "Capability approval expired before execution.");
      return expired;
    }
    const queued = this.options.storage.updateCapabilityJob({
      id: job.id,
      status: "queued",
      approvalId: job.approvalId ?? `approval:${job.id}`
    });
    this.emitJobEvent(queued, "queued", "Capability job approval accepted.");
    this.startRun(queued.id);
    return queued;
  }

  async cancel(jobId: string, reason = "cancelled"): Promise<CapabilityJobSummary> {
    const job = this.requireJob(jobId);
    if (isFinalStatus(job.status)) {
      return job;
    }
    this.cancellations.cancel(job.id, reason);
    const now = new Date().toISOString();
    const nextStatus: CapabilityJobStatus = job.status === "running" ? "cancelling" : "cancelled";
    const cancelled = this.options.storage.updateCapabilityJob({
      id: job.id,
      status: nextStatus,
      cancelledAt: now,
      completedAt: nextStatus === "cancelled" ? now : undefined,
      lastError: reason
    });
    this.options.storage.appendCapabilityJobEvent({
      jobId: cancelled.id,
      transactionId: cancelled.transactionId,
      phase: "cancelled",
      status: cancelled.status,
      summary: `Capability job cancelled: ${reason}`,
      detail: { previousStatus: job.status }
    });
    this.options.storage.releaseCapabilityLock({ jobId: cancelled.id });
    this.emitJobEvent(cancelled, "cancelled", `Capability job cancelled: ${reason}`);
    return cancelled;
  }

  private startRun(jobId: string): void {
    const promise = this.runQueued(jobId).finally(() => {
      this.activeRuns.delete(jobId);
    });
    this.activeRuns.set(jobId, promise);
  }

  private async runQueued(jobId: string): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    let job = this.requireJob(jobId);
    if (job.status !== "queued" && job.status !== "scheduled") {
      return;
    }
    if (Date.parse(job.deadlineAt) <= Date.now()) {
      const expired = this.options.storage.updateCapabilityJob({
        id: job.id,
        status: "expired",
        completedAt: new Date().toISOString(),
        lastError: "deadline_expired"
      });
      this.emitJobEvent(expired, "expired", "Capability job expired before execution.");
      return;
    }
    const leaseDecision = validateCapabilityLease(job);
    if (!leaseDecision.ok) {
      const failed = this.options.storage.updateCapabilityJob({
        id: job.id,
        status: leaseDecision.status,
        completedAt: new Date().toISOString(),
        lastError: leaseDecision.reason
      });
      this.emitJobEvent(failed, leaseDecision.status === "expired" ? "expired" : "failed", leaseDecision.reason, leaseDecision.detail);
      return;
    }
    if (!this.scheduler.start(job)) {
      const scheduled = this.options.storage.updateCapabilityJob({
        id: job.id,
        status: "scheduled"
      });
      this.emitJobEvent(scheduled, "queued", "Capability job scheduled behind active work.");
      this.scheduleQueueDispatch(50);
      return;
    }
    if (job.leaseId) {
      const lock = this.options.storage.acquireCapabilityLock({
        jobId: job.id,
        lockKey: job.leaseId,
        kind: job.kind,
        expiresAt: job.deadlineAt
      });
      if (!lock) {
        this.scheduler.finish(job.id);
        const scheduled = this.options.storage.updateCapabilityJob({
          id: job.id,
          status: "scheduled"
        });
        this.emitJobEvent(scheduled, "queued", "Capability job scheduled behind active surface lock.", { lockKey: job.leaseId });
        this.scheduleQueueDispatch(50);
        return;
      }
      this.emitJobEvent(job, "queued", "Capability surface lock acquired.", { lockKey: lock.lockKey, expiresAt: lock.expiresAt });
    }

    const controller = this.cancellations.create(job.id);
    try {
      if (this.shuttingDown) {
        return;
      }
      job = this.options.storage.updateCapabilityJob({
        id: job.id,
        status: "running",
        startedAt: new Date().toISOString()
      });
      this.emitJobEvent(job, "executing", `Capability job running: ${job.kind}`);
      const handler = this.handlers.get(job.kind);
      const result = handler
        ? await handler({
            job,
            signal: controller.signal,
            storage: this.options.storage,
            resources: this.resources,
            helpers: this.helpers
          })
        : await defaultHandler(job);
      if (this.shuttingDown) {
        return;
      }
      const latest = this.queue.read(job.id);
      if (!latest || isFinalStatus(latest.status)) {
        return;
      }
      const postLeaseDecision = validateCapabilityLease(latest);
      this.finishJob(latest, controller.signal.aborted
        ? { ...result, status: "cancelled" }
        : postLeaseDecision.ok
          ? result
          : { status: postLeaseDecision.status === "expired" ? "failed" : "failed", output: result.output, error: postLeaseDecision.reason });
    } catch (error) {
      if (this.shuttingDown) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const latest = this.queue.read(job.id);
      if (!latest || isFinalStatus(latest.status)) {
        return;
      }
      const failed = this.options.storage.updateCapabilityJob({
        id: job.id,
        status: controller.signal.aborted ? "cancelled" : "failed",
        completedAt: new Date().toISOString(),
        cancelledAt: controller.signal.aborted ? new Date().toISOString() : undefined,
        lastError: message
      });
      this.resources.releaseJob(job.id);
      this.emitJobEvent(failed, controller.signal.aborted ? "cancelled" : "failed", message);
    } finally {
      this.options.storage.releaseCapabilityLock({ jobId: job.id });
      this.scheduler.finish(job.id);
      this.cancellations.complete(job.id);
      this.scheduleQueueDispatch();
    }
  }

  private finishJob(job: CapabilityJobSummary, result: CapabilityHandlerOutput): void {
    const verification = verifyCapabilityHandlerOutput(job, result);
    const status = result.status ?? (result.error || verification.status === "failed" ? "failed" : "completed");
    const now = new Date().toISOString();
    this.emitJobEvent(job, "verifying", verification.reason, { verification });
    const outputJson = attachCapabilityVerification(result.output, verification);
    let completed = this.options.storage.updateCapabilityJob({
      id: job.id,
      status,
      outputJson,
      outputBlobIds: result.outputBlobIds,
      completedAt: now,
      cancelledAt: status === "cancelled" ? now : undefined,
      lastError: result.error ?? (verification.status === "failed" ? verification.reason : undefined)
    });
    const resourceAccounting = this.resources.releaseJob(job.id);
    if (resourceAccounting.activeBytesReleased || resourceAccounting.cleanup.resourcesDeleted) {
      completed = this.options.storage.updateCapabilityJob({
        id: completed.id,
        outputJson: {
          ...(completed.outputJson && typeof completed.outputJson === "object" && !Array.isArray(completed.outputJson) ? completed.outputJson as Record<string, unknown> : { value: completed.outputJson }),
          resourceAccounting
        }
      });
    }
    this.emitJobEvent(
      completed,
      result.phase ?? (status === "completed" ? "completed" : status),
      result.summary ?? (status === "completed" ? `Capability job completed: ${job.kind}` : result.error ?? `Capability job ${status}`)
    );
    this.updateDagNodeForCompletedJob(completed, status);
  }

  private emitJobEvent(job: CapabilityJobSummary, phase: CapabilityEventPhase, summary: string, detail?: unknown): void {
    this.options.storage.appendCapabilityJobEvent({
      jobId: job.id,
      transactionId: job.transactionId,
      phase,
      status: job.status,
      summary,
      detail
    });
    if (job.sessionId && isLedgerActivityPhase(phase)) {
      this.options.storage.recordActivity({
        id: `capability-activity-${randomUUID()}`,
        sessionId: job.sessionId,
        level: phase === "failed" || phase === "expired" || phase === "blocked" ? "warn" : phase === "cancelled" ? "info" : "info",
        category: "capability",
        summary,
        detail: {
          jobId: job.id,
          transactionId: job.transactionId,
          kind: job.kind,
          status: job.status,
          phase,
          outputBlobIds: job.outputBlobIds,
          leaseId: job.leaseId,
          lastError: job.lastError,
          detail
        }
      });
    }
    recordCapabilityJobEvalStep({
      storage: this.options.storage,
      job,
      phase,
      summary,
      detail
    });
    this.finalizeEvalRunForFinalJobEvent(job, phase);
    this.emit({ type: "job", job, phase, summary, detail });
  }

  private attachAutomaticEvalRun(input: CapabilityRuntimeEnqueueInput, persistedInput: unknown): unknown {
    if (!persistedInput || typeof persistedInput !== "object" || Array.isArray(persistedInput)) {
      return persistedInput;
    }
    const record = persistedInput as Record<string, unknown>;
    if (typeof record.evalRunId === "string" || record.recordEval === false) {
      return persistedInput;
    }
    const now = new Date().toISOString();
    const prompt = readFirstString(record, ["prompt", "description", "command", "utterance", "query", "task"]);
    const run = this.options.storage.createComputerUseEvalRun({
      scenario: {
        id: `capability:${input.kind}:${input.transactionId ?? input.id ?? randomUUID()}`,
        title: `Capability ${input.kind}`,
        modalities: inferEvalModalitiesFromCapabilityKind(input.kind),
        source: "capability_runtime",
        prompt,
        setup: {
          requestedBy: input.requestedBy ?? "direct_ui",
          priority: input.priority ?? "normal",
          timeoutMs: input.timeoutMs
        },
        expectedOutcome: record.expectedOutcome,
        tags: ["capability_runtime", input.kind],
        safetyBoundaries: [
          "approval_required_for_high_risk_actions",
          "restricted_pages_are_not_bypassed",
          "credential_like_fields_are_redacted"
        ]
      },
      sessionId: input.sessionId,
      modalities: inferEvalModalitiesFromCapabilityKind(input.kind),
      prompt,
      status: "running",
      startedAt: now,
      metrics: {
        autoRecorded: true,
        capabilityKind: input.kind
      }
    });
    return { ...record, evalRunId: run.id };
  }

  private finalizeEvalRunForFinalJobEvent(job: CapabilityJobSummary, phase: CapabilityEventPhase): void {
    if (!isFinalEvalPhase(phase, job.status)) {
      return;
    }
    const evalRunId = readEvalRunId(job.inputJson);
    if (!evalRunId || !this.options.storage.readComputerUseEvalRun(evalRunId)) {
      return;
    }
    try {
      finalizeEvalRunFromSteps({
        storage: this.options.storage,
        runId: evalRunId,
        status: job.status === "cancelled" ? "cancelled" : job.status === "completed" ? "completed" : "failed",
        taskSuccess: job.status === "completed" ? "passed" : job.status === "cancelled" ? "unknown" : "failed",
        failureClass: job.status === "completed"
          ? "none"
          : job.status === "expired"
            ? "timeout"
            : job.lastError?.includes("restricted")
              ? "restricted_surface"
              : job.lastError?.includes("approval")
                ? "approval_denied"
                : job.lastError?.includes("unsafe")
                  ? "unsafe_action_rejected"
                  : "action_failed"
      });
    } catch {
      // Eval recording must not turn a capability result into a runtime failure.
    }
  }

  private updateDagNodeForCompletedJob(job: CapabilityJobSummary, status: CapabilityJobStatus): void {
    const input = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as Record<string, unknown> : {};
    const dagNodeId = typeof input.dagNodeId === "string" ? input.dagNodeId : undefined;
    const dagRunId = typeof input.dagRunId === "string" ? input.dagRunId : undefined;
    if (!dagNodeId || !dagRunId) {
      return;
    }
    const existing = this.options.storage.readCapabilityDagNode(dagNodeId);
    if (!existing) {
      return;
    }
    const completedAt = job.completedAt ?? new Date().toISOString();
    this.options.storage.upsertCapabilityDagNode({
      ...existing,
      status: status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
      capabilityJobId: job.id,
      output: job.outputJson,
      resourceUsage: { outputBlobIds: job.outputBlobIds },
      completedAt,
      elapsedMs: existing.startedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(existing.startedAt)) : undefined,
      lastError: job.lastError
    });
  }

  private emit(event: CapabilityRuntimeEvent): void {
    this.options.emit?.(event);
  }

  private scheduleQueueDispatch(delayMs = 0): void {
    if (this.shuttingDown || this.dispatchTimer) {
      return;
    }
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = undefined;
      this.dispatchQueuedJobs();
    }, delayMs);
  }

  private dispatchQueuedJobs(): void {
    if (this.shuttingDown) {
      return;
    }
    const jobs = this.options.storage
      .listCapabilityJobs({ statuses: ["queued", "scheduled"], limit: 100 })
      .filter((job) => !this.activeRuns.has(job.id))
      .sort(compareDispatchPriority);
    for (const job of jobs) {
      if (this.scheduler.canStart(job) || Date.parse(job.deadlineAt) <= Date.now()) {
        this.startRun(job.id);
      }
    }
  }

  private requireJob(jobId: string): CapabilityJobSummary {
    const job = this.queue.read(jobId);
    if (!job) {
      throw new Error(`Capability job not found: ${jobId}`);
    }
    return job;
  }
}

async function defaultHandler(job: CapabilityJobSummary): Promise<CapabilityHandlerOutput> {
  if (job.kind === "screen_observe" || job.kind === "ocr") {
    return {
      status: "completed",
      output: { ok: true, kind: job.kind, mode: "foundation_noop", input: job.inputJson },
      summary: `Capability ${job.kind} foundation job completed.`
    };
  }
  return {
    status: "failed",
    error: `No capability handler registered for ${job.kind}.`,
    phase: "failed"
  };
}

function isFinalStatus(status: CapabilityJobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "expired";
}

function isLedgerActivityPhase(phase: CapabilityEventPhase): boolean {
  return phase === "completed" || phase === "failed" || phase === "cancelled" || phase === "expired" || phase === "blocked";
}

function isFinalEvalPhase(phase: CapabilityEventPhase, status: CapabilityJobStatus): boolean {
  return (phase === "completed" || phase === "failed" || phase === "cancelled" || phase === "expired") && isFinalStatus(status);
}

function readEvalRunId(input: unknown): string | undefined {
  const record = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return typeof record.evalRunId === "string" ? record.evalRunId : undefined;
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.slice(0, 500);
    }
  }
  return undefined;
}

function compareDispatchPriority(left: CapabilityJobSummary, right: CapabilityJobSummary): number {
  const priority = priorityRank(right.priority) - priorityRank(left.priority);
  if (priority !== 0) {
    return priority;
  }
  const deadline = Date.parse(left.deadlineAt) - Date.parse(right.deadlineAt);
  if (deadline !== 0) {
    return deadline;
  }
  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

function priorityRank(priority: CapabilityJobSummary["priority"]): number {
  if (priority === "interactive") return 3;
  if (priority === "normal") return 2;
  return 1;
}

function isStartupRecoverable(job: CapabilityJobSummary): boolean {
  if (Date.parse(job.deadlineAt) <= Date.now()) {
    return false;
  }
  return job.kind === "screen_observe" || job.kind === "ocr";
}

function validateCapabilityLease(job: CapabilityJobSummary): {
  ok: true;
} | {
  ok: false;
  status: Extract<CapabilityJobStatus, "failed" | "expired">;
  reason: string;
  detail?: Record<string, unknown>;
} {
  const lease = readCapabilityContextLease(job.inputJson);
  if (!lease) {
    return { ok: true };
  }
  const now = Date.now();
  if (lease.expiresAt && Date.parse(lease.expiresAt) <= now) {
    return {
      ok: false,
      status: "expired",
      reason: "context_lease_expired",
      detail: { lease }
    };
  }
  const leaseId = lease.leaseId ?? lease.id;
  if (job.leaseId && leaseId && job.leaseId !== leaseId) {
    return {
      ok: false,
      status: "failed",
      reason: "context_lease_mismatch",
      detail: { jobLeaseId: job.leaseId, contextLeaseId: leaseId }
    };
  }
  return { ok: true };
}

function readCapabilityContextLease(input: unknown): { id?: string; leaseId?: string; expiresAt?: string } | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  const candidates = [record.contextLease, record.lease, record.transaction].filter((value) => value && typeof value === "object") as Record<string, unknown>[];
  for (const candidate of candidates) {
    const expiresAt = typeof candidate.expiresAt === "string" ? candidate.expiresAt : undefined;
    const leaseId = typeof candidate.leaseId === "string" ? candidate.leaseId : undefined;
    const id = typeof candidate.id === "string" ? candidate.id : undefined;
    if (expiresAt || leaseId || id) {
      return { id, leaseId, expiresAt };
    }
  }
  return null;
}

function sanitizeCapabilityInputForPersistence(kind: CapabilityJobKind, input: unknown): unknown {
  if (kind === "terminal") {
    const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const command = typeof record.command === "string" ? record.command : "";
    if (containsSensitiveText(command)) {
      throw new Error("Refusing to persist or execute a terminal capability command containing credential-like text.");
    }
  }
  return redactSensitiveCapabilityValue(input);
}

function redactSensitiveCapabilityValue(value: unknown, key = ""): unknown {
  if (isSensitiveKey(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    return containsSensitiveInlineValue(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redactSensitiveCapabilityValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    output[childKey] = redactSensitiveCapabilityValue(childValue, childKey);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  return /password|passwd|token|cookie|credential|payment|card|secret|api[_-]?key/i.test(key);
}

function containsSensitiveText(text: string): boolean {
  return /(?:password|passwd|token|cookie|credential|secret|api[_-]?key)\s*[:=]/i.test(text);
}

function containsSensitiveInlineValue(text: string): boolean {
  return /(?:password|passwd|token|cookie|credential|secret|api[_-]?key)\s*[:=]\s*\S+/i.test(text);
}
