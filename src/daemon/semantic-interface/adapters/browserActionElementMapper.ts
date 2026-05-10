import type { BrowserElement } from "../../browser-action/types.js";
import { compactSemanticText, normalizeSemanticText, uniqueStrings } from "../ontology.js";
import type {
  SemanticAffordance,
  SemanticEntityKind,
  SemanticTier1Risk
} from "../types.js";

export function readElementLabel(element: BrowserElement): string {
  return element.label || element.ariaLabel || element.placeholder || element.text || element.title || element.value || element.href || element.id;
}

export function buildElementAttributes(element: BrowserElement): Record<string, string> {
  if (isSensitiveElement(element)) {
    return Object.fromEntries(Object.entries({
      tagName: element.tagName,
      inputType: element.inputType,
      compactLabel: "redacted-field"
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
  }
  return Object.fromEntries(Object.entries({
    tagName: element.tagName,
    href: element.href,
    inputType: element.inputType,
    selector: element.selector,
    compactLabel: compactSemanticText(readElementLabel(element))
  }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

export function isSensitiveElement(element: BrowserElement): boolean {
  return element.inputType === "password" || element.riskHints.includes("password") || element.riskHints.includes("payment");
}

export function inferEntityKind(element: BrowserElement): SemanticEntityKind {
  if (element.editable || isControlRole(element.role) || isControlTag(element.tagName)) {
    return "control";
  }
  if (element.href || element.role === "link") {
    return "content_item";
  }
  return element.visible ? "content_item" : "region";
}

export function inferAffordances(element: BrowserElement): SemanticAffordance[] {
  const affordances: SemanticAffordance[] = ["read", "locate"];
  if (element.enabled && element.visible) {
    if (element.editable) affordances.push("type");
    if (element.href || element.role === "link") affordances.push("navigate", "activate");
    if (isControlRole(element.role) || isControlTag(element.tagName)) affordances.push("activate");
    if (isFilterLike(element)) affordances.push("filter");
    if (element.riskHints.includes("submit")) affordances.push("submit");
  }
  return uniqueStrings(affordances) as SemanticAffordance[];
}

export function inferTier1Role(element: BrowserElement): "observe" | "locate" | "act" {
  return inferAffordances(element).some((affordance) => !["read", "locate"].includes(affordance)) ? "act" : "locate";
}

export function inferTier1Risk(element: BrowserElement): SemanticTier1Risk {
  if (element.riskHints.includes("password") || element.riskHints.includes("payment")) return "credential_or_payment";
  if (element.riskHints.includes("delete")) return "destructive";
  if (element.riskHints.includes("submit") || element.riskHints.includes("file_upload")) return "submit_or_publish";
  if (element.riskHints.includes("download")) return "data_exfiltration";
  if (element.editable) return "input_non_submitting";
  if (element.href) return isExternalHref(element.href) ? "external_navigation" : "local_navigation";
  if (isControlRole(element.role) || isControlTag(element.tagName)) return "state_change";
  return "read_only";
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function isControlRole(role: string | undefined): boolean {
  return ["button", "tab", "switch", "checkbox", "radio", "combobox", "option", "menuitem", "textbox", "searchbox"].includes(role ?? "");
}

function isControlTag(tagName: string): boolean {
  return ["button", "input", "select", "textarea", "option", "summary", "label"].includes(tagName);
}

function isFilterLike(element: BrowserElement): boolean {
  const text = normalizeSemanticText(readElementLabel(element));
  return element.role === "tab" || /filter|필터|카테고리|category|추천|인기/.test(text);
}
