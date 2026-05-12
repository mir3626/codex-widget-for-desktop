import type { CapabilityJobSummary, CapabilityLockSummary, CapabilityResourceSummary } from "../../shared/protocol.js";

export type CapabilityDiagnosticsSummary = {
  jobId: string;
  transactionId: string;
  kind: string;
  status: string;
  timing: {
    queuedMs?: number;
    runningMs?: number;
    totalMs: number;
  };
  resources: Array<{
    id: string;
    role: string;
    mime: string;
    size: number;
    retention: string;
  }>;
  locks: Array<{
    id: string;
    lockKey: string;
    expiresAt: string;
  }>;
  lastError?: string;
};

export function summarizeCapabilityDiagnostics(
  job: CapabilityJobSummary,
  resources: CapabilityResourceSummary[] = [],
  locks: CapabilityLockSummary[] = []
): CapabilityDiagnosticsSummary {
  const createdAt = Date.parse(job.createdAt);
  const startedAt = job.startedAt ? Date.parse(job.startedAt) : undefined;
  const completedAt = job.completedAt ? Date.parse(job.completedAt) : Date.parse(job.updatedAt);
  return {
    jobId: job.id,
    transactionId: job.transactionId,
    kind: job.kind,
    status: job.status,
    timing: {
      queuedMs: startedAt && Number.isFinite(createdAt) ? Math.max(0, startedAt - createdAt) : undefined,
      runningMs: startedAt && Number.isFinite(completedAt) ? Math.max(0, completedAt - startedAt) : undefined,
      totalMs: Number.isFinite(createdAt) && Number.isFinite(completedAt) ? Math.max(0, completedAt - createdAt) : 0
    },
    resources: resources.map((resource) => ({
      id: resource.id,
      role: resource.role,
      mime: resource.mime,
      size: resource.size,
      retention: resource.retention
    })),
    locks: locks.map((lock) => ({
      id: lock.id,
      lockKey: lock.lockKey,
      expiresAt: lock.expiresAt
    })),
    lastError: job.lastError
  };
}
