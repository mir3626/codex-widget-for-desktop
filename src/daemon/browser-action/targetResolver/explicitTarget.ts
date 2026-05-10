import type {
  BrowserElement,
  ElementTarget,
  Rect,
  TargetResolution
} from "../types.js";

export function resolveExplicitTarget(
  elements: BrowserElement[],
  target: ElementTarget | undefined,
  focusedElementId: string | undefined
): TargetResolution {
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
