import type { BrowserActionPlan } from "../../browser-action/index.js";

export function summarizeBrowserActionPlan(plan: BrowserActionPlan): Record<string, unknown> {
  return {
    id: plan.id,
    actionSessionId: plan.actionSessionId,
    goal: plan.goal,
    adapterId: plan.adapterId,
    status: plan.status,
    confidence: plan.confidence,
    summary: plan.summary,
    steps: plan.steps.map((step) => ({
      id: step.id,
      action: step.action.type,
      status: step.status,
      targetSummary: step.targetSummary,
      safety: step.safety?.decision,
      risk: step.safety?.risk,
      reason: step.reason,
      resultId: step.resultId,
      error: step.error
    }))
  };
}
