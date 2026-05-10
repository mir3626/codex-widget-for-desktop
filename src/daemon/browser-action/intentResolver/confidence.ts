import type { BrowserActionIntent } from "../types.js";

export function readIntentConfidence(input: {
  targetPhrase?: string;
  typedText?: string;
  actionType: BrowserActionIntent["actionType"];
}): number {
  if (input.actionType === "read" || input.actionType === "back" || input.actionType === "forward" || input.actionType === "reload") {
    return 0.86;
  }
  if (input.actionType === "navigate") {
    return 0.88;
  }
  if ((input.actionType === "type" || input.actionType === "select") && input.typedText && input.targetPhrase) {
    return 0.84;
  }
  if (input.actionType === "click" && input.targetPhrase) {
    return 0.84;
  }
  return 0.72;
}
