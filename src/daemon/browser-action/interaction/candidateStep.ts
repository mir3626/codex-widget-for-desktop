import { randomUUID } from "node:crypto";
import { normalizeBrowserTargetText, tokenizeBrowserTargetText } from "../targetLexicon.js";
import type {
  BrowserAction,
  BrowserElement,
  BrowserExpectedState,
  ElementGraph,
  ElementTarget
} from "../types.js";
import type { BrowserViewContextLease, CandidateStep, ReferenceBindingScope } from "./types.js";
import { classifyBrowserActionRisk } from "./contextLease.js";

export function generateCandidateSteps(input: {
  action: BrowserAction;
  graph: ElementGraph;
  target?: ElementTarget;
  hint?: string;
  lease?: BrowserViewContextLease;
  stepIndex?: number;
  expected?: BrowserExpectedState[];
  memoryEvidence?: CandidateStep["memoryEvidence"];
}): CandidateStep[] {
  if (!requiresElementTarget(input.action)) {
    return [createSyntheticCandidate(input, "current_view", "이 작업은 특정 페이지 요소가 필요하지 않습니다.", 1)];
  }
  const hint = normalizeBrowserTargetText(input.hint || (input.target?.kind === "text" ? input.target.text : undefined) || "");
  const candidates = input.graph.elements
    .filter((element) => element.visible)
    .map((element) => scoreElementCandidate({ ...input, element, hint }))
    .filter((candidate) => candidate.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence || (a.element?.sourceOrder ?? 999999) - (b.element?.sourceOrder ?? 999999));
  return candidates.slice(0, 8).map((candidate, index) => ({
    ...candidate,
    alternatives: candidates.filter((other) => other.candidateId !== candidate.candidateId).slice(0, 4).map((other) => other.candidateId),
    reasonCodes: [...candidate.reasonCodes, index === 0 ? "top_candidate" : "alternative_candidate"]
  }));
}

export function expectedEffectsForAction(action: BrowserAction): BrowserExpectedState[] {
  if (action.type === "navigate") {
    return [{ type: "url_contains", value: action.url }];
  }
  if (action.type === "type") {
    return [
      { type: "element_state", target: action.target, state: { value: action.text } },
      { type: "custom", description: action.submit ? "Typed value is submitted as requested." : "Field value changes without implicit submit/navigation." }
    ];
  }
  if (action.type === "click") {
    return [{ type: "custom", description: "Target activation produces the expected visible page, route, selection, or content change." }];
  }
  if (action.type === "check") {
    return [{ type: "element_state", target: action.target, state: { checked: action.checked } }];
  }
  if (action.type === "select") {
    return [{ type: "element_state", target: action.target, state: { value: action.value } }];
  }
  if (action.type === "back" || action.type === "forward") {
    return [{ type: "navigation_complete" }];
  }
  if (action.type === "reload") {
    return [{ type: "network_idle" }];
  }
  return [];
}

function createSyntheticCandidate(input: {
  action: BrowserAction;
  lease?: BrowserViewContextLease;
  stepIndex?: number;
  expected?: BrowserExpectedState[];
  memoryEvidence?: CandidateStep["memoryEvidence"];
}, scope: ReferenceBindingScope, label: string, confidence: number): CandidateStep {
  return {
    candidateId: `browser-candidate-${randomUUID()}`,
    leaseId: input.lease?.leaseId,
    contextId: input.lease?.contextId,
    viewRevision: input.lease?.viewRevision,
    graphDigest: input.lease?.graphDigest,
    stepIndex: input.stepIndex ?? 0,
    action: input.action,
    referenceBindingScope: scope,
    label,
    localeLabel: label,
    expectedEffect: input.expected ?? expectedEffectsForAction(input.action),
    riskClass: classifyBrowserActionRisk(input.action),
    confidence,
    scoreBreakdown: { synthetic: confidence },
    alternatives: [],
    reasonCodes: ["no_element_target_required"],
    memoryEvidence: input.memoryEvidence,
    safetyHints: []
  };
}

