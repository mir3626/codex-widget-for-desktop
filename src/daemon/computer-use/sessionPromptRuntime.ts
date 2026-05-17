import { randomUUID } from "node:crypto";
import type { WidgetMode } from "../../shared/protocol.js";
import type {
  ComputerSessionEvent,
  ComputerSessionPromptRunSummary,
  ComputerSessionPromptStepSummary,
  ComputerSessionState,
  ComputerSessionSummary,
  ComputerStructuredOperation
} from "../../shared/protocol.js";
import {
  planBrowserActionFromPrompt,
  type BrowserActionPromptPlan,
  type BrowserActionSource
} from "../browser-action/index.js";
import type { CapabilityRuntime } from "../capability-runtime/index.js";
import type { StorageService } from "../storage/storage.js";
import { resolvePromptBrowserSource } from "./operationRouting.js";
import {
  isPromptStepFinal,
  readPromptStepStatus,
  readPromptStepStatusFromJobNode
} from "./sessionRuntimeHelpers.js";
import type {
  ComputerSessionOperationResult,
  ComputerSessionPromptPlanResult,
  RuntimeSessionState
} from "./sessionRuntimeTypes.js";

export type ComputerSessionPromptRuntimeHost = {
  storage: StorageService;
  capabilityRuntime: CapabilityRuntime;
  promptPlans: Map<string, BrowserActionPromptPlan>;
  sessionEntries: () => Iterable<[string, RuntimeSessionState]>;
  requireSession: (sessionId: string) => RuntimeSessionState;
  transition: (
    sessionId: string,
    state: ComputerSessionState,
    patch?: Partial<ComputerSessionSummary>
  ) => ComputerSessionSummary;
  block: (sessionId: string, reason: string) => ComputerSessionSummary;
  executeOperation: (input: {
    sessionId: string;
    operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>;
    waitMs?: number;
  }) => Promise<ComputerSessionOperationResult>;
  recordVerifierResult: (sessionId: string, result: unknown) => void;
  persistSessionState: (state: RuntimeSessionState) => void;
  emit: (event: ComputerSessionEvent) => void;
};

export async function executeBrowserActionPrompt(
  host: ComputerSessionPromptRuntimeHost,
  input: {
    sessionId: string;
    text: string;
    mode?: WidgetMode;
    source?: Partial<BrowserActionSource>;
  }
): Promise<ComputerSessionPromptPlanResult> {
  const state = host.requireSession(input.sessionId);
  if (!state.summary.evalRunId) {
    throw new Error("Computer session must be started before planning Browser Action prompts.");
  }
  host.transition(input.sessionId, "planning");
  const promptSource = resolvePromptBrowserSource(state.summary, input.source);
  const defaultAdapterId = state.summary.selectedSurface?.kind === "isolated_browser" ? "playwright" : undefined;
  const plan = planBrowserActionFromPrompt({
    text: input.text,
    mode: input.mode ?? "browser",
    defaultAdapterId,
    source: promptSource
  });
  if (!plan || !plan.steps[0]) {
    const blockedReason = "browser_action_prompt_not_plannable";
    host.storage.appendComputerUseEvalStep({
      runId: state.summary.evalRunId,
      kind: "browser_action_prompt_plan",
      phase: "planning",
      status: "failed",
      input: { text: input.text, mode: input.mode ?? "browser", source: promptSource, defaultAdapterId },
      output: { blockedReason },
      failureClass: "ambiguous_target"
    });
    host.block(input.sessionId, blockedReason);
    return {
      session: host.requireSession(input.sessionId).summary,
      blockedReason
    };
  }
  host.storage.appendComputerUseEvalStep({
    runId: state.summary.evalRunId,
    kind: "browser_action_prompt_plan",
    phase: "planning",
    status: "completed",
    input: { text: input.text, mode: input.mode ?? "browser", source: promptSource, defaultAdapterId },
    output: {
      planId: plan.id,
      confidence: plan.confidence,
      reason: plan.reason,
      steps: plan.steps.map((step) => ({
        id: step.id,
        action: step.action.type,
        targetSummary: step.targetSummary
      }))
    },
    failureClass: "none"
  });
  host.emit({
    type: "computer.session.plan",
    sessionId: input.sessionId,
    plan
  });
  const promptRun = createPromptRun(host, input.sessionId, input.text, plan);
  const operation = await startBrowserActionPromptStep(host, input.sessionId, promptRun.id, 0);
  return {
    session: host.requireSession(input.sessionId).summary,
    plan,
    promptRun: readPromptRun(host, input.sessionId, promptRun.id),
    operation
  };
}

