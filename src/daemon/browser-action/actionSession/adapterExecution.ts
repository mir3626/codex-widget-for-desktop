import { buildBrowserObservation } from "../browserObservation.js";
import { createTimelineEvent } from "../actionTimeline.js";
import { buildElementGraph } from "../elementGraph.js";
import { auditActionResult } from "../auditLog.js";
import {
  BrowserActionAdapterRegistry,
  executeWithAdapter,
  observeWithAdapter
} from "../adapterRegistry.js";
import { resolveTarget } from "../targetResolver.js";
import { verifyBrowserAction } from "../resultVerifier.js";
import type {
  BrowserActionAuditEntry,
  BrowserActionExecutionResult,
  BrowserActionResult,
  BrowserActionSession,
  BrowserObservation
} from "../types.js";
import { cloneResult, cloneSession } from "./cloning.js";
import {
  isRetriableBrowserActionError,
  readActionTarget,
  readActionTimeoutMs
} from "./helpers.js";

export async function executeViaAdapter(input: {
  adapters: BrowserActionAdapterRegistry;
  adapterId: string;
  session: BrowserActionSession;
  result: BrowserActionResult;
  observation?: BrowserObservation;
}): Promise<{ session: BrowserActionSession; result: BrowserActionResult; audit: BrowserActionAuditEntry }> {
  const adapter = input.adapters.get(input.adapterId);
  const result = input.result;
  const observation = input.observation ?? result.before ?? input.session.latestObservation;
  if (!adapter) {
    result.status = "failed";
    result.completedAt = new Date().toISOString();
    result.error = `Browser Action adapter not found: ${input.adapterId}`;
    result.verification = { status: "failed", reason: result.error };
    input.session.timeline.push(createTimelineEvent({ startedAt: input.session.startedAt, type: "error", summary: result.error, detail: { adapterId: input.adapterId } }));
    return { session: cloneSession(input.session), result: cloneResult(result), audit: auditActionResult(input.session, result) };
  }
  if (!observation) {
    result.status = "failed";
    result.completedAt = new Date().toISOString();
    result.error = "Browser Action adapter execution requires a current observation.";
    result.verification = { status: "failed", reason: result.error };
    input.session.timeline.push(createTimelineEvent({ startedAt: input.session.startedAt, type: "error", summary: result.error, detail: { adapterId: adapter.id } }));
    return { session: cloneSession(input.session), result: cloneResult(result), audit: auditActionResult(input.session, result) };
  }

  try {
    const available = await adapter.isAvailable({ session: input.session });
    if (!available) {
      throw new Error(`${adapter.label} is unavailable for this Browser Action session.`);
    }
    input.session.timeline.push(createTimelineEvent({ startedAt: input.session.startedAt, type: "execute", summary: `Executing browser action via ${adapter.label}: ${result.action.type}`, detail: { adapterId: adapter.id, resultId: result.id } }));
    const execution = await executeWithAdapter({
      adapter,
      executeInput: {
        session: input.session,
        observation,
        action: result.action,
        target: result.target,
        timeoutMs: readActionTimeoutMs(result.action)
      },
      timeoutMs: readActionTimeoutMs(result.action)
    });
    const finalExecution = execution.ok || !isRetriableBrowserActionError(execution.error) || !readActionTarget(result.action)
      ? execution
      : await retryViaAdapterAfterReobserve({ adapterId: adapter.id, session: input.session, result, adapter, observation });
    const after = finalExecution.after ? buildBrowserObservation({ source: input.session.source, snapshot: finalExecution.after }) : observation;
    result.adapterId = execution.adapterId ?? adapter.id;
    result.after = after;
    result.status = finalExecution.ok ? "succeeded" : "failed";
    result.completedAt = new Date().toISOString();
    result.error = finalExecution.error;
    result.verification = verifyBrowserAction({
      action: result.action,
      expected: result.expected,
      before: observation,
      after,
      target: result.target,
      ok: finalExecution.ok,
      error: finalExecution.error
    });
    input.session.latestObservation = after;
    input.session.source = { ...input.session.source, url: after.url, title: after.title };
    input.session.timeline.push(createTimelineEvent({ startedAt: input.session.startedAt, type: "result", summary: `Browser action ${result.status} via ${adapter.id}: ${result.action.type}`, detail: { verification: result.verification } }));
    return { session: cloneSession(input.session), result: cloneResult(result), audit: auditActionResult(input.session, result) };
  } catch (error) {
    result.status = "failed";
    result.completedAt = new Date().toISOString();
    result.error = error instanceof Error ? error.message : "Browser adapter execution failed.";
    result.verification = { status: "failed", reason: result.error };
    input.session.timeline.push(createTimelineEvent({ startedAt: input.session.startedAt, type: "error", summary: result.error, detail: { adapterId: adapter.id } }));
    return { session: cloneSession(input.session), result: cloneResult(result), audit: auditActionResult(input.session, result) };
  }
}

async function retryViaAdapterAfterReobserve(input: {
  adapterId: string;
  session: BrowserActionSession;
  result: BrowserActionResult;
  adapter: NonNullable<ReturnType<BrowserActionAdapterRegistry["get"]>>;
  observation: BrowserObservation;
}): Promise<BrowserActionExecutionResult> {
  const refreshed = await observeWithAdapter({
    adapter: input.adapter,
    observeInput: {
      session: input.session,
      providerState: { url: input.observation.url || input.session.source.url }
    }
  });
  const graph = buildElementGraph({ observationId: refreshed.id, focusedElementId: refreshed.focusedElementId, elements: refreshed.elements });
  const resolution = resolveTarget({
    graph,
    observation: refreshed,
    action: input.result.action,
    target: readActionTarget(input.result.action),
    hint: input.result.safety.targetSummary
  });
  input.session.timeline.push(createTimelineEvent({
    startedAt: input.session.startedAt,
    type: "resolve",
    summary: `Retried stale browser target after reobserve: ${resolution.reason}`,
    detail: { adapterId: input.adapterId, confidence: resolution.confidence }
  }));
  if (!resolution.primary || resolution.confidence < 0.75) {
    return {
      requestId: input.adapterId,
      adapterId: input.adapterId,
      ok: false,
      before: input.observation,
      after: refreshed,
      error: "Browser target became stale and could not be resolved again with high confidence."
    };
  }
  input.result.target = resolution.primary;
  return executeWithAdapter({
    adapter: input.adapter,
    executeInput: {
      session: input.session,
      observation: refreshed,
      action: input.result.action,
      target: resolution.primary,
      timeoutMs: readActionTimeoutMs(input.result.action)
    },
    timeoutMs: readActionTimeoutMs(input.result.action)
  });
}
