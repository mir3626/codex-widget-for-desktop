import { randomUUID } from "node:crypto";
import { buildBrowserObservation, summarizeBrowserObservation } from "./browserObservation.js";
import { createBrowserQueuedCommand } from "./actionExecutor.js";
import { createTimelineEvent } from "./actionTimeline.js";
import { buildElementGraph } from "./elementGraph.js";
import { auditActionResult, auditObservation } from "./auditLog.js";
import { BrowserActionAdapterRegistry, executeWithAdapter, observeWithAdapter } from "./adapterRegistry.js";
import { applyBrowserActionPolicyToSafety, matchBrowserActionPolicy } from "./permissionPolicy.js";
import { verifyBrowserAction } from "./resultVerifier.js";
import { decideBrowserActionSafety } from "./safetyPolicy.js";
import { resolveTarget } from "./targetResolver.js";
import type {
  BrowserAction,
  BrowserActionAdapterStatus,
  BrowserActionApproval,
  BrowserActionAuditEntry,
  BrowserActionExecutionResult,
  BrowserActionMode,
  BrowserActionPlan,
  BrowserActionPolicy,
  BrowserActionPolicyMatch,
  BrowserActionResult,
  BrowserActionSession,
  BrowserActionSource,
  BrowserObservation,
  BrowserQueuedCommand
} from "./types.js";
import type { RuntimeInteractionDecision } from "../../shared/protocol.js";

export class BrowserActionSessionManager {
  private sessions = new Map<string, BrowserActionSession>();
  private results = new Map<string, BrowserActionResult>();
  private pendingCommands: BrowserQueuedCommand[] = [];
  private pendingApprovals = new Map<string, BrowserActionApproval>();
  private commandResultIds = new Map<string, string>();
  private adapters: BrowserActionAdapterRegistry;

  constructor(adapters = new BrowserActionAdapterRegistry()) {
    this.adapters = adapters;
  }

