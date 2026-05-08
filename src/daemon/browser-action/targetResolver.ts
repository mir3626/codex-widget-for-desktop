import { summarizeBrowserElement } from "./browserObservation.js";
import { compactText, expandBrowserTargetAliases, normalizeBrowserTargetText, tokenizeBrowserTargetText } from "./targetLexicon.js";
import { resolveBrowserActionTargetSemantically } from "../semantic-interface/adapters/browserActionTargetResolver.js";
import type { BrowserAction, BrowserElement, BrowserObservation, ElementGraph, ElementTarget, Rect, TargetResolution } from "./types.js";

export function resolveTarget(input: {
  graph: ElementGraph;
  observation?: BrowserObservation;
  action?: BrowserAction;
  target?: ElementTarget;
  hint?: string;
}): TargetResolution {
  const elements = input.graph.elements.filter((element) => element.visible);
  if (elements.length === 0) {
    return { alternatives: [], confidence: 0, reason: "No visible browser elements are available." };
  }

  const explicit = resolveExplicitTarget(elements, input.target, input.graph.focusedElementId);
  if (explicit.primary) {
    return explicit;
  }

  const hint = normalizeBrowserTargetText(input.hint || (input.target?.kind === "text" ? input.target.text : undefined));
  if (!hint) {
    const alternatives = elements.slice(0, 5);
    return {
      primary: alternatives[0],
      alternatives: alternatives.slice(1),
      confidence: alternatives[0]?.confidence ? Math.min(0.55, alternatives[0].confidence) : 0.35,
      reason: "No target hint was provided; using the first visible candidate as low-confidence fallback."
    };
  }

  const ranked = elements
    .map((element) => ({ element, score: scoreElement(element, hint, input.target) }))
    .filter((item) => item.score > 0.08)
    .sort((left, right) => right.score - left.score);
  const primary = ranked[0]?.element;
  const topScore = ranked[0]?.score ?? 0;
  const secondScore = ranked[1]?.score ?? 0;
  const ambiguous = primary && secondScore > 0 && Math.abs(topScore - secondScore) < 0.08;
  const lexical: TargetResolution = {
    primary,
    alternatives: ranked.slice(1, 5).map((item) => item.element),
    confidence: ambiguous ? Math.min(0.68, topScore) : topScore,
    reason: primary
      ? ambiguous
        ? `Target hint is ambiguous; closest match is ${summarizeBrowserElement(primary)}.`
        : `Matched target hint against ${summarizeBrowserElement(primary)}.`
      : "No element matched the requested target with useful confidence."
  };
  const semantic = input.observation
    ? resolveBrowserActionTargetSemantically({
        observation: input.observation,
        action: input.action,
        target: input.target,
        hint: input.hint
      })
    : undefined;
  return chooseResolution({ lexical, semantic });
}

function chooseResolution(input: { lexical: TargetResolution; semantic?: TargetResolution }): TargetResolution {
  if (!input.semantic?.primary) {
    return input.semantic?.semantic
      ? { ...input.lexical, semantic: input.semantic.semantic }
      : input.lexical;
  }
  if (!input.lexical.primary || input.lexical.confidence < 0.75) {
    return input.semantic.confidence >= 0.75 ? input.semantic : { ...input.lexical, semantic: input.semantic.semantic };
  }
  if (input.lexical.primary.id === input.semantic.primary.id) {
    return {
      ...input.lexical,
      confidence: Math.max(input.lexical.confidence, input.semantic.confidence),
      reason: `${input.lexical.reason} Semantic Interface confirmed the same target.`,
      semantic: input.semantic.semantic
    };
  }
  if (input.semantic.confidence >= input.lexical.confidence + 0.08) {
    return input.semantic;
  }
  return {
    ...input.lexical,
    semantic: input.semantic.semantic
  };
}

