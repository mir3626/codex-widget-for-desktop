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

export function pollBrowserExtensionCommand(input: {
  pendingCommands: BrowserQueuedCommand[];
  results: Map<string, BrowserActionResult>;
  sessions: Map<string, BrowserActionSession>;
  commandResultIds: Map<string, string>;
}): BrowserQueuedCommand | undefined {
  const now = Date.now();
  while (true) {
    const command = input.pendingCommands.shift();
    if (!command) {
      return undefined;
    }
    if (command.expiresAt && Date.parse(command.expiresAt) <= now) {
      failQueuedBrowserCommand({
        command,
        error: "Browser Action command timed out before the extension picked it up.",
        results: input.results,
        sessions: input.sessions,
        commandResultIds: input.commandResultIds
      });
      continue;
    }
    return command;
  }
}

export function completeBrowserExtensionCommand(input: {
  execution: BrowserActionExecutionResult;
  commandResultIds: Map<string, string>;
  results: Map<string, BrowserActionResult>;
  requireSession: (id: string) => BrowserActionSession;
}): { session: BrowserActionSession; result: BrowserActionResult; audit: BrowserActionAuditEntry } {
  const commandResultId = input.commandResultIds.get(input.execution.requestId);
  const commandResult = commandResultId ? input.results.get(commandResultId) : undefined;
  if (!commandResult) {
    throw new Error(`Browser action result not found for request: ${input.execution.requestId}`);
  }
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
  if (after) {
    session.latestObservation = after;
    session.source = { ...session.source, url: after.url, title: after.title };
  }
  session.timeline.push(createTimelineEvent({
    startedAt: session.startedAt,
    type: "result",
    summary: `Browser action ${commandResult.status}: ${commandResult.action.type}`,
    detail: { requestId: input.execution.requestId, verification: commandResult.verification }
  }));
  return {
    session: cloneSession(session),
    result: cloneResult(commandResult),
    audit: auditActionResult(session, commandResult)
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
}): void {
  const result = input.results.get(input.command.resultId);
  if (!result) {
    return;
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
}