function scoreElementCandidate(input: {
  action: BrowserAction;
  element: BrowserElement;
  hint: string;
  lease?: BrowserViewContextLease;
  stepIndex?: number;
  expected?: BrowserExpectedState[];
  memoryEvidence?: CandidateStep["memoryEvidence"];
}): CandidateStep {
  const label = readElementLabel(input.element);
  const normalizedLabel = normalizeBrowserTargetText(label);
  const normalizedContext = normalizeBrowserTargetText(input.element.contextText || "");
  const tokens = new Set(tokenizeBrowserTargetText(`${label} ${input.element.contextText ?? ""}`));
  const hintTokens = tokenizeBrowserTargetText(input.hint);
  const scoreBreakdown: Record<string, number> = {};
  const reasonCodes: string[] = [];
  let score = 0;

  if (!input.element.visible) {
    score -= 0.5;
  }
  if (!input.element.enabled) {
    score -= 0.2;
  }
  if (input.hint) {
    if (normalizedLabel === input.hint) {
      score += 0.48;
      scoreBreakdown.exact_label = 0.48;
      reasonCodes.push("exact_label");
    } else if (normalizedLabel.includes(input.hint) || input.hint.includes(normalizedLabel)) {
      score += 0.3;
      scoreBreakdown.partial_label = 0.3;
      reasonCodes.push("partial_label");
    }
    const tokenHits = hintTokens.filter((token) => tokens.has(token)).length;
    if (tokenHits > 0) {
      const value = Math.min(0.24, tokenHits * 0.08);
      score += value;
      scoreBreakdown.token_overlap = value;
      reasonCodes.push("token_overlap");
    }
    if (normalizedContext && (normalizedContext.includes(input.hint) || hintTokens.some((token) => normalizedContext.includes(token)))) {
      score += 0.12;
      scoreBreakdown.context_text = 0.12;
      reasonCodes.push("context_text");
    }
  } else {
    score += 0.08;
    scoreBreakdown.visible_default = 0.08;
  }

  const roleScore = scoreRoleFit(input.action, input.element);
  score += roleScore;
  if (roleScore > 0) {
    scoreBreakdown.role_fit = roleScore;
    reasonCodes.push("role_fit");
  }

  if (isRepresentativeContentRequest(input.hint, input.action) && looksLikeContentElement(input.element)) {
    score += 0.22;
    scoreBreakdown.representative_content = 0.22;
    reasonCodes.push("representative_content");
  }

  if (input.element.selected || input.element.checked) {
    score += input.action.type === "click" ? 0.03 : 0.01;
  }
  if (input.element.riskHints.length > 0) {
    score -= 0.08;
    reasonCodes.push("risk_hint_present");
  }

  const confidence = Math.max(0, Math.min(0.98, score + Math.min(0.12, input.element.confidence * 0.12)));
  return {
    candidateId: `browser-candidate-${randomUUID()}`,
    leaseId: input.lease?.leaseId,
    contextId: input.lease?.contextId,
    viewRevision: input.lease?.viewRevision,
    graphDigest: input.lease?.graphDigest,
    stepIndex: input.stepIndex ?? 0,
    action: input.action,
    targetRef: input.element.id,
    element: input.element,
    referenceBindingScope: isRepresentativeContentRequest(input.hint, input.action) ? "content_list_representative" : "current_view",
    label: label || input.element.id,
    localeLabel: buildLocaleLabel(input.element, label),
    role: input.element.role,
    region: input.element.nearestLandmark,
    expectedEffect: input.expected ?? expectedEffectsForAction(input.action),
    riskClass: classifyBrowserActionRisk(input.action),
    confidence,
    scoreBreakdown,
    alternatives: [],
    reasonCodes,
    memoryEvidence: input.memoryEvidence,
    safetyHints: input.element.riskHints
  };
}

function requiresElementTarget(action: BrowserAction): boolean {
  return action.type === "click" || action.type === "type" || action.type === "select" || action.type === "check";
}

function readElementLabel(element: BrowserElement): string {
  return (element.label || element.ariaLabel || element.text || element.placeholder || element.title || element.value || "").trim();
}

function scoreRoleFit(action: BrowserAction, element: BrowserElement): number {
  const role = `${element.role ?? ""} ${element.tagName ?? ""} ${element.inputType ?? ""}`.toLowerCase();
  if (action.type === "type") {
    return element.editable || /input|textarea|searchbox|textbox/.test(role) ? 0.32 : -0.08;
  }
  if (action.type === "select") {
    return /select|combobox|listbox|option/.test(role) ? 0.28 : 0;
  }
  if (action.type === "check") {
    return /checkbox|radio/.test(role) ? 0.28 : 0;
  }
  if (action.type === "click") {
    if (/button|link|tab|menuitem|summary/.test(role)) {
      return 0.2;
    }
    if (element.href) {
      return 0.16;
    }
  }
  return 0;
}

function looksLikeContentElement(element: BrowserElement): boolean {
  const role = `${element.role ?? ""} ${element.tagName ?? ""}`.toLowerCase();
  const text = `${element.text ?? ""} ${element.contextText ?? ""}`.trim();
  return Boolean(element.href || /link|article|row/.test(role)) && text.length >= 8 && !/(로그인|설정|검색|댓글|profile|login|setting|comment)/i.test(text);
}

function isRepresentativeContentRequest(hint: string, action: BrowserAction): boolean {
  if (action.type !== "click") {
    return false;
  }
  return /(아무|랜덤|대표|재밌|흥미|글|게시글|포스트|article|post|interesting|random|any)/i.test(hint);
}

function buildLocaleLabel(element: BrowserElement, label: string): string {
  const role = element.role ? `${element.role} ` : "";
  const region = element.nearestLandmark ? ` (${element.nearestLandmark})` : "";
  return `${role}"${label || element.id}"${region}`.trim();
}