export async function continueBrowserActionPrompt(
  host: ComputerSessionPromptRuntimeHost,
  input: {
    sessionId: string;
    promptRunId?: string;
  }
): Promise<ComputerSessionPromptPlanResult> {
  const state = host.requireSession(input.sessionId);
  const promptRun = input.promptRunId
    ? requirePromptRun(state, input.promptRunId)
    : findContinuablePromptRun(state);
  if (!promptRun) {
    return {
      session: state.summary,
      blockedReason: "browser_action_prompt_run_not_found"
    };
  }
  refreshPromptRunFromStorage(host, input.sessionId, promptRun.id);
  const latestRun = requirePromptRun(state, promptRun.id);
  const plan = host.promptPlans.get(latestRun.id);
  if (!plan) {
    latestRun.status = "failed";
    latestRun.lastError = "browser_action_prompt_plan_missing";
    latestRun.updatedAt = new Date().toISOString();
    emitPromptRun(host, input.sessionId, latestRun);
    return {
      session: host.requireSession(input.sessionId).summary,
      promptRun: latestRun,
      blockedReason: latestRun.lastError
    };
  }
  if (latestRun.status === "completed" || latestRun.status === "failed" || latestRun.status === "cancelled") {
    return {
      session: host.requireSession(input.sessionId).summary,
      plan,
      promptRun: latestRun
    };
  }
  const current = latestRun.steps[latestRun.currentStepIndex];
  if (current && current.status !== "completed") {
    return {
      session: host.requireSession(input.sessionId).summary,
      plan,
      promptRun: latestRun
    };
  }
  const nextIndex = latestRun.steps.findIndex((step) => step.status === "pending");
  if (nextIndex < 0) {
    completePromptRun(host, input.sessionId, latestRun.id);
    return {
      session: host.requireSession(input.sessionId).summary,
      plan,
      promptRun: requirePromptRun(state, latestRun.id)
    };
  }
  const operation = await startBrowserActionPromptStep(host, input.sessionId, latestRun.id, nextIndex);
  return {
    session: host.requireSession(input.sessionId).summary,
    plan,
    promptRun: requirePromptRun(state, latestRun.id),
    operation
  };
}

export async function continueBrowserActionPromptByCapabilityJob(
  host: ComputerSessionPromptRuntimeHost,
  capabilityJobId: string
): Promise<ComputerSessionPromptPlanResult | null> {
  for (const [sessionId, state] of host.sessionEntries()) {
    for (const promptRun of state.promptRuns) {
      const step = promptRun.steps.find((candidate) => candidate.capabilityJobId === capabilityJobId);
      if (!step || isPromptStepFinal(step.status)) {
        continue;
      }
      return await continueBrowserActionPrompt(host, { sessionId, promptRunId: promptRun.id });
    }
  }
  return null;
}

function createPromptRun(
  host: ComputerSessionPromptRuntimeHost,
  sessionId: string,
  prompt: string,
  plan: BrowserActionPromptPlan
): ComputerSessionPromptRunSummary {
  const state = host.requireSession(sessionId);
  const now = new Date().toISOString();
  const promptRun: ComputerSessionPromptRunSummary = {
    id: `browser-prompt-run:${randomUUID()}`,
    sessionId,
    prompt,
    planId: plan.id,
    goal: plan.goal,
    status: "pending",
    currentStepIndex: 0,
    confidence: plan.confidence,
    reason: plan.reason,
    steps: plan.steps.map((step, index): ComputerSessionPromptStepSummary => ({
      id: step.id,
      index,
      actionType: step.action.type,
      targetSummary: step.targetSummary,
      status: "pending"
    })),
    createdAt: now,
    updatedAt: now
  };
  state.promptRuns.push(promptRun);
  host.promptPlans.set(promptRun.id, plan);
  emitPromptRun(host, sessionId, promptRun);
  return promptRun;
}

