import type { BrowserActionPromptPlan, BrowserActionResult } from "../browser-action/types.js";
import type { AgentToolInvocation, AgentToolResult, AgentToolRuntimeAdapter } from "./types.js";

export const browserActionSimulatedToolRuntime: AgentToolRuntimeAdapter = {
  id: "browser_action.simulated_daemon",
  runtime: "simulated_daemon",
  capability: "browser_action",
  createInvocation(input) {
    return {
      ...input,
      toolId: "browser_action",
      runtime: "simulated_daemon",
      capability: "browser_action"
    };
  }
};

export function createBrowserActionPromptToolInvocation(input: {
  requestId: string;
  sessionId?: string;
  promptPlan: BrowserActionPromptPlan;
  utterance: string;
}): AgentToolInvocation {
  return browserActionSimulatedToolRuntime.createInvocation({
    requestId: input.requestId,
    sessionId: input.sessionId,
    source: "prompt",
    input: {
      planId: input.promptPlan.id,
      goal: input.promptPlan.goal,
      stepCount: input.promptPlan.steps.length,
      mode: input.promptPlan.mode,
      utterancePreview: input.utterance.slice(0, 160)
    },
    redaction: {
      mode: "redacted_input",
      persistedFields: ["planId", "goal", "stepCount", "mode", "utterancePreview"]
    }
  });
}

export function createBrowserActionToolResult(input: {
  invocationId: string;
  result: BrowserActionResult;
  planStatus?: string;
}): AgentToolResult {
  const status = input.result.status === "succeeded" && input.result.verification.status === "passed"
    ? "succeeded"
    : input.result.status === "needs_approval"
      ? "needs_approval"
      : input.result.status === "needs_clarification"
        ? "needs_clarification"
        : input.result.status === "cancelled"
          ? "blocked"
          : "failed";
  return {
    invocationId: input.invocationId,
    status,
    summary: summarizeBrowserActionToolResult(input.result),
    output: {
      action: input.result.action.type,
      resultStatus: input.result.status,
      verificationStatus: input.result.verification.status,
      planStatus: input.planStatus,
      target: input.result.target ? summarizeResultTarget(input.result.target) : undefined,
      url: input.result.after?.url ?? input.result.before?.url
    },
    diagnostics: {
      resultId: input.result.id,
      actionSessionId: input.result.actionSessionId,
      verificationReason: input.result.verification.reason,
      safetyDecision: input.result.safety.decision,
      safetyRisk: input.result.safety.risk
    }
  };
}

function summarizeBrowserActionToolResult(result: BrowserActionResult): string {
  const target = result.target ? ` on ${summarizeResultTarget(result.target)}` : "";
  const page = result.after?.title || result.after?.url || result.before?.title || result.before?.url;
  const suffix = page ? ` (${page})` : "";
  return `Browser action ${result.action.type}${target} ${result.status}; verification=${result.verification.status}${suffix}`.trim();
}

function summarizeResultTarget(target: NonNullable<BrowserActionResult["target"]>): string {
  return (target.label || target.ariaLabel || target.text || target.title || target.id || "target").slice(0, 120);
}
