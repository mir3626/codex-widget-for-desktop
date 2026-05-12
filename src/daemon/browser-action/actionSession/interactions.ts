import { randomUUID } from "node:crypto";
import { createBrowserQueuedCommand } from "../actionExecutor.js";
import {
  describeBrowserActionRouting,
  resolveBrowserActionExecutionAdapter
} from "../actionRouting.js";
import { createTimelineEvent } from "../actionTimeline.js";
import type { BrowserActionAdapterRegistry } from "../adapterRegistry.js";
import type {
  BrowserActionApproval,
  BrowserActionResult,
  BrowserActionSession,
  BrowserQueuedCommand
} from "../types.js";
import type { RuntimeInteractionDecision } from "../../../shared/protocol.js";
import { executeViaAdapter } from "./adapterExecution.js";
import { cloneResult } from "./cloning.js";
import {
  readActionTimeoutMs,
  readExpectedSourceForCommand,
  readExtensionCommandPickupTimeoutMs
} from "./helpers.js";

export async function respondToBrowserActionInteraction(input: {
  id: string;
  decision: RuntimeInteractionDecision;
  pendingApprovals: Map<string, BrowserActionApproval>;
  results: Map<string, BrowserActionResult>;
  pendingCommands: BrowserQueuedCommand[];
  commandResultIds: Map<string, string>;
  adapters: BrowserActionAdapterRegistry;
  requireSession: (id: string) => BrowserActionSession;
}): Promise<{
  handled: boolean;
  approved?: boolean;
  approval?: BrowserActionApproval;
  result?: BrowserActionResult;
  command?: BrowserQueuedCommand;
}> {
  const approval = input.pendingApprovals.get(input.id);
  if (!approval) {
    return { handled: false };
  }
  input.pendingApprovals.delete(input.id);
  approval.decision = input.decision;
  const session = input.requireSession(approval.actionSessionId);
  const result = input.results.get(approval.resultId);
  if (!result) {
    return { handled: true, approved: false, approval };
  }
  if (input.decision !== "approve" && input.decision !== "always_allow") {
    result.status = "cancelled";
    result.completedAt = new Date().toISOString();
    result.error = "User declined the browser action.";
    result.verification = { status: "failed", reason: result.error };
    session.timeline.push(createTimelineEvent({
      startedAt: session.startedAt,
      type: "result",
      summary: "Browser action declined",
      detail: { resultId: result.id }
    }));
    return { handled: true, approved: false, approval, result: cloneResult(result) };
  }
  const effectiveAdapterId = resolveBrowserActionExecutionAdapter({
    action: approval.action,
    requestedAdapterId: approval.adapterId
  });
  const routing = describeBrowserActionRouting({
    action: approval.action,
    requestedAdapterId: approval.adapterId,
    effectiveAdapterId
  });
  result.adapterId = effectiveAdapterId;
  result.safety.metadata = {
    ...(result.safety.metadata ?? {}),
    browserActionRouting: routing
  };
  if (effectiveAdapterId && effectiveAdapterId !== "extension") {
    const direct = await executeViaAdapter({
      adapters: input.adapters,
      adapterId: effectiveAdapterId,
      session,
      result,
      observation: result.before
    });
    return { handled: true, approved: true, approval, result: direct.result };
  }
  const command = createBrowserQueuedCommand({
    requestId: `browser-command-${randomUUID()}`,
    actionSessionId: session.id,
    resultId: result.id,
    adapterId: effectiveAdapterId ?? "extension",
    action: approval.action,
    target: approval.target,
    expectedSource: readExpectedSourceForCommand(session, result.before),
    metadata: {
      routing
    },
    timeoutMs: readActionTimeoutMs(approval.action),
    expiresInMs: readExtensionCommandPickupTimeoutMs()
  });
  input.commandResultIds.set(command.requestId, result.id);
  result.status = "pending";
  result.completedAt = undefined;
  result.verification = {
    status: "unknown",
    reason: "Approved action is waiting for the browser extension."
  };
  input.pendingCommands.push(command);
  session.timeline.push(createTimelineEvent({
    startedAt: session.startedAt,
    type: "execute",
    summary: `Approved browser action queued: ${approval.action.type}`,
    detail: { requestId: command.requestId }
  }));
  return { handled: true, approved: true, approval, result: cloneResult(result), command };
}
