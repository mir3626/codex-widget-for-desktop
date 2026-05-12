import type { WebSocket } from "ws";
import type {
  CapabilityEventPhase,
  CapabilityJobStatus,
  CapabilityJobSummary
} from "../../../shared/protocol.js";
import {
  redactBrowserActionSecret,
  summarizeBrowserActionResult,
  type BrowserAction,
  type BrowserActionResult,
  type BrowserQueuedCommand
} from "../../browser-action/index.js";
import type { StorageService } from "../../storage/storage.js";
import { broadcast } from "../events.js";

export function recordBrowserActionCapabilityApproval(input: {
  storage: StorageService;
  clients: Set<WebSocket>;
  requestId: string;
  actionSessionId: string;
  sessionId?: string;
  action: BrowserAction;
  result?: BrowserActionResult;
  approvalId?: string;
}): CapabilityJobSummary {
  const job = ensureBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    requestId: input.requestId,
    actionSessionId: input.actionSessionId,
    sessionId: input.sessionId,
    action: input.action,
    result: input.result,
    approvalId: input.approvalId,
    status: "awaiting_approval"
  });
  return transitionBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    job,
    status: "awaiting_approval",
    phase: "awaiting_approval",
    summary: `Browser Action awaiting approval: ${input.action.type}`,
    detail: { approvalId: input.approvalId, resultId: input.result?.id }
  });
}

export function recordBrowserActionCapabilityCommandQueued(input: {
  storage: StorageService;
  clients: Set<WebSocket>;
  command: BrowserQueuedCommand;
  sessionId?: string;
  result?: BrowserActionResult;
}): CapabilityJobSummary {
  const job = ensureBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    requestId: input.command.requestId,
    actionSessionId: input.command.actionSessionId,
    sessionId: input.sessionId,
    action: input.command.action,
    result: input.result,
    leaseId: readLeaseId(input.command, input.result),
    status: "queued",
    inputJson: {
      requestId: input.command.requestId,
      actionSessionId: input.command.actionSessionId,
      resultId: input.command.resultId,
      adapterId: input.command.adapterId,
      action: input.command.action,
      target: input.command.target,
      expectedSource: input.command.expectedSource,
      metadata: input.command.metadata
    }
  });
  emitCapabilityJob(input.storage, input.clients, job, "queued", `Browser Action queued: ${input.command.action.type}`, {
    requestId: input.command.requestId,
    resultId: input.command.resultId,
    adapterId: input.command.adapterId
  });
  return job;
}

export function recordBrowserActionCapabilityAcknowledged(input: {
  storage: StorageService;
  clients: Set<WebSocket>;
  requestId: string;
  result: BrowserActionResult;
}): CapabilityJobSummary {
  const job = ensureBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    requestId: input.requestId,
    actionSessionId: input.result.actionSessionId,
    action: input.result.action,
    result: input.result,
    status: "queued"
  });
  return transitionBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    job,
    status: "running",
    phase: "executing",
    summary: `Browser Action picked up by extension: ${input.result.action.type}`,
    detail: { requestId: input.requestId, resultId: input.result.id }
  });
}

export function recordBrowserActionCapabilityResult(input: {
  storage: StorageService;
  clients: Set<WebSocket>;
  result: BrowserActionResult;
  requestId?: string;
  sessionId?: string;
}): CapabilityJobSummary {
  const requestId = input.requestId?.trim() || input.result.id;
  const job = ensureBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    requestId,
    actionSessionId: input.result.actionSessionId,
    sessionId: input.sessionId,
    action: input.result.action,
    result: input.result,
    leaseId: input.result.transaction?.leaseId,
    status: "running"
  });
  const status = mapBrowserActionResultStatus(input.result.status);
  return transitionBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    job,
    status,
    phase: mapCapabilityPhase(status),
    summary: `Browser Action ${input.result.status}: ${input.result.action.type}`,
    detail: {
      requestId,
      resultId: input.result.id,
      verification: input.result.verification,
      transaction: input.result.transaction
    },
    outputJson: summarizeBrowserActionResult(input.result),
    lastError: input.result.error ?? (status === "failed" ? input.result.verification.reason : undefined)
  });
}

export function recordBrowserActionCapabilityObserve(input: {
  storage: StorageService;
  clients: Set<WebSocket>;
  requestId: string;
  actionSessionId: string;
  sessionId?: string;
  outputJson: unknown;
}): CapabilityJobSummary {
  const job = ensureBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    requestId: input.requestId,
    actionSessionId: input.actionSessionId,
    sessionId: input.sessionId,
    action: { type: "read", reason: "observe" },
    status: "running"
  });
  return transitionBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    job,
    status: "completed",
    phase: "completed",
    summary: "Browser Action observe completed.",
    outputJson: input.outputJson
  });
}

export function recordBrowserActionCapabilityFailure(input: {
  storage: StorageService;
  clients: Set<WebSocket>;
  requestId: string;
  actionSessionId: string;
  action?: BrowserAction;
  error: string;
}): CapabilityJobSummary {
  const job = ensureBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    requestId: input.requestId,
    actionSessionId: input.actionSessionId,
    action: input.action ?? { type: "read", reason: "failed" },
    status: "running"
  });
  return transitionBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    job,
    status: "failed",
    phase: "failed",
    summary: input.error,
    lastError: input.error
  });
}

