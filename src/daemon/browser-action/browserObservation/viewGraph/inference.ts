import type { BrowserElement, BrowserViewNode } from "../../types.js";

export function readRoute(url: string): string {
  try {
    const parsed = new URL(url);
    const queryLabel = `${String.fromCharCode(63)}query`;
    return `${parsed.origin}${parsed.pathname}${parsed.search ? queryLabel : ""}`;
  } catch {
    return url.split("#")[0] || url;
  }
}

export function inferViewNodeKind(element: BrowserElement): BrowserViewNode["kind"] {
  if (element.editable) return "field";
  if (element.role === "row" || element.tagName === "tr") return "row";
  if (isActionableSnapshotElementLike(element)) return "control";
  return "content_item";
}

export function inferRegionRole(element: BrowserElement): NonNullable<BrowserViewNode["regionRole"]> {
  const selector = `${element.selector ?? ""} ${element.role ?? ""} ${element.tagName} ${element.label ?? ""}`.toLowerCase();
  if (/modal|dialog|popup/.test(selector)) return "modal";
  if (/header|gnb|top/.test(selector) || (element.bbox?.y ?? 9999) < 96) return "header";
  if (/nav|menu|sidebar|aside/.test(selector) || (element.bbox?.x ?? 9999) < 180) return "sidebar";
  if (/form|input|textarea|select/.test(selector)) return "form";
  if (/list|row|item|article|post|table/.test(selector)) return "list";
  return "main";
}

export function normalizeViewNodeKind(value: unknown): BrowserViewNode["kind"] {
  return ["surface", "region", "control", "field", "content_item", "text_block", "list", "row", "media", "table", "state", "modal", "form"].includes(String(value))
    ? String(value) as BrowserViewNode["kind"]
    : "content_item";
}

export function normalizeRegionRole(value: unknown): BrowserViewNode["regionRole"] {
  return ["header", "nav", "sidebar", "main", "footer", "modal", "form", "list", "toolbar", "dialog", "article", "unknown"].includes(String(value))
    ? String(value) as BrowserViewNode["regionRole"]
    : undefined;
}

export function isFilterLikeElement(element: BrowserElement): boolean {
  const text = `${element.role ?? ""} ${element.label ?? ""} ${element.text ?? ""}`.toLowerCase();
  return element.role === "tab" || /filter|필터|카테고리|category|개념|추천|인기/.test(text);
}

function isActionableSnapshotElementLike(element: BrowserElement): boolean {
  return Boolean(element.href) ||
    Boolean(element.editable) ||
    ["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "option", "menuitem", "tab", "switch"].includes(element.role ?? "") ||
    ["a", "button", "input", "textarea", "select", "option", "summary", "label"].includes(element.tagName);
}
