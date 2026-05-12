import { buildBrowserObservation } from "../browserObservation.js";
import { createTimelineEvent } from "../actionTimeline.js";
import { auditActionResult } from "../auditLog.js";
import { verifyBrowserAction } from "../resultVerifier.js";
import type {
  BrowserActionApproval,
  BrowserActionAuditEntry,
  BrowserActionExecutionResult,
  BrowserActionResult,
  BrowserActionSession,
  BrowserQueuedCommand
} from "../types.js";
import { cloneResult, cloneSession } from "./cloning.js";

const COMMAND_REDELIVERY_WAIT_MS = 750;

export function pollBrowserExtensionCommand(input: {
  pendingCommands: BrowserQueuedCommand[];
  results: Map<string, BrowserActionResult>;
  sessions: Map<string, BrowserActionSession>;
  commandResultIds: Map<string, string>;
}): BrowserQueuedCommand | undefined {
  const now = Date.now();
  for (let index = 0; index < input.pendingCommands.length; index += 1) {
    const command = input.pendingCommands[index];
    if (command.expiresAt && Date.parse(command.expiresAt) <= now) {
      failQueuedBrowserCommand({
        command,
        error: "Browser Action command timed out before the extension picked it up.",
        results: input.results,
        sessions: input.sessions,
        commandResultIds: input.commandResultIds
      });
      input.pendingCommands.splice(index, 1);
      index -= 1;
      continue;
    }
    if (command.acknowledgedAt) {
      continue;
    }
    const deliveredAt = command.deliveredAt ? Date.parse(command.deliveredAt) : 0;
    if (deliveredAt && now - deliveredAt < COMMAND_REDELIVERY_WAIT_MS) {
      continue;
    }
    command.deliveredAt = new Date(now).toISOString();
    command.deliveryAttempts = (command.deliveryAttempts ?? 0) + 1;
    return command;
  }
  return undefined;
}

export function acknowledgeBrowserExtensionCommand(input: {
  requestId: string;
  pendingCommands: BrowserQueuedCommand[];
  results: Map<string, BrowserActionResult>;
  sessions: Map<string, BrowserActionSession>;
  commandResultIds: Map<string, string>;
}): BrowserActionResult | undefined {
  const command = input.pendingCommands.find((item) => item.requestId === input.requestId);
  const resultId = input.commandResultIds.get(input.requestId);
  const result = resultId ? input.results.get(resultId) : undefined;
  if (!command || !result) {
    return undefined;
  }
  command.acknowledgedAt = new Date().toISOString();
  const session = input.sessions.get(command.actionSessionId);
  if (session) {
    const createdAt = Date.parse(command.createdAt);
    const deliveredAt = command.deliveredAt ? Date.parse(command.deliveredAt) : undefined;
    const acknowledgedAt = Date.now();
    session.timeline.push(createTimelineEvent({
      startedAt: session.startedAt,
      type: "execute",
      summary: `Browser action picked up by extension: ${command.action.type}`,
      detail: {
        requestId: input.requestId,
        resultId: result.id,
        deliveryAttempts: command.deliveryAttempts ?? 1,
        latency: {
          queuedToDeliveryMs: deliveredAt && Number.isFinite(createdAt) ? Math.max(0, deliveredAt - createdAt) : undefined,
          deliveryToAckMs: deliveredAt ? Math.max(0, acknowledgedAt - deliveredAt) : undefined,
          queuedToAckMs: Number.isFinite(createdAt) ? Math.max(0, acknowledgedAt - createdAt) : undefined
        }
      }
    }));
  }
  return cloneResult(result);
}

export function failPendingBrowserExtensionCommand(input: {
  requestId: string;
  error: string;
  pendingCommands: BrowserQueuedCommand[];
  results: Map<string, BrowserActionResult>;
  sessions: Map<string, BrowserActionSession>;
  commandResultIds: Map<string, string>;
}): BrowserActionResult | undefined {
  const index = input.pendingCommands.findIndex((command) => command.requestId === input.requestId);
  const command = index >= 0 ? input.pendingCommands.splice(index, 1)[0] : undefined;
  if (command) {
    return failQueuedBrowserCommand({
      command,
      error: input.error,
      results: input.results,
      sessions: input.sessions,
      commandResultIds: input.commandResultIds
    });
  }
  const resultId = input.commandResultIds.get(input.requestId);
  const result = resultId ? input.results.get(resultId) : undefined;
  if (!result || result.status !== "pending") {
    return undefined;
  }
  const session = input.sessions.get(result.actionSessionId);
  result.status = "failed";
  result.completedAt = new Date().toISOString();
  result.error = input.error;
  result.verification = { status: "failed", reason: input.error };
  input.commandResultIds.delete(input.requestId);
  if (session) {
    session.timeline.push(createTimelineEvent({
      startedAt: session.startedAt,
      type: "error",
      summary: input.error,
      detail: { requestId: input.requestId, resultId: result.id }
    }));
  }
  return cloneResult(result);
}

