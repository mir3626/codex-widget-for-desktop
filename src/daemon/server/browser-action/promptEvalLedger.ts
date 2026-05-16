import type {
  ComputerUseEvalRunSummary,
  ComputerUseFailureClass,
  ComputerUseTaskSuccess
} from "../../../shared/protocol.js";
import type {
  BrowserActionPlan,
  BrowserActionResult
} from "../../browser-action/index.js";
import { summarizeCapabilityTimings } from "../../capability-transaction/index.js";
import {
  finalizeEvalRunFromSteps,
  rollupComputerUseEvalMetrics
} from "../../computer-use-eval/index.js";
import type { StorageService } from "../../storage/storage.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";

export type BrowserActionPromptEvalContext = {
  evalRunId: string;
  perceptionGraphId: string;
  transactionId: string;
};

export type BrowserActionPromptTimingSource = {
  timings: Parameters<typeof summarizeCapabilityTimings>[0];
};

export function recordPromptBrowserActionEvalCheckpoint(input: {
  storage: StorageService;
  sessionId: string;
  context: BrowserActionPromptEvalContext;
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
  timingSource?: BrowserActionPromptTimingSource;
  terminal: boolean;
}): ComputerUseEvalRunSummary | undefined {
  const timingSummary = input.timingSource ? summarizeCapabilityTimings(input.timingSource.timings) : {};
  const latestResult = input.results.at(-1);
  const actionCount = input.results.filter((result) => result.status === "succeeded").length;
  const failedResultCount = input.results.filter((result) => result.status === "failed" || result.status === "cancelled").length;
  const pendingResultCount = input.results.filter((result) => result.status === "pending" || result.status === "needs_approval" || result.status === "needs_clarification").length;
  const failureClass = input.terminal ? readPromptFailureClass(input.plan, latestResult) : undefined;

  input.storage.appendComputerUseEvalStep({
    runId: input.context.evalRunId,
    kind: "browser_action_plan",
    phase: input.terminal ? "verifying" : "executing",
    status: input.terminal ? input.plan.status : "paused",
    perceptionGraphId: input.context.perceptionGraphId,
    input: {
      planId: input.plan.id,
      stepCount: input.plan.steps.length
    },
    output: {
      planStatus: input.plan.status,
      resultCount: input.results.length,
      actionCount,
      succeededActionCount: actionCount,
      failedResultCount,
      pendingResultCount,
      latestStatus: latestResult?.status,
      latestVerification: latestResult?.verification,
      timingSummary,
      results: input.results.map((result) => ({
        id: result.id,
        status: result.status,
        action: result.action.type,
        verification: result.verification.status,
        target: result.target?.label || result.target?.text || result.target?.id,
        capabilityTransactionId: result.transaction?.transactionId,
        capabilityCandidateId: result.transaction?.candidateId
      }))
    },
    startedAt: input.plan.createdAt,
    completedAt: new Date().toISOString(),
    failureClass
  });

  if (!input.terminal) {
    return undefined;
  }

  return finalizeEvalRunFromSteps({
    storage: input.storage,
    runId: input.context.evalRunId,
    status: readPromptEvalStatus(input.plan),
    taskSuccess: readPromptTaskSuccess(input.plan, latestResult),
    failureClass
  });
}

export function recordPromptBrowserActionTimingSummary(input: {
  storage: StorageService;
  sessionId: string;
  context: BrowserActionPromptEvalContext;
  plan: BrowserActionPlan;
  timingSource?: BrowserActionPromptTimingSource;
  completedEval: ComputerUseEvalRunSummary;
}): void {
  const timingSummary = input.timingSource ? summarizeCapabilityTimings(input.timingSource.timings) : {};
  recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", "Browser Action timing summary", {
    transactionId: input.context.transactionId,
    planStatus: input.plan.status,
    timings: timingSummary,
    evalRunId: input.completedEval.id,
    evalMetrics: rollupComputerUseEvalMetrics(input.storage.listComputerUseEvalRuns({ scenarioId: input.completedEval.scenarioId, limit: 50 }))
  });
}

function readPromptEvalStatus(plan: BrowserActionPlan): ComputerUseEvalRunSummary["status"] {
  if (plan.status === "completed") {
    return "completed";
  }
  if (plan.status === "cancelled") {
    return "cancelled";
  }
  return "failed";
}

function readPromptTaskSuccess(plan: BrowserActionPlan, latestResult: BrowserActionResult | undefined): ComputerUseTaskSuccess {
  if (plan.status === "completed") {
    return "passed";
  }
  if (plan.status === "awaiting_approval" || latestResult?.status === "needs_approval") {
    return "unknown";
  }
  if (latestResult?.status === "needs_clarification") {
    return "abstained";
  }
  return "failed";
}

function readPromptFailureClass(plan: BrowserActionPlan, latestResult: BrowserActionResult | undefined): ComputerUseFailureClass {
  if (plan.status === "completed") {
    return "none";
  }
  if (plan.status === "awaiting_approval" || latestResult?.status === "needs_approval") {
    return "approval_denied";
  }
  if (latestResult?.status === "needs_clarification") {
    return "ambiguous_target";
  }
  if (plan.status === "cancelled" || latestResult?.status === "cancelled") {
    return "unknown";
  }
  if (/timeout|did not pick up|deadline/i.test(`${latestResult?.error ?? ""} ${latestResult?.verification?.reason ?? ""}`)) {
    return "timeout";
  }
  if (/restricted/i.test(`${latestResult?.error ?? ""} ${latestResult?.verification?.reason ?? ""}`)) {
    return "restricted_surface";
  }
  if (/unsafe|block/i.test(`${latestResult?.error ?? ""} ${latestResult?.verification?.reason ?? ""}`)) {
    return "unsafe_action_rejected";
  }
  return "action_failed";
}