async function startBrowserActionPromptStep(
  host: ComputerSessionPromptRuntimeHost,
  sessionId: string,
  promptRunId: string,
  stepIndex: number
): Promise<ComputerSessionOperationResult> {
  const state = host.requireSession(sessionId);
  const promptRun = requirePromptRun(state, promptRunId);
  const plan = host.promptPlans.get(promptRunId);
  const step = plan?.steps[stepIndex];
  const stepSummary = promptRun.steps[stepIndex];
  if (!plan || !step || !stepSummary) {
    throw new Error(`Browser Action prompt step not found: ${promptRunId}#${stepIndex}`);
  }
  const now = new Date().toISOString();
  promptRun.status = "running";
  promptRun.currentStepIndex = stepIndex;
  promptRun.updatedAt = now;
  stepSummary.status = "running";
  stepSummary.startedAt = stepSummary.startedAt ?? now;
  stepSummary.lastError = undefined;
  emitPromptRun(host, sessionId, promptRun);
  const operation = await host.executeOperation({
    sessionId,
    operation: {
      kind: "browser_action",
      input: {
        actionSessionId: `computer-session-browser-action:${sessionId}`,
        mode: plan.mode,
        adapterId: plan.adapterId,
        source: plan.source,
        action: step.action,
        expected: step.expected,
        targetHint: step.targetSummary,
        promptRunId,
        promptStepId: step.id,
        promptStepIndex: stepIndex
      }
    }
  });
  const latest = requirePromptRun(state, promptRunId);
  const latestStep = latest.steps[stepIndex];
  latestStep.dagNodeId = operation.dagNode.id;
  latestStep.capabilityJobId = operation.job?.id;
  latestStep.status = readPromptStepStatus(operation);
  latestStep.completedAt = isPromptStepFinal(latestStep.status) ? new Date().toISOString() : latestStep.completedAt;
  latestStep.lastError = operation.dagNode.lastError ?? operation.job?.lastError;
  latest.status = latestStep.status === "awaiting_approval" ? "awaiting_approval" : latestStep.status === "completed" ? "running" : latestStep.status;
  latest.updatedAt = new Date().toISOString();
  recordPromptStepEval(host, sessionId, latest, latestStep, "started");
  emitPromptRun(host, sessionId, latest);
  if (latestStep.status === "completed") {
    return (await continueBrowserActionPrompt(host, { sessionId, promptRunId })).operation ?? operation;
  }
  return operation;
}

function refreshPromptRunFromStorage(
  host: ComputerSessionPromptRuntimeHost,
  sessionId: string,
  promptRunId: string
): void {
  const state = host.requireSession(sessionId);
  const promptRun = requirePromptRun(state, promptRunId);
  let changed = false;
  for (const step of promptRun.steps) {
    if (!step.capabilityJobId && !step.dagNodeId) {
      continue;
    }
    const before = step.status;
    const job = step.capabilityJobId ? host.capabilityRuntime.read(step.capabilityJobId) : null;
    const node = step.dagNodeId ? host.storage.readCapabilityDagNode(step.dagNodeId) : null;
    step.status = readPromptStepStatusFromJobNode(job, node, step.status);
    step.lastError = node?.lastError ?? job?.lastError ?? step.lastError;
    if (isPromptStepFinal(step.status) && !step.completedAt) {
      step.completedAt = new Date().toISOString();
    }
    if (before !== step.status) {
      changed = true;
      recordPromptStepEval(host, sessionId, promptRun, step, "completed");
    }
  }
  const failed = promptRun.steps.find((step) => step.status === "failed" || step.status === "cancelled");
  if (failed) {
    promptRun.status = failed.status;
    promptRun.lastError = failed.lastError ?? `browser_action_prompt_step_${failed.status}`;
    promptRun.completedAt = promptRun.completedAt ?? new Date().toISOString();
    changed = true;
  } else if (promptRun.steps.every((step) => step.status === "completed" || step.status === "skipped")) {
    promptRun.status = "completed";
    changed = true;
  } else if (promptRun.steps.some((step) => step.status === "awaiting_approval")) {
    promptRun.status = "awaiting_approval";
    changed = true;
  } else if (promptRun.steps.some((step) => step.status === "running")) {
    promptRun.status = "running";
    changed = true;
  }
  if (changed) {
    promptRun.updatedAt = new Date().toISOString();
    emitPromptRun(host, sessionId, promptRun);
    if (promptRun.status === "completed") {
      completePromptRun(host, sessionId, promptRunId);
    }
  }
}

