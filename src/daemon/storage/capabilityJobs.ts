import { randomUUID } from "node:crypto";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type {
  CapabilityEventPhase,
  CapabilityJobKind,
  CapabilityJobPriority,
  CapabilityJobRequestedBy,
  CapabilityJobStatus,
  CapabilityJobSummary,
  CapabilityLockSummary,
  CapabilityResourceRetention,
  CapabilityResourceSummary
} from "../../shared/protocol.js";

type CapabilityJobRow = {
  id: string;
  transaction_id: string;
  session_id?: string | null;
  kind: string;
  status: string;
  priority: string;
  requested_by: string;
  input_json: string;
  input_blob_ids_json: string;
  output_json?: string | null;
  output_blob_ids_json: string;
  lease_id?: string | null;
  approval_id?: string | null;
  timeout_ms: number;
  deadline_at: string;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  last_error?: string | null;
};

type CapabilityResourceRow = {
  id: string;
  job_id: string;
  transaction_id: string;
  blob_id?: string | null;
  role: string;
  mime: string;
  size: number;
  retention: string;
  preview_json?: string | null;
  redaction_json: string;
  created_at: string;
};

type CapabilityLockRow = {
  id: string;
  job_id?: string | null;
  lock_key: string;
  kind: string;
  acquired_at: string;
  expires_at: string;
};

export type CapabilityJobCreateInput = {
  id?: string;
  transactionId?: string;
  sessionId?: string;
  kind: CapabilityJobKind;
  status?: CapabilityJobStatus;
  priority?: CapabilityJobPriority;
  requestedBy?: CapabilityJobRequestedBy;
  inputJson?: unknown;
  inputBlobIds?: string[];
  leaseId?: string;
  approvalId?: string;
  timeoutMs?: number;
  deadlineAt?: string;
  maxRetries?: number;
  createdAt?: string;
};

export type CapabilityJobUpdateInput = {
  id: string;
  status?: CapabilityJobStatus;
  outputJson?: unknown;
  outputBlobIds?: string[];
  leaseId?: string | null;
  approvalId?: string | null;
  retryCount?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  lastError?: string | null;
  updatedAt?: string;
};

export type CapabilityJobEventInput = {
  id?: string;
  jobId: string;
  transactionId: string;
  phase: CapabilityEventPhase;
  status: CapabilityJobStatus;
  summary: string;
  detail?: unknown;
  createdAt?: string;
};

export type CapabilityResourceCreateInput = {
  id?: string;
  jobId: string;
  transactionId: string;
  blobId?: string | null;
  role: string;
  mime?: string;
  size?: number;
  retention?: CapabilityResourceRetention;
  preview?: unknown;
  redaction?: unknown;
  createdAt?: string;
};

