import { summarizeBrowserElement } from "../browserObservation.js";
import {
  compactText,
  expandBrowserTargetAliases,
  normalizeBrowserTargetText,
  tokenizeBrowserTargetText
} from "../targetLexicon.js";
import type {
  BrowserElement,
  ElementTarget,
  TargetResolution
} from "../types.js";

export function resolveLexicalTarget(input: {
  elements: BrowserElement[];
  hint: string;
  target?: ElementTarget;
}): TargetResolution {
  const ranked = input.elements
    .map((element) => ({ element, score: scoreElement(element, input.hint, input.target) }))
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
    if (!field) continue;
    score = Math.max(score, scoreFieldAgainstAliases(field, aliases.length > 0 ? aliases : [hint]));
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

function scoreFieldAgainstAliases(field: string, aliases: string[]): number {
  let score = 0;
  const fieldCompact = compactText(field);
  for (const alias of aliases) {
    const aliasCompact = compactText(alias);
    if (!alias) continue;
    if (field === alias || fieldCompact === aliasCompact) score = Math.max(score, 0.94);
    else if (field.includes(alias)) score = Math.max(score, alias.length >= 2 ? 0.86 : 0.52);
    else if (alias.includes(field) && field.length >= 2) score = Math.max(score, 0.72);
    else if (fieldCompact.includes(aliasCompact) && aliasCompact.length >= 2) score = Math.max(score, 0.82);
    else if (aliasCompact.includes(fieldCompact) && fieldCompact.length >= 2) score = Math.max(score, 0.68);
  }
  return score;
}

function isActionableTargetCandidate(element: BrowserElement): boolean {
  const role = clean(element.role);
  const tag = clean(element.tagName);
  return element.editable ||
    Boolean(element.href) ||
    ["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "option", "menuitem", "tab", "switch"].includes(role) ||
    ["a", "button", "input", "textarea", "select", "option", "summary", "label"].includes(tag);
}

function clean(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
