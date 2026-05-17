import type { SemanticMemoryStore } from "../../semantic-interface/memory/types.js";
import type { BrowserActionResult } from "../types.js";
import type { BrowserInteractionTransaction, CandidateStep, IntentFrame } from "./types.js";

export function publishBrowserInteractionFeedback(input: {
  enabled: boolean;
  semanticMemory?: SemanticMemoryStore;
  transaction?: BrowserInteractionTransaction;
  intentFrame?: IntentFrame;
  candidates?: CandidateStep[];
  result: BrowserActionResult;
  utterance?: string;
}): void {
  if (!input.enabled || !input.semanticMemory) {
    return;
  }
  const result = input.result;
  const observation = result.after ?? result.before;
  const phrase = input.intentFrame?.targetPhrase || input.utterance;
  const selectedTarget = result.target?.id || result.target?.label || result.target?.text;
  input.semanticMemory.recordFeedbackEvent({
    source: result.status === "succeeded" && result.verification.status === "passed" ? "verified_success" : "verification_failure",
    surface: "browser_page",
    scope: {
      surface: "browser_page",
      origin: safeOrigin(observation?.url),
      viewPattern: readSemanticMemoryViewPattern(observation)
    },
    utterance: input.utterance ?? input.transaction?.utterance,
    redactedUtterance: redactShort(input.utterance ?? input.transaction?.utterance),
    payload: {
      phrase: phrase ? redactShort(phrase) : undefined,
      selectedTarget,
      action: result.action.type,
      preferredRole: result.target?.role,
      preferredRegion: result.target?.nearestLandmark,
      safetyClass: result.safety.risk === "high" ? "risky_requires_approval" : result.safety.risk === "medium" ? "safe_action" : "safe_read"
    }
  });
}

function safeOrigin(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function readSemanticMemoryViewPattern(observation: BrowserActionResult["after"] | BrowserActionResult["before"]): string | undefined {
  const route = observation?.viewGraph?.identity.route;
  if (route?.trim()) {
    try {
      return new URL(route).pathname || undefined;
    } catch {
      return route;
    }
  }
  if (observation?.url) {
    try {
      return new URL(observation.url).pathname || undefined;
    } catch {
      return undefined;
    }
  }
  return observation?.source.routeKey;
}

function redactShort(value: string | undefined): string | undefined {
  return value?.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").replace(/\d{4,}/g, "[number]").slice(0, 160);
}
