import {
  summarizeBrowserElement,
  type BrowserAction,
  type BrowserElement
} from "../../browser-action/index.js";
import type {
  SemanticAffordance,
  SemanticMemoryScope,
  SemanticMemoryStore
} from "../../semantic-interface/index.js";
import type { PendingSemanticClarification } from "./clarificationTypes.js";

export function recordSemanticClarificationFeedback(input: {
  semanticMemory: SemanticMemoryStore;
  pending: PendingSemanticClarification;
  selected: BrowserElement;
}): void {
  try {
    const rejected = input.pending.candidates.find((candidate) => candidate.id !== input.selected.id);
    input.semanticMemory.recordFeedbackEvent({
      source: "clarification_selected",
      surface: "browser_page",
      scope: semanticMemoryScopeForBrowserObservation(input.pending),
      utterance: input.pending.utterance,
      payload: {
        phrase: input.pending.targetHint,
        selectedTarget: summarizeBrowserElement(input.selected),
        rejectedTarget: rejected ? summarizeBrowserElement(rejected) : undefined,
        preferredRole: input.selected.role || input.selected.tagName,
        preferredAffordance: semanticAffordanceForBrowserAction(input.pending.action),
        action: `browser.${input.pending.action.type}`,
        safetyClass: "safe_action"
      }
    });
  } catch {
    // Semantic Memory is advisory. A feedback write failure must not block the chosen browser action.
  }
}

function semanticMemoryScopeForBrowserObservation(pending: PendingSemanticClarification): SemanticMemoryScope {
  const scope: SemanticMemoryScope = { surface: "browser_page" };
  const observationUrl = pending.observationUrl;
  try {
    const parsed = observationUrl ? new URL(observationUrl) : undefined;
    if (parsed?.origin && parsed.origin !== "null") {
      scope.origin = parsed.origin;
      scope.viewPattern = parsed.pathname || "/";
    }
  } catch {
    // Candidate hrefs are optional and can be relative; unresolved scope remains page-surface local.
  }
  return scope;
}

function semanticAffordanceForBrowserAction(action: BrowserAction): SemanticAffordance {
  if (action.type === "type") return "type";
  if (action.type === "navigate" || action.type === "back" || action.type === "forward" || action.type === "reload") return "navigate";
  if (action.type === "read" || action.type === "screenshot") return "read";
  if (action.type === "select" || action.type === "check") return "activate";
  return "activate";
}
