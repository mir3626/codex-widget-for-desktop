import type { ClarificationDecision, ResolvedIntent } from "../vision-context/types.js";
import { isDestructiveIntent } from "../vision-context/intentResolver.js";
import type { ActionSlotConfidence } from "./types.js";

export function decideClarification(input: {
  utterance: string;
  intent: ResolvedIntent;
  referenceConfidence: number;
  slots: ActionSlotConfidence;
}): ClarificationDecision {
  const destructive = isDestructiveIntent(input.intent, input.utterance);
  const criticalSlotConfidence = Math.min(input.slots.target, input.slots.action);
  if (destructive && (input.referenceConfidence < 0.65 || criticalSlotConfidence < 0.6)) {
    return {
      action: "inline_confirmation",
      prompt: "Confirm the target before continuing.",
      options: ["Use the highlighted target", "Cancel"]
    };
  }
  if (input.referenceConfidence < 0.65 && input.intent.kind !== "unknown") {
    return { action: "agent_can_ask", reason: "The agent should present candidates or ask a short follow-up if needed." };
  }
  return { action: "none" };
}