  start(input: {
    id?: string;
    sessionId?: string;
    mode?: BrowserActionMode;
    source?: Partial<BrowserActionSource>;
  } = {}): BrowserActionSession {
    const id = input.id?.trim() || `browser-action-${randomUUID()}`;
    if (this.sessions.has(id)) {
      throw new Error(`Browser Action session already exists: ${id}`);
    }
    const session: BrowserActionSession = {
      id,
      sessionId: input.sessionId,
      startedAt: new Date().toISOString(),
      source: {
        kind: input.source?.kind ?? "active_tab",
        browser: input.source?.browser ?? "unknown",
        tabId: input.source?.tabId,
        url: input.source?.url,
        title: input.source?.title,
        windowId: input.source?.windowId
      },
      mode: input.mode ?? "auto_safe_actions",
      status: "active",
      timeline: [],
      approvals: []
    };
    session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "start", summary: "Browser Action session started", detail: { mode: session.mode } }));
    this.sessions.set(id, session);
    return cloneSession(session);
  }

  get(id: string): BrowserActionSession | undefined {
    const session = this.sessions.get(id);
    return session ? cloneSession(session) : undefined;
  }

  async getAdapterStatuses(actionSessionId?: string): Promise<BrowserActionAdapterStatus[]> {
    const session = actionSessionId ? this.requireSession(actionSessionId) : createDiagnosticSession();
    return this.adapters.statuses(session);
  }

  observe(input: { actionSessionId: string; snapshot: unknown; now?: Date }): { session: BrowserActionSession; observation: BrowserObservation; audit: BrowserActionAuditEntry } {
    const session = this.requireSession(input.actionSessionId);
    const observation = buildBrowserObservation({ source: session.source, snapshot: input.snapshot, now: input.now });
    session.latestObservation = observation;
    session.source = { ...session.source, url: observation.url, title: observation.title };
    session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "observe", summary: "Browser observation captured", detail: summarizeBrowserObservation(observation) }));
    return {
      session: cloneSession(session),
      observation,
      audit: auditObservation(session, observation)
    };
  }

  async observeViaAdapter(input: { actionSessionId: string; adapterId: string; providerState?: unknown; now?: Date }): Promise<{ session: BrowserActionSession; observation: BrowserObservation; audit: BrowserActionAuditEntry }> {
    const session = this.requireSession(input.actionSessionId);
    const adapter = this.adapters.get(input.adapterId);
    if (!adapter) {
      throw new Error(`Browser Action adapter not found: ${input.adapterId}`);
    }
    const available = await adapter.isAvailable({ session });
    if (!available) {
      throw new Error(`${adapter.label} is unavailable for this Browser Action session.`);
    }
    const observation = await observeWithAdapter({
      adapter,
      observeInput: {
        session,
        providerState: input.providerState ?? { url: session.source.url, title: session.source.title }
      }
    });
    session.latestObservation = observation;
    session.source = { ...session.source, url: observation.url, title: observation.title };
    session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "observe", summary: `Browser observation captured via ${adapter.label}`, detail: summarizeBrowserObservation(observation) }));
    return {
      session: cloneSession(session),
      observation,
      audit: auditObservation(session, observation)
    };
  }

  async execute(input: {
    actionSessionId: string;
    action: BrowserAction;
    snapshot: unknown;
    adapterId?: string;
    approved?: boolean;
    targetHint?: string;
    policyMatch?: BrowserActionPolicyMatch;
    policies?: BrowserActionPolicy[];
  }): Promise<{ session: BrowserActionSession; result: BrowserActionResult; command?: BrowserQueuedCommand; approval?: BrowserActionApproval; audit: BrowserActionAuditEntry }> {
    const session = this.requireSession(input.actionSessionId);
    const observation = session.latestObservation ?? buildBrowserObservation({ source: session.source, snapshot: input.snapshot });
    session.latestObservation = observation;
    const graph = buildElementGraph({ observationId: observation.id, focusedElementId: observation.focusedElementId, elements: observation.elements });
    const targetResolution = resolveTarget({
      graph,
      target: readActionTarget(input.action),
      hint: input.targetHint
    });
    const baseSafety = decideBrowserActionSafety({
      action: input.action,
      target: targetResolution.primary,
      targetConfidence: targetResolution.confidence,
      mode: session.mode
    });
    const policyMatch = input.policyMatch ?? (input.policies
      ? matchBrowserActionPolicy({
          policies: input.policies,
          action: input.action,
          target: targetResolution.primary,
          observation,
          mode: session.mode,
          safety: baseSafety
        })
      : undefined);
    const safety = applyBrowserActionPolicyToSafety({ safety: baseSafety, match: policyMatch });
    const result: BrowserActionResult = {
      id: `browser-result-${randomUUID()}`,
      actionSessionId: session.id,
      adapterId: input.adapterId,
      action: input.action,
      target: targetResolution.primary,
      startedAt: new Date().toISOString(),
      status: "pending",
      safety,
      before: observation,
      verification: { status: "unknown", reason: "Action has not completed yet." }
    };
    this.results.set(result.id, result);
    session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "resolve", summary: targetResolution.reason, detail: { confidence: targetResolution.confidence, alternatives: targetResolution.alternatives.map((element) => element.id) } }));

    if (safety.decision === "block" || safety.decision === "clarify") {
      result.status = safety.decision === "block" ? "failed" : "needs_clarification";
      result.completedAt = new Date().toISOString();
      result.error = safety.reason;
      result.verification = { status: "failed", reason: safety.reason };
      session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "result", summary: `Browser action ${result.status}`, detail: { safety } }));
      return { session: cloneSession(session), result: cloneResult(result), audit: auditActionResult(session, result) };
    }

    if (safety.decision === "confirm" && !input.approved) {
      result.status = "needs_approval";
      result.completedAt = new Date().toISOString();
      const approval: BrowserActionApproval = {
        id: `browser-approval-${randomUUID()}`,
        actionSessionId: session.id,
        resultId: result.id,
        adapterId: input.adapterId,
        createdAt: new Date().toISOString(),
        action: input.action,
        target: targetResolution.primary,
        safety
      };
      session.approvals.push(approval);
      this.pendingApprovals.set(approval.id, approval);
      session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "approval", summary: safety.reason, detail: { approvalId: approval.id } }));
      return { session: cloneSession(session), result: cloneResult(result), approval, audit: auditActionResult(session, result) };
    }

    if (input.action.type === "read") {
      result.status = "succeeded";
      result.completedAt = new Date().toISOString();
      result.after = observation;
      result.verification = { status: "passed", reason: "Read action returned the current browser observation." };
      session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "result", summary: "Browser read completed", detail: { resultId: result.id } }));
      return { session: cloneSession(session), result: cloneResult(result), audit: auditActionResult(session, result) };
    }

    if (input.adapterId && input.adapterId !== "extension") {
      return this.executeViaAdapter({
        adapterId: input.adapterId,
        session,
        result,
        observation,
        audit: auditActionResult(session, result)
      });
    }

    const command = createBrowserQueuedCommand({
      requestId: `browser-command-${randomUUID()}`,
      actionSessionId: session.id,
      resultId: result.id,
      adapterId: input.adapterId ?? "extension",
      action: input.action,
      target: targetResolution.primary,
      expectedSource: session.source,
      timeoutMs: readActionTimeoutMs(input.action)
    });
    this.commandResultIds.set(command.requestId, result.id);
    this.pendingCommands.push(command);
    session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "execute", summary: `Queued browser action: ${input.action.type}`, detail: { requestId: command.requestId, resultId: result.id } }));
    return { session: cloneSession(session), result: cloneResult(result), command, audit: auditActionResult(session, result) };
  }

  async respondToInteraction(input: { id: string; decision: RuntimeInteractionDecision }): Promise<{ handled: boolean; approved?: boolean; approval?: BrowserActionApproval; result?: BrowserActionResult; command?: BrowserQueuedCommand }> {
    const approval = this.pendingApprovals.get(input.id);
    if (!approval) {
      return { handled: false };
    }
    this.pendingApprovals.delete(input.id);
    approval.decision = input.decision;
    const session = this.requireSession(approval.actionSessionId);
    const result = this.results.get(approval.resultId);
    if (!result) {
      return { handled: true, approved: false, approval };
    }
    if (input.decision !== "approve" && input.decision !== "always_allow") {
      result.status = "cancelled";
      result.completedAt = new Date().toISOString();
      result.error = "User declined the browser action.";
      result.verification = { status: "failed", reason: result.error };
      session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "result", summary: "Browser action declined", detail: { resultId: result.id } }));
      return { handled: true, approved: false, approval, result: cloneResult(result) };
    }
    if (approval.adapterId && approval.adapterId !== "extension") {
      const direct = await this.executeViaAdapter({
        adapterId: approval.adapterId,
        session,
        result,
        observation: result.before,
        audit: auditActionResult(session, result)
      });
      return { handled: true, approved: true, approval, result: direct.result };
    }
    const command = createBrowserQueuedCommand({
      requestId: `browser-command-${randomUUID()}`,
      actionSessionId: session.id,
      resultId: result.id,
      adapterId: approval.adapterId ?? "extension",
      action: approval.action,
      target: approval.target,
      expectedSource: session.source,
      timeoutMs: readActionTimeoutMs(approval.action)
    });
    this.commandResultIds.set(command.requestId, result.id);
    result.status = "pending";
    result.completedAt = undefined;
    result.verification = { status: "unknown", reason: "Approved action is waiting for the browser extension." };
    this.pendingCommands.push(command);
    session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "execute", summary: `Approved browser action queued: ${approval.action.type}`, detail: { requestId: command.requestId } }));
    return { handled: true, approved: true, approval, result: cloneResult(result), command };
  }

  async executePlan(input: {
    plan: BrowserActionPlan;
    snapshot: unknown;
    adapterId?: string;
    approvedStepIds?: string[];
    policyMatches?: Record<string, BrowserActionPolicyMatch | undefined>;
    policies?: BrowserActionPolicy[];
  }): Promise<{
    session: BrowserActionSession;
    plan: BrowserActionPlan;
    results: BrowserActionResult[];
    command?: BrowserQueuedCommand;
    approval?: BrowserActionApproval;
    audits: BrowserActionAuditEntry[];
  }> {
    const session = this.requireSession(input.plan.actionSessionId);
    const plan = clonePlan({
      ...input.plan,
      adapterId: input.adapterId ?? input.plan.adapterId,
      status: "running",
      steps: input.plan.steps.map((step) => ({ ...step }))
    });
    const results: BrowserActionResult[] = [];
    const audits: BrowserActionAuditEntry[] = [];
    session.timeline.push(createTimelineEvent({
      startedAt: session.startedAt,
      type: "plan",
      summary: `Browser Action plan started: ${plan.goal}`,
      detail: { planId: plan.id, steps: plan.steps.length, adapterId: plan.adapterId }
    }));

    for (const step of plan.steps) {
      if (session.status === "cancelled") {
        step.status = "cancelled";
        plan.status = "cancelled";
        break;
      }
      if (step.status === "succeeded" || step.status === "skipped") {
        continue;
      }
      step.status = "running";
      step.startedAt = new Date().toISOString();
      step.attempts = (step.attempts ?? 0) + 1;
      const execution = await this.execute({
        actionSessionId: session.id,
        action: step.action,
        snapshot: input.snapshot,
        adapterId: plan.adapterId,
        approved: input.approvedStepIds?.includes(step.id),
        targetHint: step.targetSummary,
        policyMatch: input.policyMatches?.[step.id],
        policies: input.policies
      });
      audits.push(execution.audit);
      results.push(execution.result);
      step.resultId = execution.result.id;
      step.safety = execution.result.safety;
      if (execution.approval) {
        step.status = "awaiting_approval";
        step.completedAt = new Date().toISOString();
        plan.status = "awaiting_approval";
        plan.summary = `Plan paused for approval at ${step.id}.`;
        return { session: cloneSession(session), plan, results: results.map(cloneResult), approval: execution.approval, audits };
      }
      if (execution.command) {
        step.status = "awaiting_extension";
        step.completedAt = new Date().toISOString();
        plan.status = "paused";
        plan.summary = `Plan paused while extension executes ${step.id}.`;
        return { session: cloneSession(session), plan, results: results.map(cloneResult), command: execution.command, audits };
      }
      if (execution.result.status !== "succeeded") {
        step.status = execution.result.status === "cancelled" ? "cancelled" : "failed";
        step.error = execution.result.error ?? execution.result.verification.reason;
        step.completedAt = new Date().toISOString();
        plan.status = step.status === "cancelled" ? "cancelled" : "failed";
        plan.summary = `Plan stopped at ${step.id}: ${step.error}`;
        return { session: cloneSession(session), plan, results: results.map(cloneResult), audits };
      }
      step.status = "succeeded";
      step.completedAt = new Date().toISOString();
      session.timeline.push(createTimelineEvent({
        startedAt: session.startedAt,
        type: "verify",
        summary: `Plan step verified: ${step.id}`,
        detail: { resultId: execution.result.id, verification: execution.result.verification }
      }));
    }
    plan.status = plan.steps.every((step) => step.status === "succeeded" || step.status === "skipped") ? "completed" : plan.status;
    plan.summary = plan.status === "completed" ? `Browser Action plan completed with ${results.length} result(s).` : plan.summary;
    session.timeline.push(createTimelineEvent({
      startedAt: session.startedAt,
      type: "plan",
      summary: plan.summary ?? `Browser Action plan ${plan.status}`,
      detail: { planId: plan.id, status: plan.status }
    }));
    return { session: cloneSession(session), plan, results: results.map(cloneResult), audits };
  }

  pollExtensionCommand(): BrowserQueuedCommand | undefined {
    const now = Date.now();
    const command = this.pendingCommands.shift();
    if (!command) {
      return undefined;
    }
    if (command.expiresAt && Date.parse(command.expiresAt) <= now) {
      this.failQueuedCommand(command, "Browser Action command timed out before the extension picked it up.");
      return this.pollExtensionCommand();
    }
    return command;
  }

  completeExtensionCommand(input: BrowserActionExecutionResult): { session: BrowserActionSession; result: BrowserActionResult; audit: BrowserActionAuditEntry } {
    const commandResultId = this.commandResultIds.get(input.requestId);
    const commandResult = commandResultId ? this.results.get(commandResultId) : undefined;
    if (!commandResult) {
      throw new Error(`Browser action result not found for request: ${input.requestId}`);
    }
    this.commandResultIds.delete(input.requestId);
    const session = this.requireSession(commandResult.actionSessionId);
    const after = input.after ? buildBrowserObservation({ source: session.source, snapshot: input.after }) : commandResult.before;
    commandResult.after = after;
    commandResult.status = input.ok ? "succeeded" : "failed";
    commandResult.completedAt = new Date().toISOString();
    commandResult.error = input.error;
    commandResult.verification = verifyBrowserAction({
      action: commandResult.action,
      before: commandResult.before,
      after,
      ok: input.ok,
      error: input.error
    });
    if (after) {
      session.latestObservation = after;
      session.source = { ...session.source, url: after.url, title: after.title };
    }
    session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "result", summary: `Browser action ${commandResult.status}: ${commandResult.action.type}`, detail: { requestId: input.requestId, verification: commandResult.verification } }));
    return {
      session: cloneSession(session),
      result: cloneResult(commandResult),
      audit: auditActionResult(session, commandResult)
    };
  }

  cancel(id: string): BrowserActionSession {
    const session = this.requireSession(id);
    session.status = "cancelled";
    session.stoppedAt = new Date().toISOString();
    session.timeline.push(createTimelineEvent({ startedAt: session.startedAt, type: "cancel", summary: "Browser Action session cancelled" }));
    this.pendingCommands = this.pendingCommands.filter((command) => command.actionSessionId !== id);
    for (const [requestId, resultId] of this.commandResultIds.entries()) {
      const result = this.results.get(resultId);
      if (result?.actionSessionId === id) {
        this.commandResultIds.delete(requestId);
      }
    }
    for (const [approvalId, approval] of this.pendingApprovals.entries()) {
      if (approval.actionSessionId === id) {
        this.pendingApprovals.delete(approvalId);
      }
    }
    return cloneSession(session);
  }

  private failQueuedCommand(command: BrowserQueuedCommand, error: string): void {
    const result = this.results.get(command.resultId);
    if (!result) {
      return;
    }
    const session = this.sessions.get(command.actionSessionId);
    result.status = "failed";
    result.completedAt = new Date().toISOString();
    result.error = error;
    result.verification = { status: "failed", reason: error };
    this.commandResultIds.delete(command.requestId);
    if (session) {
      session.timeline.push(createTimelineEvent({
        startedAt: session.startedAt,
        type: "error",
        summary: error,
        detail: { requestId: command.requestId, resultId: result.id }
      }));
    }
  }

  private requireSession(id: string): BrowserActionSession {
    const session = this.sessions.get(id.trim());
    if (!session) {
      throw new Error(`Browser Action session not found: ${id}`);
    }
    return session;
  }

  private async executeViaAdapter(input: {
    adapterId: string;
    session: BrowserActionSession;
    result: BrowserActionResult;
    observation?: BrowserObservation;
    audit: BrowserActionAuditEntry;
  }): Promise<{ session: BrowserActionSession; result: BrowserActionResult; audit: BrowserActionAuditEntry }> {
    const adapter = this.adapters.get(input.adapterId);
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
        : await this.retryViaAdapterAfterReobserve({ adapterId: adapter.id, session: input.session, result, adapter, observation });
      const after = finalExecution.after ? buildBrowserObservation({ source: input.session.source, snapshot: finalExecution.after }) : observation;
      result.adapterId = execution.adapterId ?? adapter.id;
      result.after = after;
      result.status = finalExecution.ok ? "succeeded" : "failed";
      result.completedAt = new Date().toISOString();
      result.error = finalExecution.error;
      result.verification = verifyBrowserAction({
        action: result.action,
        before: observation,
        after,
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

  private async retryViaAdapterAfterReobserve(input: {
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
    const resolution = resolveTarget({ graph, target: readActionTarget(input.result.action), hint: input.result.safety.targetSummary });
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
}

export function summarizeBrowserActionSession(session: BrowserActionSession): Record<string, unknown> {
  return {
    id: session.id,
    sessionId: session.sessionId,
    mode: session.mode,
    status: session.status,
    source: session.source,
    events: session.timeline.length,
    approvals: session.approvals.length,
    latestObservation: session.latestObservation ? summarizeBrowserObservation(session.latestObservation) : undefined
  };
}

function readActionTarget(action: BrowserAction) {
  return "target" in action ? action.target : undefined;
}

function readActionTimeoutMs(action: BrowserAction): number {
  if (action.type === "evaluate" && action.timeoutMs) {
    return Math.max(1, Math.min(Math.floor(action.timeoutMs), 5_000));
  }
  return 12_000;
}

function isRetriableBrowserActionError(error: string | undefined): boolean {
  return /target|selector|stale|detached|not found|not visible|not editable/i.test(error ?? "");
}

function createDiagnosticSession(): BrowserActionSession {
  return {
    id: "browser-action-adapter-diagnostics",
    startedAt: new Date().toISOString(),
    source: { kind: "active_tab", browser: "unknown" },
    mode: "auto_safe_actions",
    status: "active",
    timeline: [],
    approvals: []
  };
}

function cloneSession(session: BrowserActionSession): BrowserActionSession {
  return JSON.parse(JSON.stringify(session)) as BrowserActionSession;
}

function cloneResult(result: BrowserActionResult): BrowserActionResult {
  return JSON.parse(JSON.stringify(result)) as BrowserActionResult;
}

function clonePlan(plan: BrowserActionPlan): BrowserActionPlan {
  return JSON.parse(JSON.stringify(plan)) as BrowserActionPlan;
}
