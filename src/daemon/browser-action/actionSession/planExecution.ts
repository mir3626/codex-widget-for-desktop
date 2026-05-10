import { createTimelineEvent } from "../actionTimeline.js";
import type {
  BrowserActionApproval,
  BrowserActionAuditEntry,
  BrowserExpectedState,
  BrowserActionPlan,
  BrowserActionPolicy,
  BrowserActionPolicyMatch,
  BrowserActionResult,
  BrowserActionSession,
  BrowserQueuedCommand
} from "../types.js";
import type {
  BrowserInteractionTransaction,
  BrowserViewContextLease
} from "../interaction/types.js";
import {
  clonePlan,
  cloneResult,
  cloneSession
} from "./cloning.js";

export async function executeBrowserActionPlan(input: {
  session: BrowserActionSession;
  plan: BrowserActionPlan;
  snapshot: unknown;
  contextLease?: BrowserViewContextLease;
  transaction?: BrowserInteractionTransaction;
  adapterId?: string;
  approvedStepIds?: string[];
  policyMatches?: Record<string, BrowserActionPolicyMatch | undefined>;
  policies?: BrowserActionPolicy[];
  executeStep: (input: {
    actionSessionId: string;
    action: BrowserActionPlan["steps"][number]["action"];
    snapshot: unknown;
    contextLease?: BrowserViewContextLease;
    transaction?: BrowserInteractionTransaction;
    expected?: BrowserExpectedState[];
    adapterId?: string;
    approved?: boolean;
    targetHint?: string;
    policyMatch?: BrowserActionPolicyMatch;
    policies?: BrowserActionPolicy[];
  }) => Promise<{
    session: BrowserActionSession;
    result: BrowserActionResult;
    command?: BrowserQueuedCommand;
    approval?: BrowserActionApproval;
    audit: BrowserActionAuditEntry;
  }>;
}): Promise<{
  session: BrowserActionSession;
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
  command?: BrowserQueuedCommand;
  approval?: BrowserActionApproval;
  audits: BrowserActionAuditEntry[];
}> {
  const plan = clonePlan({
    ...input.plan,
    adapterId: input.adapterId ?? input.plan.adapterId,
    status: "running",
    steps: input.plan.steps.map((step) => ({ ...step }))
  });
  const results: BrowserActionResult[] = [];
  const audits: BrowserActionAuditEntry[] = [];
  input.session.timeline.push(createTimelineEvent({
    startedAt: input.session.startedAt,
    type: "plan",
    summary: `Browser Action plan started: ${plan.goal}`,
    detail: { planId: plan.id, steps: plan.steps.length, adapterId: plan.adapterId }
  }));

  for (const step of plan.steps) {
    const paused = readPlanPauseState(input.session, plan, step);
    if (paused) {
      break;
    }
    if (step.status === "succeeded" || step.status === "skipped") {
      continue;
    }
    step.status = "running";
    step.startedAt = new Date().toISOString();
    step.attempts = (step.attempts ?? 0) + 1;
    const execution = await input.executeStep({
      actionSessionId: input.session.id,
      action: step.action,
      snapshot: input.snapshot,
      contextLease: input.contextLease,
      transaction: input.transaction,
      expected: step.expected,
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
      return { session: cloneSession(input.session), plan, results: results.map(cloneResult), approval: execution.approval, audits };
    }
    if (execution.command) {
      step.status = "awaiting_extension";
      step.completedAt = new Date().toISOString();
      plan.status = "paused";
      plan.summary = `Plan paused while extension executes ${step.id}.`;
      return { session: cloneSession(input.session), plan, results: results.map(cloneResult), command: execution.command, audits };
    }
    if (execution.result.status !== "succeeded") {
      step.status = execution.result.status === "cancelled" ? "cancelled" : "failed";
      step.error = execution.result.error ?? execution.result.verification.reason;
      step.completedAt = new Date().toISOString();
      plan.status = step.status === "cancelled" ? "cancelled" : "failed";
      plan.summary = `Plan stopped at ${step.id}: ${step.error}`;
      return { session: cloneSession(input.session), plan, results: results.map(cloneResult), audits };
    }
    step.status = "succeeded";
    step.completedAt = new Date().toISOString();
    input.session.timeline.push(createTimelineEvent({
      startedAt: input.session.startedAt,
      type: "verify",
      summary: `Plan step verified: ${step.id}`,
      detail: { resultId: execution.result.id, verification: execution.result.verification }
    }));
  }
  plan.status = plan.steps.every((step) => step.status === "succeeded" || step.status === "skipped") ? "completed" : plan.status;
  plan.summary = plan.status === "completed" ? `Browser Action plan completed with ${results.length} result(s).` : plan.summary;
  input.session.timeline.push(createTimelineEvent({
    startedAt: input.session.startedAt,
    type: "plan",
    summary: plan.summary ?? `Browser Action plan ${plan.status}`,
    detail: { planId: plan.id, status: plan.status }
  }));
  return { session: cloneSession(input.session), plan, results: results.map(cloneResult), audits };
}

function readPlanPauseState(
  session: BrowserActionSession,
  plan: BrowserActionPlan,
  step: BrowserActionPlan["steps"][number]
): boolean {
  if (session.status !== "cancelled") {
    return false;
  }
  step.status = "cancelled";
  plan.status = "cancelled";
  return true;
}