function ensureBrowserActionCapabilityJob(input: {
  storage: StorageService;
  clients: Set<WebSocket>;
  requestId: string;
  actionSessionId: string;
  sessionId?: string;
  action: BrowserAction;
  result?: BrowserActionResult;
  leaseId?: string;
  approvalId?: string;
  status: CapabilityJobStatus;
  inputJson?: unknown;
}): CapabilityJobSummary {
  const jobId = browserActionCapabilityJobId(input.requestId);
  const existing = input.storage.readCapabilityJob(jobId);
  if (existing) {
    return existing;
  }
  const job = input.storage.createCapabilityJob({
    id: jobId,
    transactionId: input.result?.transaction?.transactionId ?? `browser-action:${input.requestId}`,
    sessionId: input.sessionId,
    kind: "browser_action",
    status: "queued",
    priority: "interactive",
    requestedBy: "direct_ui",
    inputJson: redactBrowserActionSecret(input.inputJson ?? {
      requestId: input.requestId,
      actionSessionId: input.actionSessionId,
      resultId: input.result?.id,
      action: input.action,
      transaction: input.result?.transaction
    }),
    leaseId: input.leaseId ?? input.result?.transaction?.leaseId,
    approvalId: input.approvalId,
    timeoutMs: 60_000
  });
  broadcastCapabilityJob(input.clients, job, "queued", `Browser Action capability job queued: ${input.action.type}`);
  return input.status === "queued" ? job : transitionBrowserActionCapabilityJob({
    storage: input.storage,
    clients: input.clients,
    job,
    status: input.status,
    phase: mapCapabilityPhase(input.status),
    summary: `Browser Action ${input.status}: ${input.action.type}`
  });
}

function transitionBrowserActionCapabilityJob(input: {
  storage: StorageService;
  clients: Set<WebSocket>;
  job: CapabilityJobSummary;
  status: CapabilityJobStatus;
  phase: CapabilityEventPhase;
  summary: string;
  detail?: unknown;
  outputJson?: unknown;
  lastError?: string;
}): CapabilityJobSummary {
  const current = input.storage.readCapabilityJob(input.job.id) ?? input.job;
  if (isFinalCapabilityStatus(current.status)) {
    return current;
  }
  const now = new Date().toISOString();
  const updated = input.storage.updateCapabilityJob({
    id: current.id,
    status: input.status,
    outputJson: input.outputJson === undefined ? current.outputJson : redactBrowserActionSecret(input.outputJson),
    startedAt: input.status === "running" && !current.startedAt ? now : current.startedAt,
    completedAt: isFinalCapabilityStatus(input.status) ? now : current.completedAt,
    cancelledAt: input.status === "cancelled" ? now : current.cancelledAt,
    lastError: input.lastError
  });
  emitCapabilityJob(input.storage, input.clients, updated, input.phase, input.summary, redactBrowserActionSecret(input.detail));
  return updated;
}

function emitCapabilityJob(
  storage: StorageService,
  clients: Set<WebSocket>,
  job: CapabilityJobSummary,
  phase: CapabilityEventPhase,
  summary: string,
  detail?: unknown
): void {
  storage.appendCapabilityJobEvent({
    jobId: job.id,
    transactionId: job.transactionId,
    phase,
    status: job.status,
    summary,
    detail
  });
  broadcastCapabilityJob(clients, job, phase, summary, detail);
}

function broadcastCapabilityJob(
  clients: Set<WebSocket>,
  job: CapabilityJobSummary,
  phase: CapabilityEventPhase,
  summary: string,
  detail?: unknown
): void {
  broadcast(clients, {
    type: "capability.job",
    jobId: job.id,
    transactionId: job.transactionId,
    kind: job.kind,
    status: job.status,
    phase,
    summary,
    detail
  });
}

function browserActionCapabilityJobId(requestId: string): string {
  return `browser-action:${requestId.trim()}`;
}

function readLeaseId(command: BrowserQueuedCommand, result: BrowserActionResult | undefined): string | undefined {
  if (result?.transaction?.leaseId) {
    return result.transaction.leaseId;
  }
  const source = command.expectedSource;
  if (!source) {
    return undefined;
  }
  return [
    "browser",
    source.windowId ?? "",
    source.tabId ?? "",
    source.routeKey ?? "",
    source.viewRevision ?? ""
  ].filter(Boolean).join(":") || undefined;
}

function mapBrowserActionResultStatus(status: BrowserActionResult["status"]): CapabilityJobStatus {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status === "needs_approval") {
    return "awaiting_approval";
  }
  if (status === "pending") {
    return "running";
  }
  return "failed";
}

function mapCapabilityPhase(status: CapabilityJobStatus): CapabilityEventPhase {
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status === "expired") {
    return "expired";
  }
  if (status === "awaiting_approval") {
    return "awaiting_approval";
  }
  if (status === "running") {
    return "executing";
  }
  return "queued";
}

function isFinalCapabilityStatus(status: CapabilityJobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "expired";
}
