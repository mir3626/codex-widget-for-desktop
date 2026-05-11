import type {
  BrowserActionPlan,
  BrowserActionResult
} from "../../browser-action/index.js";

export function markPromptPlanStepFromResult(plan: BrowserActionPlan, result: BrowserActionResult): BrowserActionPlan {
  const step = plan.steps.find((item) => item.resultId === result.id) ?? plan.steps.find((item) => item.status === "awaiting_extension" || item.status === "running");
  if (!step) {
    return plan;
  }
  step.resultId = result.id;
  step.error = result.error;
  step.completedAt = result.completedAt ?? new Date().toISOString();
  if (result.status === "succeeded") {
    step.status = "succeeded";
  } else if (result.status === "cancelled") {
    step.status = "cancelled";
    plan.status = "cancelled";
  } else {
    step.status = "failed";
    plan.status = "failed";
    plan.summary = `Plan stopped at ${step.id}: ${result.error ?? result.verification.reason}`;
  }
  if (plan.status !== "failed" && plan.status !== "cancelled") {
    plan.status = plan.steps.every((item) => item.status === "succeeded" || item.status === "skipped") ? "completed" : "running";
  }
  return plan;
}

export function preparePromptStepRetryAfterSourceRefresh(plan: BrowserActionPlan, result: BrowserActionResult): boolean {
  if (!isSourceRefreshRetryable(result)) {
    return false;
  }
  const step = plan.steps.find((item) => item.resultId === result.id) ?? plan.steps.find((item) => item.status === "awaiting_extension" || item.status === "running");
  if (!step || (step.attempts ?? 0) >= 2) {
    return false;
  }
  step.status = "pending";
  step.resultId = undefined;
  step.error = undefined;
  step.completedAt = undefined;
  step.safety = undefined;
  plan.status = "running";
  plan.summary = `Retrying ${step.id} after refreshing the active browser view.`;
  return true;
}

function isSourceRefreshRetryable(result: BrowserActionResult): boolean {
  if (isHistoryNavigationAction(result)) {
    return false;
  }
  if (result.status !== "failed" || !result.after) {
    return false;
  }
  const reason = `${result.error ?? ""} ${result.verification?.reason ?? ""}`;
  return /Active tab URL changed before Browser Action execution|Active tab mismatch|Active window mismatch/i.test(reason);
}

function isHistoryNavigationAction(result: BrowserActionResult): boolean {
  return result.action.type === "back" || result.action.type === "forward" || result.action.type === "reload";
}