export type CapabilityLockAcquireInput = {
  id?: string;
  jobId: string;
  lockKey: string;
  kind: CapabilityJobKind;
  expiresAt: string;
  acquiredAt?: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export function createCapabilityJob(database: NodeDatabaseSync, input: CapabilityJobCreateInput): CapabilityJobSummary {
  const now = input.createdAt ?? new Date().toISOString();
  const timeoutMs = normalizePositiveInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS);
  const deadlineAt = input.deadlineAt ?? new Date(Date.parse(now) + timeoutMs).toISOString();
  const job: CapabilityJobSummary = {
    id: input.id?.trim() || `capability-job-${randomUUID()}`,
    transactionId: input.transactionId?.trim() || `capability-transaction-${randomUUID()}`,
    sessionId: normalizeOptionalString(input.sessionId),
    kind: input.kind,
    status: input.status ?? "queued",
    priority: input.priority ?? "normal",
    requestedBy: input.requestedBy ?? "direct_ui",
    inputJson: input.inputJson ?? {},
    inputBlobIds: input.inputBlobIds ?? [],
    outputBlobIds: [],
    leaseId: normalizeOptionalString(input.leaseId),
    approvalId: normalizeOptionalString(input.approvalId),
    timeoutMs,
    deadlineAt,
    retryCount: 0,
    maxRetries: normalizePositiveInteger(input.maxRetries, 0),
    createdAt: now,
    updatedAt: now
  };
  database
    .prepare(
      `INSERT INTO capability_jobs (
        id, transaction_id, session_id, kind, status, priority, requested_by,
        input_json, input_blob_ids_json, output_blob_ids_json, lease_id, approval_id,
        timeout_ms, deadline_at, retry_count, max_retries, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      job.id,
      job.transactionId,
      job.sessionId ?? null,
      job.kind,
      job.status,
      job.priority,
      job.requestedBy,
      stringifyJson(job.inputJson ?? {}),
      stringifyJson(job.inputBlobIds),
      stringifyJson(job.outputBlobIds),
      job.leaseId ?? null,
      job.approvalId ?? null,
      job.timeoutMs,
      job.deadlineAt,
      job.retryCount,
      job.maxRetries,
      job.createdAt,
      job.updatedAt
    );
  appendCapabilityJobEvent(database, {
    jobId: job.id,
    transactionId: job.transactionId,
    phase: "queued",
    status: job.status,
    summary: `Capability job queued: ${job.kind}`,
    createdAt: now
  });
  return job;
}

export function readCapabilityJob(database: NodeDatabaseSync, id: string): CapabilityJobSummary | null {
  const row = database.prepare("SELECT * FROM capability_jobs WHERE id = ?").get(id) as CapabilityJobRow | undefined;
  return row ? mapJobRow(row) : null;
}

export function listCapabilityJobs(database: NodeDatabaseSync, input: {
  sessionId?: string;
  statuses?: CapabilityJobStatus[];
  limit?: number;
} = {}): CapabilityJobSummary[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (input.sessionId) {
    clauses.push("session_id = ?");
    values.push(input.sessionId);
  }
  if (input.statuses?.length) {
    clauses.push(`status IN (${input.statuses.map(() => "?").join(", ")})`);
    values.push(...input.statuses);
  }
  const limit = normalizePositiveInteger(input.limit, 100);
  values.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database
    .prepare(`SELECT * FROM capability_jobs ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as CapabilityJobRow[];
  return rows.map(mapJobRow);
}

export function updateCapabilityJob(database: NodeDatabaseSync, input: CapabilityJobUpdateInput): CapabilityJobSummary {
  const current = readCapabilityJob(database, input.id);
  if (!current) {
    throw new Error(`Capability job not found: ${input.id}`);
  }
  const updated: CapabilityJobSummary = {
    ...current,
    status: input.status ?? current.status,
    outputJson: input.outputJson === undefined ? current.outputJson : input.outputJson,
    outputBlobIds: input.outputBlobIds ?? current.outputBlobIds,
    leaseId: input.leaseId === undefined ? current.leaseId : input.leaseId ?? undefined,
    approvalId: input.approvalId === undefined ? current.approvalId : input.approvalId ?? undefined,
    retryCount: input.retryCount ?? current.retryCount,
    startedAt: input.startedAt === undefined ? current.startedAt : input.startedAt ?? undefined,
    completedAt: input.completedAt === undefined ? current.completedAt : input.completedAt ?? undefined,
    cancelledAt: input.cancelledAt === undefined ? current.cancelledAt : input.cancelledAt ?? undefined,
    lastError: input.lastError === undefined ? current.lastError : input.lastError ?? undefined,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
  database
    .prepare(
      `UPDATE capability_jobs
       SET status = ?, output_json = ?, output_blob_ids_json = ?, lease_id = ?,
           approval_id = ?, retry_count = ?, started_at = ?, completed_at = ?,
           cancelled_at = ?, last_error = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.status,
      updated.outputJson === undefined ? null : stringifyJson(updated.outputJson),
      stringifyJson(updated.outputBlobIds),
      updated.leaseId ?? null,
      updated.approvalId ?? null,
      updated.retryCount,
      updated.startedAt ?? null,
      updated.completedAt ?? null,
      updated.cancelledAt ?? null,
      updated.lastError ?? null,
      updated.updatedAt,
      updated.id
    );
  return updated;
}

export function appendCapabilityJobEvent(database: NodeDatabaseSync, input: CapabilityJobEventInput): void {
  database
    .prepare(
      `INSERT INTO capability_job_events (id, job_id, transaction_id, phase, status, summary, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id?.trim() || `capability-event-${randomUUID()}`,
      input.jobId,
      input.transactionId,
      input.phase,
      input.status,
      input.summary,
      stringifyJson(input.detail ?? {}),
      input.createdAt ?? new Date().toISOString()
    );
}

export function createCapabilityResource(database: NodeDatabaseSync, input: CapabilityResourceCreateInput): CapabilityResourceSummary {
  const resource: CapabilityResourceSummary = {
    id: input.id?.trim() || `capability-resource-${randomUUID()}`,
    jobId: input.jobId,
    transactionId: input.transactionId,
    blobId: input.blobId ?? undefined,
    role: input.role,
    mime: input.mime ?? "application/octet-stream",
    size: normalizePositiveInteger(input.size, 0),
    retention: input.retention ?? "ephemeral",
    preview: input.preview,
    redaction: input.redaction ?? {},
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  database
    .prepare(
      `INSERT INTO capability_resources (
        id, job_id, transaction_id, blob_id, role, mime, size, retention,
        preview_json, redaction_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      resource.id,
      resource.jobId,
      resource.transactionId,
      resource.blobId ?? null,
      resource.role,
      resource.mime,
      resource.size,
      resource.retention,
      resource.preview === undefined ? null : stringifyJson(resource.preview),
      stringifyJson(resource.redaction ?? {}),
      resource.createdAt
    );
  return resource;
}

export function listCapabilityResources(database: NodeDatabaseSync, jobId: string): CapabilityResourceSummary[] {
  const rows = database
    .prepare("SELECT * FROM capability_resources WHERE job_id = ? ORDER BY created_at ASC")
    .all(jobId) as CapabilityResourceRow[];
  return rows.map(mapResourceRow);
}

export function acquireCapabilityLock(database: NodeDatabaseSync, input: CapabilityLockAcquireInput): CapabilityLockSummary | null {
  const now = input.acquiredAt ?? new Date().toISOString();
  cleanupExpiredCapabilityLocks(database, now);
  const existing = database
    .prepare("SELECT * FROM capability_locks WHERE lock_key = ?")
    .get(input.lockKey) as CapabilityLockRow | undefined;
  if (existing && existing.job_id !== input.jobId) {
    return null;
  }
  const lock: CapabilityLockSummary = {
    id: existing?.id ?? input.id?.trim() ?? `capability-lock-${randomUUID()}`,
    jobId: input.jobId,
    lockKey: input.lockKey,
    kind: input.kind,
    acquiredAt: existing?.acquired_at ?? now,
    expiresAt: input.expiresAt
  };
  database
    .prepare(
      `INSERT INTO capability_locks (id, job_id, lock_key, kind, acquired_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(lock_key) DO UPDATE SET
         job_id = excluded.job_id,
         kind = excluded.kind,
         expires_at = excluded.expires_at`
    )
    .run(lock.id, lock.jobId ?? null, lock.lockKey, lock.kind, lock.acquiredAt, lock.expiresAt);
  return lock;
}

export function releaseCapabilityLock(database: NodeDatabaseSync, input: { jobId?: string; lockKey?: string }): number {
  if (input.jobId) {
    const result = database.prepare("DELETE FROM capability_locks WHERE job_id = ?").run(input.jobId);
    return Number(result.changes ?? 0);
  }
  if (input.lockKey) {
    const result = database.prepare("DELETE FROM capability_locks WHERE lock_key = ?").run(input.lockKey);
    return Number(result.changes ?? 0);
  }
  return 0;
}

export function listCapabilityLocks(database: NodeDatabaseSync, input: { jobId?: string; lockKey?: string } = {}): CapabilityLockSummary[] {
  cleanupExpiredCapabilityLocks(database);
  const clauses: string[] = [];
  const values: string[] = [];
  if (input.jobId) {
    clauses.push("job_id = ?");
    values.push(input.jobId);
  }
  if (input.lockKey) {
    clauses.push("lock_key = ?");
    values.push(input.lockKey);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database
    .prepare(`SELECT * FROM capability_locks ${where} ORDER BY acquired_at DESC`)
    .all(...values) as CapabilityLockRow[];
  return rows.map(mapLockRow);
}

export function reconcileCapabilityJobsOnStartup(database: NodeDatabaseSync, now = new Date()): CapabilityJobSummary[] {
  const nowIso = now.toISOString();
  const rows = database
    .prepare(
      `SELECT * FROM capability_jobs
       WHERE status IN ('queued', 'scheduled', 'awaiting_approval', 'running', 'cancelling')`
    )
    .all() as CapabilityJobRow[];
  const reconciled: CapabilityJobSummary[] = [];
  for (const row of rows) {
    const job = mapJobRow(row);
    const expired = Date.parse(job.deadlineAt) <= now.getTime();
    const status: CapabilityJobStatus = expired
      ? "expired"
      : job.status === "running" || job.status === "cancelling"
        ? "failed"
        : job.status;
    if (status === job.status) {
      continue;
    }
    const updated = updateCapabilityJob(database, {
      id: job.id,
      status,
      completedAt: nowIso,
      lastError: expired ? "Capability job expired while daemon was offline." : "Capability job was interrupted by daemon restart.",
      updatedAt: nowIso
    });
    appendCapabilityJobEvent(database, {
      jobId: job.id,
      transactionId: job.transactionId,
      phase: expired ? "expired" : "failed",
      status,
      summary: expired ? "Capability job expired during daemon startup reconciliation." : "Capability job failed closed during daemon startup reconciliation.",
      detail: { previousStatus: job.status },
      createdAt: nowIso
    });
    reconciled.push(updated);
  }
  return reconciled;
}

export function markActiveCapabilityJobsForShutdown(database: NodeDatabaseSync, now = new Date()): CapabilityJobSummary[] {
  const nowIso = now.toISOString();
  const rows = database
    .prepare(
      `SELECT * FROM capability_jobs
       WHERE status IN ('queued', 'scheduled', 'awaiting_approval', 'running', 'cancelling')`
    )
    .all() as CapabilityJobRow[];
  const marked: CapabilityJobSummary[] = [];
  for (const row of rows) {
    const job = mapJobRow(row);
    const updated = updateCapabilityJob(database, {
      id: job.id,
      status: "cancelled",
      cancelledAt: nowIso,
      completedAt: nowIso,
      lastError: "daemon_shutdown",
      updatedAt: nowIso
    });
    appendCapabilityJobEvent(database, {
      jobId: job.id,
      transactionId: job.transactionId,
      phase: "cancelled",
      status: "cancelled",
      summary: "Capability job cancelled by daemon shutdown.",
      detail: { previousStatus: job.status },
      createdAt: nowIso
    });
    marked.push(updated);
  }
  database.prepare("DELETE FROM capability_locks").run();
  return marked;
}

function mapJobRow(row: CapabilityJobRow): CapabilityJobSummary {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    sessionId: row.session_id ?? undefined,
    kind: row.kind as CapabilityJobKind,
    status: row.status as CapabilityJobStatus,
    priority: row.priority as CapabilityJobPriority,
    requestedBy: row.requested_by as CapabilityJobRequestedBy,
    inputJson: parseJson(row.input_json, {}),
    inputBlobIds: parseStringArray(row.input_blob_ids_json),
    outputJson: row.output_json ? parseJson(row.output_json, undefined) : undefined,
    outputBlobIds: parseStringArray(row.output_blob_ids_json),
    leaseId: row.lease_id ?? undefined,
    approvalId: row.approval_id ?? undefined,
    timeoutMs: Number(row.timeout_ms),
    deadlineAt: row.deadline_at,
    retryCount: Number(row.retry_count),
    maxRetries: Number(row.max_retries),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    lastError: row.last_error ?? undefined
  };
}

function mapResourceRow(row: CapabilityResourceRow): CapabilityResourceSummary {
  return {
    id: row.id,
    jobId: row.job_id,
    transactionId: row.transaction_id,
    blobId: row.blob_id ?? undefined,
    role: row.role,
    mime: row.mime,
    size: Number(row.size),
    retention: row.retention as CapabilityResourceRetention,
    preview: row.preview_json ? parseJson(row.preview_json, undefined) : undefined,
    redaction: parseJson(row.redaction_json, {}),
    createdAt: row.created_at
  };
}

function mapLockRow(row: CapabilityLockRow): CapabilityLockSummary {
  return {
    id: row.id,
    jobId: row.job_id ?? undefined,
    lockKey: row.lock_key,
    kind: row.kind as CapabilityJobKind,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at
  };
}

function cleanupExpiredCapabilityLocks(database: NodeDatabaseSync, now = new Date().toISOString()): void {
  database.prepare("DELETE FROM capability_locks WHERE expires_at <= ?").run(now);
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}