function resolveExplicitTarget(elements: BrowserElement[], target: ElementTarget | undefined, focusedElementId: string | undefined): TargetResolution {
  if (!target) {
    return { alternatives: [], confidence: 0, reason: "No explicit target." };
  }
  if (target.kind === "element_id") {
    const primary = elements.find((element) => element.id === target.id);
    return {
      primary,
      alternatives: [],
      confidence: primary ? 0.98 : 0,
      reason: primary ? "Resolved exact element id." : `Element id not found: ${target.id}`
    };
  }
  if (target.kind === "selector") {
    const primary = elements.find((element) => element.selector === target.selector);
    return {
      primary,
      alternatives: [],
      confidence: primary ? 0.9 : 0,
      reason: primary ? "Resolved exact selector." : `Selector not found in observation: ${target.selector}`
    };
  }
  if (target.kind === "focused") {
    const primary = focusedElementId
      ? elements.find((element) => element.id === focusedElementId)
      : elements.find((element) => element.selected || element.editable && element.confidence > 0.9);
    return {
      primary,
      alternatives: elements.filter((element) => element.editable).slice(0, 4),
      confidence: primary ? 0.8 : 0,
      reason: primary ? "Resolved focused or selected editable element." : "No focused element is recorded."
    };
  }
  if (target.kind === "bbox") {
    const ranked = elements
      .map((element) => ({ element, score: scoreBbox(element.bbox, target.bbox) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    return {
      primary: ranked[0]?.element,
      alternatives: ranked.slice(1, 5).map((item) => item.element),
      confidence: ranked[0]?.score ?? 0,
      reason: ranked[0] ? "Resolved spatial bbox overlap." : "No element overlaps the provided bbox."
    };
  }
  return { alternatives: [], confidence: 0, reason: "Text target is resolved by ranked matching." };
}

function scoreElement(element: BrowserElement, hint: string, target: ElementTarget | undefined): number {
  let score = 0;
  const aliases = expandBrowserTargetAliases(hint);
  const tokens = new Set(aliases.flatMap((alias) => tokenizeBrowserTargetText(alias)));
  const fields = [
    element.role,
    element.label,
    element.ariaLabel,
    element.placeholder,
    element.text,
    element.title,
    element.value,
    element.href
  ].map((field) => normalizeBrowserTargetText(field));
  for (const field of fields) {
    if (!field) {
      continue;
    }
    const fieldCompact = compactText(field);
    for (const alias of aliases.length > 0 ? aliases : [hint]) {
      const aliasCompact = compactText(alias);
      if (!alias) {
        continue;
      }
      if (field === alias || fieldCompact === aliasCompact) {
        score = Math.max(score, 0.94);
      } else if (field.includes(alias)) {
        score = Math.max(score, alias.length >= 2 ? 0.86 : 0.52);
      } else if (alias.includes(field) && field.length >= 2) {
        score = Math.max(score, 0.72);
      } else if (fieldCompact.includes(aliasCompact) && aliasCompact.length >= 2) {
        score = Math.max(score, 0.82);
      } else if (aliasCompact.includes(fieldCompact) && fieldCompact.length >= 2) {
        score = Math.max(score, 0.68);
      }
    }
    const fieldTokens = tokenizeBrowserTargetText(field);
    const matchedTokens = fieldTokens.filter((token) => tokens.has(token));
    if (matchedTokens.length > 0) {
      const coverage = matchedTokens.length / Math.max(1, tokens.size);
      score = Math.max(score, Math.min(0.74, 0.4 + coverage * 0.28));
    }
  }
  if (target?.kind === "text" && target.role && clean(element.role) === clean(target.role)) {
    score += 0.12;
  }
  if (element.enabled) {
    score += 0.04;
  }
  if (target?.kind === "text" && !isActionableTargetCandidate(element)) {
    score = Math.min(score, 0.58);
  }
  return Math.min(0.99, score);
}

function isActionableTargetCandidate(element: BrowserElement): boolean {
  const role = clean(element.role);
  const tag = clean(element.tagName);
  return element.editable ||
    Boolean(element.href) ||
    ["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "option", "menuitem", "tab", "switch"].includes(role) ||
    ["a", "button", "input", "textarea", "select", "option", "summary", "label"].includes(tag);
}

function scoreBbox(left: Rect | undefined, right: Rect): number {
  if (!left) {
    return 0;
  }
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.w, right.x + right.w);
  const y2 = Math.min(left.y + left.h, right.y + right.h);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const rightArea = Math.max(1, right.w * right.h);
  return Math.min(0.95, overlap / rightArea);
}

function clean(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
