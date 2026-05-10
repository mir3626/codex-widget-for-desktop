import {
  normalizeModelId,
  normalizeReasoningEffort
} from "../../shared/protocol.js";
import type { AgentSelection } from "../codexRuntime.js";
import type { AgentRequest } from "../agent.js";

export function resolveAgentSelection(request: AgentRequest): AgentSelection {
  return {
    model: normalizeModelId(request.model ?? process.env.CODEX_WIDGET_MODEL),
    reasoningEffort: normalizeReasoningEffort(request.reasoningEffort ?? process.env.CODEX_WIDGET_REASONING_EFFORT)
  };
}