export function completeBrowserExtensionCommand(input: {
  execution: BrowserActionExecutionResult;
  pendingCommands: BrowserQueuedCommand[];
  commandResultIds: Map<string, string>;
  results: Map<string, BrowserActionResult>;
  requireSession: (id: string) => BrowserActionSession;
}): { session: BrowserActionSession; result: BrowserActionResult; audit: BrowserActionAuditEntry } {
  const commandResultId = input.commandResultIds.get(input.execution.requestId);
  const commandResult = commandResultId ? input.results.get(commandResultId) : undefined;
  if (!commandResult) {
    throw new Error(`Browser action result not found for request: ${input.execution.requestId}`);
  }
  const commandIndex = input.pendingCommands.findIndex((command) => command.requestId === input.execution.requestId);
  const command = commandIndex >= 0 ? input.pendingCommands.splice(commandIndex, 1)[0] : undefined;
  input.commandResultIds.delete(input.execution.requestId);
  const session = input.requireSession(commandResult.actionSessionId);
  const after = input.execution.after
    ? buildBrowserObservation({ source: session.source, snapshot: input.execution.after })
    : commandResult.before;
  commandResult.after = after;
  commandResult.status = input.execution.ok ? "succeeded" : "failed";
  commandResult.completedAt = new Date().toISOString();
  commandResult.error = input.execution.error;
  commandResult.verification = verifyBrowserAction({
    action: commandResult.action,
    expected: commandResult.expected,
    before: commandResult.before,
    after,
    ok: input.execution.ok,
    error: input.execution.error
  });
  commandResult.safety.metadata = {
    ...(commandResult.safety.metadata ?? {}),
    bridgeExecution: {
      requestId: input.execution.requestId,
      adapterId: input.execution.adapterId,
      metadata: input.execution.metadata,
      latency: summarizeExtensionCommandLatency(command, input.execution)
    }
  };
  if (after) {
    session.latestObservation = after;
    session.source = { ...session.source, url: after.url, title: after.title };
  }
  session.timeline.push(createTimelineEvent({
    startedAt: session.startedAt,
    type: "result",
    summary: `Browser action ${commandResult.status}: ${commandResult.action.type}`,
    detail: {
      requestId: input.execution.requestId,
      verification: commandResult.verification,
      latency: commandResult.safety.metadata.bridgeExecution
    }
  }));
  return {
    session: cloneSession(session),
    result: cloneResult(commandResult),
    audit: auditActionResult(session, commandResult)
  };
}

function summarizeExtensionCommandLatency(command: BrowserQueuedCommand | undefined, execution: BrowserActionExecutionResult): Record<string, unknown> {
  const now = Date.now();
  const createdAt = command?.createdAt ? Date.parse(command.createdAt) : undefined;
  const deliveredAt = command?.deliveredAt ? Date.parse(command.deliveredAt) : undefined;
  const acknowledgedAt = command?.acknowledgedAt ? Date.parse(command.acknowledgedAt) : undefined;
  return {
    queuedToDeliveryMs: createdAt && deliveredAt ? Math.max(0, deliveredAt - createdAt) : undefined,
    deliveryToAckMs: deliveredAt && acknowledgedAt ? Math.max(0, acknowledgedAt - deliveredAt) : undefined,
    ackToResultMs: acknowledgedAt ? Math.max(0, now - acknowledgedAt) : undefined,
    queuedToResultMs: createdAt ? Math.max(0, now - createdAt) : undefined,
    bridgeTrace: execution.metadata?.latencyTrace
  };
}

export function cancelBrowserActionSession(input: {
  session: BrowserActionSession;
  pendingCommands: BrowserQueuedCommand[];
  commandResultIds: Map<string, string>;
  pendingApprovals: Map<string, BrowserActionApproval>;
  results: Map<string, BrowserActionResult>;
}): BrowserActionSession {
  input.session.status = "cancelled";
  input.session.stoppedAt = new Date().toISOString();
  input.session.timeline.push(createTimelineEvent({
    startedAt: input.session.startedAt,
    type: "cancel",
    summary: "Browser Action session cancelled"
  }));
  const remaining = input.pendingCommands.filter((command) => command.actionSessionId !== input.session.id);
  input.pendingCommands.splice(0, input.pendingCommands.length, ...remaining);
  for (const [requestId, resultId] of input.commandResultIds.entries()) {
    const result = input.results.get(resultId);
    if (result?.actionSessionId === input.session.id) {
      input.commandResultIds.delete(requestId);
    }
  }
  for (const [approvalId, approval] of input.pendingApprovals.entries()) {
    if (approval.actionSessionId === input.session.id) {
      input.pendingApprovals.delete(approvalId);
    }
  }
  return cloneSession(input.session);
}

function failQueuedBrowserCommand(input: {
  command: BrowserQueuedCommand;
  error: string;
  results: Map<string, BrowserActionResult>;
  sessions: Map<string, BrowserActionSession>;
  commandResultIds: Map<string, string>;
}): BrowserActionResult | undefined {
  const result = input.results.get(input.command.resultId);
  if (!result) {
    return undefined;
  }
  const session = input.sessions.get(input.command.actionSessionId);
  result.status = "failed";
  result.completedAt = new Date().toISOString();
  result.error = input.error;
  result.verification = { status: "failed", reason: input.error };
  input.commandResultIds.delete(input.command.requestId);
  if (session) {
    session.timeline.push(createTimelineEvent({
      startedAt: session.startedAt,
      type: "error",
      summary: input.error,
      detail: { requestId: input.command.requestId, resultId: result.id }
    }));
  }
  return cloneResult(result);
}