function completePromptRun(
  host: ComputerSessionPromptRuntimeHost,
  sessionId: string,
  promptRunId: string
): void {
  const state = host.requireSession(sessionId);
  const promptRun = requirePromptRun(state, promptRunId);
  if (promptRun.status === "completed" && promptRun.completedAt) {
    return;
  }
  promptRun.status = "completed";
  promptRun.completedAt = new Date().toISOString();
  promptRun.updatedAt = promptRun.completedAt;
  host.recordVerifierResult(sessionId, {
    id: `verifier:${promptRun.id}`,
    status: "passed",
    reason: "Browser Action prompt run completed all planned steps.",
    promptRunId,
    stepCount: promptRun.steps.length
  });
  host.transition(sessionId, "completed");
  emitPromptRun(host, sessionId, promptRun);
}

function readPromptRun(
  host: ComputerSessionPromptRuntimeHost,
  sessionId: string,
  promptRunId: string
): ComputerSessionPromptRunSummary {
  return requirePromptRun(host.requireSession(sessionId), promptRunId);
}

function requirePromptRun(
  state: RuntimeSessionState,
  promptRunId: string
): ComputerSessionPromptRunSummary {
  const promptRun = state.promptRuns.find((candidate) => candidate.id === promptRunId);
  if (!promptRun) {
    throw new Error(`Computer session prompt run not found: ${promptRunId}`);
  }
  return promptRun;
}

function findContinuablePromptRun(state: RuntimeSessionState): ComputerSessionPromptRunSummary | undefined {
  return state.promptRuns.find((promptRun) => promptRun.status === "running" || promptRun.status === "awaiting_approval" || promptRun.status === "pending");
}

function recordPromptStepEval(
  host: ComputerSessionPromptRuntimeHost,
  sessionId: string,
  promptRun: ComputerSessionPromptRunSummary,
  step: ComputerSessionPromptStepSummary,
  phase: "started" | "completed"
): void {
  const state = host.requireSession(sessionId);
  if (!state.summary.evalRunId) {
    return;
  }
  host.storage.appendComputerUseEvalStep({
    runId: state.summary.evalRunId,
    kind: "browser_action_prompt_step",
    phase: "action",
    status: phase === "started" && !isPromptStepFinal(step.status) ? "running" : step.status,
    capabilityJobId: step.capabilityJobId,
    capabilityDagNodeId: step.dagNodeId,
    input: {
      promptRunId: promptRun.id,
      planId: promptRun.planId,
      stepId: step.id,
      stepIndex: step.index,
      actionType: step.actionType,
      targetSummary: step.targetSummary
    },
    output: {
      promptStatus: promptRun.status,
      stepStatus: step.status,
      lastError: step.lastError
    },
    failureClass: step.status === "failed" ? "action_failed" : step.status === "cancelled" ? "external_blocker" : "none"
  });
}

function emitPromptRun(
  host: ComputerSessionPromptRuntimeHost,
  sessionId: string,
  promptRun: ComputerSessionPromptRunSummary
): void {
  const state = host.requireSession(sessionId);
  state.summary.updatedAt = new Date().toISOString();
  host.persistSessionState(state);
  host.emit({ type: "computer.session.prompt_run", sessionId, promptRun });
}
