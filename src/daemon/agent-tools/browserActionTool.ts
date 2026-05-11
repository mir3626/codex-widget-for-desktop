import type { BrowserActionPromptPlan } from "../browser-action/types.js";
import type { AgentToolInvocation, AgentToolRuntimeAdapter } from "./types.js";

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

