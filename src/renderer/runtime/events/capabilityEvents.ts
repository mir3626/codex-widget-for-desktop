import type { CapabilityJobSummary, ServerEvent } from "../../../shared/protocol.js";
import type { CapabilityJobLogEntry, CapabilityJobResourcePreview } from "../../types";
import type { WidgetServerEventDeps } from "../serverEventTypes";

export function handleCapabilityServerEvent(event: ServerEvent, deps: WidgetServerEventDeps): boolean {
  if (event.type === "capability.jobs") {
    deps.setCapabilityJobs((current) => ({
      ...current,
      jobs: mergeJobs(current.jobs, event.jobs),
      lastUpdatedAt: new Date().toISOString()
    }));
    return true;
  }

  if (event.type === "capability.job") {
    const now = new Date().toISOString();
    const entry: CapabilityJobLogEntry = {
      id: createLocalId("capability-event"),
      jobId: event.jobId,
      transactionId: event.transactionId,
      kind: event.kind,
      status: event.status,
      phase: event.phase,
      summary: event.summary,
      detail: event.detail,
      createdAt: now
    };
    deps.setCapabilityJobs((current) => ({
      ...current,
      jobs: mergeJobs(current.jobs, [applyEventToJob(current.jobs.find((job) => job.id === event.jobId), event, now)]),
      eventsByJobId: {
        ...current.eventsByJobId,
        [event.jobId]: [entry, ...(current.eventsByJobId[event.jobId] ?? [])].slice(0, 40)
      },
      lastUpdatedAt: now
    }));
    return true;
  }

  if (event.type === "capability.resource") {
    const now = new Date().toISOString();
    const resource: CapabilityJobResourcePreview = {
      id: createLocalId("capability-resource"),
      jobId: event.jobId,
      transactionId: event.transactionId,
      resourceId: event.resourceId,
      role: event.role,
      mime: event.mime,
      preview: event.preview,
      createdAt: now
    };
    deps.setCapabilityJobs((current) => ({
      ...current,
      resourcesByJobId: {
        ...current.resourcesByJobId,
        [event.jobId]: [resource, ...(current.resourcesByJobId[event.jobId] ?? [])].slice(0, 20)
      },
      lastUpdatedAt: now
    }));
    return true;
  }

  return false;
}

function mergeJobs(current: CapabilityJobSummary[], incoming: CapabilityJobSummary[]): CapabilityJobSummary[] {
  const byId = new Map<string, CapabilityJobSummary>();
  for (const job of current) {
    byId.set(job.id, job);
  }
  for (const job of incoming) {
    byId.set(job.id, { ...byId.get(job.id), ...job });
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
    .slice(0, 100);
}

function applyEventToJob(
  current: CapabilityJobSummary | undefined,
  event: Extract<ServerEvent, { type: "capability.job" }>,
  now: string
): CapabilityJobSummary {
  const next: CapabilityJobSummary = current ?? {
    id: event.jobId,
    transactionId: event.transactionId,
    kind: event.kind,
    status: event.status,
    priority: "normal",
    requestedBy: "direct_ui",
    inputBlobIds: [],
    outputBlobIds: [],
    timeoutMs: 0,
    deadlineAt: "",
    retryCount: 0,
    maxRetries: 0,
    createdAt: now,
    updatedAt: now
  };
  return {
    ...next,
    transactionId: event.transactionId,
    kind: event.kind,
    status: event.status,
    updatedAt: now,
    startedAt: event.status === "running" && !next.startedAt ? now : next.startedAt,
    completedAt: event.status === "completed" ? now : next.completedAt,
    cancelledAt: event.status === "cancelled" ? now : next.cancelledAt,
    lastError: event.status === "failed" || event.status === "cancelled" || event.status === "expired" ? event.summary : next.lastError
  };
}

function createLocalId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
