import type {
  BrowserElement,
  BrowserElementRiskHint
} from "../types.js";
import {
  hashStable,
  normalizeRect,
  trimField
} from "./utils.js";

export function normalizeElement(input: unknown, index: number): BrowserElement {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : undefined;
  const tagName = trimField(record?.tagName ?? record?.tag, 40).toLowerCase() || "element";
  const role = trimField(record?.role, 80).toLowerCase();
  const inputType = trimField(record?.inputType ?? record?.type, 80).toLowerCase();
  const text = trimField(record?.text, 1000);
  const value = shouldRedactInput(inputType, tagName) ? "" : trimField(record?.value, 1000);
  const ariaLabel = trimField(record?.ariaLabel ?? record?.aria_label, 500);
  const placeholder = trimField(record?.placeholder, 500);
  const title = trimField(record?.title, 500);
  const label = trimField(record?.label, 700) || readBestLabel({ ariaLabel, placeholder, title, text, value });
  const selector = trimField(record?.selector, 1000);
  const href = trimField(record?.href, 1000);
  const editable = Boolean(record?.editable) || tagName === "textarea" || tagName === "select" || tagName === "input" || role === "textbox" || role === "searchbox";
  const visible = record?.visible === undefined ? true : Boolean(record.visible);
  const enabled = record?.enabled === undefined ? true : Boolean(record.enabled);
  const riskHints = readRiskHints({ tagName, role, inputType, label, text, href });
  const stableSeed = `${selector}:${role}:${tagName}:${label}:${href}:${index}`;
  return {
    id: trimField(record?.id, 120) || `el-${index + 1}-${hashStable(stableSeed).slice(0, 8)}`,
    role: role || inferRole(tagName, inputType, href),
    tagName,
    label,
    text,
    value,
    placeholder,
    ariaLabel,
    title,
    selector,
    xpath: trimField(record?.xpath, 1000),
    bbox: normalizeRect(record?.bbox),
    visible,
    enabled,
    editable,
    checked: typeof record?.checked === "boolean" ? record.checked : undefined,
    selected: typeof record?.selected === "boolean" ? record.selected : undefined,
    href,
    inputType,
    confidence: clampElementConfidence(record?.confidence, selector ? 0.85 : 0.65),
    riskHints,
    sourceOrder: readOptionalInteger(record?.sourceOrder),
    domPathHash: trimField(record?.domPathHash, 160),
    parentPathHash: trimField(record?.parentPathHash, 160),
    frameId: trimField(record?.frameId, 160),
    frameUrl: trimField(record?.frameUrl, 1000),
    shadowRootBoundary: typeof record?.shadowRootBoundary === "boolean" ? record.shadowRootBoundary : undefined,
    ariaControls: readStringList(record?.ariaControls),
    ariaDescribedBy: readStringList(record?.ariaDescribedBy),
    ariaLabelledBy: readStringList(record?.ariaLabelledBy),
    headingLevel: readOptionalInteger(record?.headingLevel),
    nearestHeading: trimField(record?.nearestHeading, 500),
    nearestLandmark: trimField(record?.nearestLandmark, 160),
    contextText: trimField(record?.contextText, 1000),
    formOwner: trimField(record?.formOwner, 160),
    listOwner: trimField(record?.listOwner, 160),
    computedVisibility: normalizeComputedVisibility(record?.computedVisibility),
    isStickyOrFixed: typeof record?.isStickyOrFixed === "boolean" ? record.isStickyOrFixed : undefined,
    isLikelyOverlay: typeof record?.isLikelyOverlay === "boolean" ? record.isLikelyOverlay : undefined,
    mutationRevision: trimField(record?.mutationRevision, 160),
    lastMutationAt: trimField(record?.lastMutationAt, 128)
  };
}

export function summarizeBrowserElement(element: BrowserElement | undefined): string {
  if (!element) {
    return "(none)";
  }
  const label = element.label || element.ariaLabel || element.placeholder || element.text || element.title || element.href || element.selector || element.id;
  const role = element.role || element.tagName;
  return `${role} ${label}`.replace(/\s+/g, " ").trim().slice(0, 180);
}

function readBestLabel(input: { ariaLabel: string; placeholder: string; title: string; text: string; value: string }): string {
  return input.ariaLabel || input.placeholder || input.title || input.text || input.value;
}

function inferRole(tagName: string, inputType: string, href: string): string | undefined {
  if (tagName === "button") return "button";
  if (tagName === "a" || href) return "link";
  if (tagName === "select") return "combobox";
  if (tagName === "textarea") return "textbox";
  if (tagName === "input") {
    if (inputType === "checkbox") return "checkbox";
    if (inputType === "radio") return "radio";
    if (inputType === "search") return "searchbox";
    if (inputType === "submit" || inputType === "button") return "button";
    return "textbox";
  }
  return undefined;
}

function readRiskHints(input: { tagName: string; role: string; inputType: string; label: string; text: string; href: string }): BrowserElementRiskHint[] {
  const haystack = `${input.role} ${input.inputType} ${input.label} ${input.text} ${input.href}`.toLowerCase();
  const hints = new Set<BrowserElementRiskHint>();
  if (input.inputType === "password" || /(password|비밀번호|암호|token|api key|secret)/i.test(haystack)) {
    hints.add("password");
    hints.add("auth");
  }
  if (/(pay|purchase|checkout|billing|card|결제|구매|카드)/i.test(haystack)) hints.add("payment");
  if (/(delete|remove|archive|삭제|제거|지워)/i.test(haystack)) hints.add("delete");
  if (input.inputType === "submit" || /(submit|send|publish|save|저장|보내|제출|게시(?!글))/i.test(haystack)) hints.add("submit");
  if (input.inputType === "file" || /(upload|첨부|업로드)/i.test(haystack)) hints.add("file_upload");
  if (/(download|다운로드)/i.test(haystack)) hints.add("download");
  return [...hints];
}

function shouldRedactInput(inputType: string, tagName: string): boolean {
  return tagName === "input" && /password|hidden|token|secret|card|cc/.test(inputType);
}

function clampElementConfidence(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readOptionalInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : undefined;
}

function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .map((item) => trimField(item, 160))
    .filter(Boolean);
  return items.length ? items : undefined;
}

function normalizeComputedVisibility(value: unknown): BrowserElement["computedVisibility"] {
  return ["visible", "hidden", "transparent", "offscreen"].includes(String(value))
    ? String(value) as BrowserElement["computedVisibility"]
    : undefined;
}
