import { summarizeBrowserElement } from "./browserObservation.js";
import type { BrowserElement, ElementGraph, ElementTarget, Rect, TargetResolution } from "./types.js";

export function resolveTarget(input: {
  graph: ElementGraph;
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

  const hint = clean(input.hint || (input.target?.kind === "text" ? input.target.text : undefined));
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
  return {
    primary,
    alternatives: ranked.slice(1, 5).map((item) => item.element),
    confidence: ambiguous ? Math.min(0.68, topScore) : topScore,
    reason: primary
      ? ambiguous
        ? `Target hint is ambiguous; closest match is ${summarizeBrowserElement(primary)}.`
        : `Matched target hint against ${summarizeBrowserElement(primary)}.`
      : "No element matched the requested target with useful confidence."
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
  const fields = [
    element.role,
    element.label,
    element.ariaLabel,
    element.placeholder,
    element.text,
    element.title,
    element.value,
    element.href
  ].map(clean);
  for (const field of fields) {
    if (!field) {
      continue;
    }
    if (field === hint) {
      score = Math.max(score, 0.94);
    } else if (field.includes(hint) || hint.includes(field)) {
      score = Math.max(score, 0.78);
    } else if (hint.split(/\s+/).some((part) => part.length > 2 && field.includes(part))) {
      score = Math.max(score, 0.46);
    }
  }
  if (target?.kind === "text" && target.role && clean(element.role) === clean(target.role)) {
    score += 0.12;
  }
  if (element.enabled) {
    score += 0.04;
  }
  return Math.min(0.99, score);
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
