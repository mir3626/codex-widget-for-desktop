import type { BrowserAction } from "../types.js";
import type { BrowserInteractionRiskClass, IntentFrame } from "./types.js";
import { classifyBrowserActionRisk } from "./contextLease.js";

export function buildIntentFrameFromAction(input: {
  utterance: string;
  action: BrowserAction;
  targetPhrase?: string;
  confidence?: number;
}): IntentFrame {
  return {
    actionFamily: input.action.type,
    targetPhrase: input.targetPhrase,
    valuePhrase: input.action.type === "type" ? input.action.text : undefined,
    constraints: [],
    locale: detectLocale(input.utterance),
    riskHint: classifyBrowserActionRisk(input.action),
    multiStepHints: detectMultiStepHints(input.utterance),
    deicticReferences: detectDeicticReferences(input.utterance),
    confidence: input.confidence ?? 0.7,
    evidenceRefs: []
  };
}

export function detectLocale(text: string): "ko" | "en" | "unknown" {
  if (/[가-힣]/.test(text)) {
    return "ko";
  }
  if (/[a-z]/i.test(text)) {
    return "en";
  }
  return "unknown";
}

export function readActionRiskLabel(action: BrowserAction): BrowserInteractionRiskClass {
  return classifyBrowserActionRisk(action);
}

function detectMultiStepHints(text: string): string[] {
  const hints: string[] = [];
  if (/(하고|한\s*뒤|후에|다음|then|after|and\s+then)/i.test(text)) {
    hints.push("sequential");
  }
  if (/(아무|랜덤|대표|재밌|interesting|random|any)/i.test(text)) {
    hints.push("representative_content");
  }
  return hints;
}

function detectDeicticReferences(text: string): string[] {
  const refs: string[] = [];
  if (/(이거|그거|저거|여기|거기|오른쪽|왼쪽|위|아래|this|that|right|left|top|bottom)/i.test(text)) {
    refs.push("deictic_or_spatial");
  }
  return refs;
}
