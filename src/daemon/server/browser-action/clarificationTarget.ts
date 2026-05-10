import {
  summarizeBrowserElement,
  type BrowserAction,
  type BrowserElement
} from "../../browser-action/index.js";
import type { PendingSemanticClarification } from "./clarificationTypes.js";

export function selectSemanticClarificationCandidate(
  pending: PendingSemanticClarification,
  choice: string | undefined
): BrowserElement | undefined {
  const normalized = String(choice ?? "").trim();
  if (!normalized) {
    return pending.candidates[0];
  }
  const index = Number(normalized.replace(/[^\d]/g, ""));
  if (Number.isInteger(index) && index >= 1 && index <= pending.candidates.length) {
    return pending.candidates[index - 1];
  }
  const lower = normalized.toLowerCase();
  return pending.candidates.find((candidate) => {
    const summary = summarizeBrowserElement(candidate).toLowerCase();
    return summary.includes(lower) || candidate.id.toLowerCase() === lower;
  });
}

export function retargetBrowserAction(action: BrowserAction, selected: BrowserElement): BrowserAction {
  const target = { kind: "element_id" as const, id: selected.id };
  if (action.type === "click") return { ...action, target };
  if (action.type === "type") return { ...action, target };
  if (action.type === "select") return { ...action, target };
  if (action.type === "check") return { ...action, target };
  if (action.type === "scroll") return { ...action, target };
  if (action.type === "evaluate" && action.target) return { ...action, target };
  return action;
}

export function uniqueBrowserElements(elements: Array<BrowserElement | undefined>): BrowserElement[] {
  const seen = new Set<string>();
  const output: BrowserElement[] = [];
  for (const element of elements) {
    if (!element || seen.has(element.id)) {
      continue;
    }
    seen.add(element.id);
    output.push(element);
  }
  return output;
}
