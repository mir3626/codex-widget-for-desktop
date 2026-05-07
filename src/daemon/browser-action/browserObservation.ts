import { createHash, randomUUID } from "node:crypto";
import type { BrowserElement, BrowserElementRiskHint, BrowserObservation, BrowserViewport, Rect } from "./types.js";

const MAX_TEXT_LENGTH = 20_000;
const MAX_FIELD_LENGTH = 2_000;
const MAX_ELEMENTS = 220;

export function buildBrowserObservation(input: {
  source?: Partial<BrowserObservation["source"]>;
  snapshot?: unknown;
  now?: Date;
}): BrowserObservation {
  const record = readRecord(input.snapshot);
  const source = input.source ?? {};
  const url = trimField(record?.url ?? source.url, MAX_FIELD_LENGTH);
  const title = trimField(record?.title ?? source.title, MAX_FIELD_LENGTH);
  const rawElements = Array.isArray(record?.elements) ? record.elements : [];
  const elements = rawElements.slice(0, MAX_ELEMENTS).map((item, index) => normalizeElement(item, index));
  const focusedElementId = resolveFocusedElementId(elements, record?.focusedElementId);
  return {
    id: `obs-${hashStable(`${url}:${title}:${record?.capturedAt ?? ""}:${elements.length}:${randomUUID()}`).slice(0, 16)}`,
    capturedAt: trimField(record?.capturedAt, 128) || (input.now ?? new Date()).toISOString(),
    source: {
      kind: source.kind ?? "active_tab",
      browser: source.browser ?? "unknown",
      tabId: source.tabId,
      windowId: source.windowId,
      url,
      title
    },
    url,
    title,
    readyState: normalizeReadyState(record?.readyState),
    viewport: normalizeViewport(record?.viewport),
    selection: trimField(record?.selection, MAX_TEXT_LENGTH),
    focusedElementId,
    text: trimField(record?.text, MAX_TEXT_LENGTH),
    elements,
    screenshot: normalizeScreenshot(record?.screenshot)
  };
}

export function summarizeBrowserObservation(observation: BrowserObservation): Record<string, unknown> {
  return {
    id: observation.id,
    url: observation.url || undefined,
    title: observation.title || undefined,
    capturedAt: observation.capturedAt,
    textLength: observation.text?.length ?? 0,
    selectionLength: observation.selection?.length ?? 0,
    elements: observation.elements.length,
    focusedElementId: observation.focusedElementId,
    interactive: observation.elements.slice(0, 12).map((element) => summarizeBrowserElement(element))
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

function normalizeElement(input: unknown, index: number): BrowserElement {
  const record = readRecord(input);
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
    confidence: clampNumber(record?.confidence, selector ? 0.85 : 0.65),
    riskHints
  };
}

function readBestLabel(input: { ariaLabel: string; placeholder: string; title: string; text: string; value: string }): string {
  return input.ariaLabel || input.placeholder || input.title || input.text || input.value;
}

function inferRole(tagName: string, inputType: string, href: string): string | undefined {
  if (tagName === "button") {
    return "button";
  }
  if (tagName === "a" || href) {
    return "link";
  }
  if (tagName === "select") {
    return "combobox";
  }
  if (tagName === "textarea") {
    return "textbox";
  }
  if (tagName === "input") {
    if (inputType === "checkbox") {
      return "checkbox";
    }
    if (inputType === "radio") {
      return "radio";
    }
    if (inputType === "search") {
      return "searchbox";
    }
    if (inputType === "submit" || inputType === "button") {
      return "button";
    }
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
  if (/(pay|purchase|checkout|billing|card|결제|구매|카드)/i.test(haystack)) {
    hints.add("payment");
  }
  if (/(delete|remove|archive|삭제|제거|지워)/i.test(haystack)) {
    hints.add("delete");
  }
  if (input.inputType === "submit" || /(submit|send|post|publish|save|저장|보내|게시|제출)/i.test(haystack)) {
    hints.add("submit");
  }
  if (input.inputType === "file" || /(upload|첨부|업로드)/i.test(haystack)) {
    hints.add("file_upload");
  }
  if (/(download|다운로드)/i.test(haystack)) {
    hints.add("download");
  }
  return [...hints];
}

function shouldRedactInput(inputType: string, tagName: string): boolean {
  return tagName === "input" && /password|hidden|token|secret|card|cc/.test(inputType);
}

function normalizeViewport(value: unknown): BrowserViewport | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  const width = Math.floor(Number(record.width));
  const height = Math.floor(Number(record.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return undefined;
  }
  return {
    width,
    height,
    devicePixelRatio: clampNumber(record.devicePixelRatio, 1),
    scrollX: Math.floor(clampNumber(record.scrollX, 0)),
    scrollY: Math.floor(clampNumber(record.scrollY, 0))
  };
}

function normalizeReadyState(value: unknown): BrowserObservation["readyState"] {
  return value === "loading" || value === "interactive" || value === "complete" ? value : undefined;
}

function normalizeScreenshot(value: unknown): BrowserObservation["screenshot"] {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    path: trimField(record.path, 1000),
    dataUrl: trimField(record.dataUrl, 1_500_000),
    title: trimField(record.title, 500)
  };
}

function normalizeRect(value: unknown): Rect | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  const rect = {
    x: Math.round(clampNumber(record.x, 0)),
    y: Math.round(clampNumber(record.y, 0)),
    w: Math.round(clampNumber(record.w ?? record.width, 0)),
    h: Math.round(clampNumber(record.h ?? record.height, 0))
  };
  return rect.w > 0 && rect.h > 0 ? rect : undefined;
}

function resolveFocusedElementId(elements: BrowserElement[], value: unknown): string | undefined {
  const id = trimField(value, 120);
  if (id && elements.some((element) => element.id === id)) {
    return id;
  }
  return elements.find((element) => element.selected || element.confidence > 0.9 && element.editable)?.id;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function trimField(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function clampNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hashStable(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
