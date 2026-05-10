import { buildBrowserObservation } from "../../browser-action/browserObservation.js";
import type { BrowserElement, BrowserObservation } from "../../browser-action/types.js";
import { browserObservationToSemanticSnapshot } from "../adapters/browserActionAdapter.js";
import { buildIntentFrame } from "../intentFrame.js";
import type { IntentFrame, SemanticSnapshot } from "../types.js";

export function browserCase(input: {
  id: string;
  instruction: string;
  reference: string;
  elements: BrowserElement[];
  affordance?: "activate" | "locate" | "read" | "type";
}): { observation: BrowserObservation; snapshot: SemanticSnapshot; intent: IntentFrame } {
  const observation = buildBrowserObservation({
    snapshot: {
      url: `https://example.test/${input.id}`,
      title: input.id,
      capturedAt: "2026-05-08T00:00:00.000Z",
      readyState: "complete",
      text: input.elements.map((element) => element.label ?? element.text ?? "").join(" "),
      elements: input.elements
    },
    now: new Date("2026-05-08T00:00:00.000Z")
  });
  const snapshot = browserObservationToSemanticSnapshot({ observation, now: new Date("2026-05-08T00:00:00.000Z") });
  const intent = buildIntentFrame({
    instruction: input.instruction,
    steps: [{
      affordance: input.affordance ?? "activate",
      reference: input.reference,
      riskBudget: input.affordance === "locate" || input.affordance === "read" ? "read_only" : "state_change"
    }]
  });
  return { observation, snapshot, intent };
}

export function button(id: string, label: string, overrides: Partial<BrowserElement> = {}): BrowserElement {
  return {
    id,
    tagName: "button",
    role: "button",
    label,
    text: label,
    selector: `#${id}`,
    visible: true,
    enabled: true,
    editable: false,
    confidence: 0.93,
    riskHints: [],
    ...overrides
  };
}

export function input(id: string, label: string, overrides: Partial<BrowserElement> = {}): BrowserElement {
  return {
    id,
    tagName: "input",
    role: "textbox",
    label,
    placeholder: label,
    selector: `#${id}`,
    visible: true,
    enabled: true,
    editable: true,
    confidence: 0.9,
    riskHints: [],
    ...overrides
  };
}
