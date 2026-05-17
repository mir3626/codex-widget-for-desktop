import type {
  ComputerUseFindElementsQuery,
  ComputerUseSemanticRefRole,
  ComputerUseSemanticRefSummary,
  ComputerUseSemanticTreeSummary,
  ExecutionSurfaceKind
} from "../../shared/protocol.js";
import type { NativeDesktopHelperSnapshot } from "../browser-action/adapters/nativeDesktop/helperClient.js";

export type ComputerUseSemanticTreeInput = {
  snapshot?: NativeDesktopHelperSnapshot | null;
  source?: ComputerUseSemanticTreeSummary["source"];
  surface?: ExecutionSurfaceKind;
  capturedAt?: string;
};

export function createComputerUseSemanticTree(input: ComputerUseSemanticTreeInput): ComputerUseSemanticTreeSummary {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const snapshot = input.snapshot ?? {};
  const refs: Record<string, ComputerUseSemanticRefSummary> = {};
  const rootRefs: string[] = [];
  const windowRefs: string[] = [];
  const warnings: string[] = [];
  const windows = Array.isArray(snapshot.windows) ? snapshot.windows : [];
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];

  for (const [index, window] of windows.entries()) {
    const ref = uniqueRef(refs, `window:${readStableToken(String(window.id || index + 1))}`);
    windowRefs.push(ref);
    rootRefs.push(ref);
    refs[ref] = {
      ref,
      role: "window",
      name: trimOptional(window.title),
      source: "native_desktop_window",
      metadata: {
        processName: trimOptional(window.processName),
        nativeWindowId: window.id
      },
      childrenRefs: []
    };
  }

  const defaultWindowRef = windowRefs[0];
  for (const [index, element] of elements.entries()) {
    const role = normalizeSemanticRole(element.role ?? element.tagName ?? element.inputType);
    const baseRef = element.id ? `element:${readStableToken(element.id)}` : `element:${role}:${index + 1}`;
    const ref = uniqueRef(refs, baseRef);
    const bbox = element.bbox && areFiniteNumbers(element.bbox.x, element.bbox.y, element.bbox.w, element.bbox.h)
      ? {
          x: element.bbox.x,
          y: element.bbox.y,
          width: element.bbox.w,
          height: element.bbox.h
        }
      : undefined;
    const riskHints = normalizeStringArray(element.riskHints);
    const sensitive = isSensitiveElement(element);
    const windowRef = defaultWindowRef;
    refs[ref] = {
      ref,
      role,
      name: trimOptional(element.label),
      text: trimOptional(element.text),
      placeholder: trimOptional(element.placeholder),
      windowRef,
      parentRef: windowRef,
      bounds: bbox,
      visible: typeof element.visible === "boolean" ? element.visible : undefined,
      enabled: typeof element.enabled === "boolean" ? element.enabled : undefined,
      editable: typeof element.editable === "boolean" ? element.editable : role === "textbox" ? true : undefined,
      selected: typeof element.selected === "boolean" ? element.selected : undefined,
      checked: typeof element.checked === "boolean" ? element.checked : undefined,
      confidence: typeof element.confidence === "number" ? element.confidence : undefined,
      riskHints,
      valuePresent: typeof element.value === "string" && element.value.length > 0 ? true : undefined,
      valueRedacted: typeof element.value === "string" && element.value.length > 0 && sensitive ? true : undefined,
      source: "native_desktop_element",
      metadata: {
        selector: trimOptional(element.selector),
        tagName: trimOptional(element.tagName),
        inputType: trimOptional(element.inputType)
      }
    };
    if (windowRef && refs[windowRef]) {
      refs[windowRef].childrenRefs = [...(refs[windowRef].childrenRefs ?? []), ref];
    } else {
      rootRefs.push(ref);
    }
  }

  if (!windows.length && !elements.length) {
    warnings.push("native_helper_snapshot_empty_or_unavailable");
  }

  return {
    schemaVersion: "computer-use-semantic-tree.v1",
    capturedAt,
    source: input.source ?? "native_helper_snapshot",
    surface: input.surface,
    rootRefs: uniqueStrings(rootRefs),
    windowRefs,
    refs,
    stats: summarizeSemanticRefs(refs),
    redaction: {
      credentials: "redacted",
      values: "redacted_when_sensitive",
      screenshots: "not_stored"
    },
    warnings
  };
}

export function createUnavailableComputerUseSemanticTree(input: {
  reason: string;
  surface?: ExecutionSurfaceKind;
  capturedAt?: string;
}): ComputerUseSemanticTreeSummary {
  const tree = createComputerUseSemanticTree({
    snapshot: {},
    source: "unavailable",
    surface: input.surface,
    capturedAt: input.capturedAt
  });
  return {
    ...tree,
    warnings: [...tree.warnings, input.reason]
  };
}

export function readComputerUseSemanticTreeFixture(value: unknown): NativeDesktopHelperSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    url: readString(record.url),
    title: readString(record.title),
    text: readString(record.text),
    windows: Array.isArray(record.windows)
      ? record.windows.map(readFixtureWindow).filter((window): window is NonNullable<NativeDesktopHelperSnapshot["windows"]>[number] => Boolean(window))
      : undefined,
    elements: Array.isArray(record.elements)
      ? record.elements.map(readFixtureElement).filter((element): element is NonNullable<NativeDesktopHelperSnapshot["elements"]>[number] => Boolean(element))
      : undefined
  };
}

export function findComputerUseSemanticRefs(
  tree: ComputerUseSemanticTreeSummary,
  query: ComputerUseFindElementsQuery = {}
): ComputerUseSemanticRefSummary[] {
  const role = query.role;
  const limit = Math.max(1, Math.min(Number(query.limit) || 50, 200));
  const text = normalizeSearch(query.text);
  const name = normalizeSearch(query.name);
  const placeholder = normalizeSearch(query.placeholder);
  const matches: ComputerUseSemanticRefSummary[] = [];
  for (const ref of Object.values(tree.refs)) {
    if (role && ref.role !== role) {
      continue;
    }
    if (query.visibleOnly && ref.visible === false) {
      continue;
    }
    if (query.enabledOnly && ref.enabled === false) {
      continue;
    }
    if (text && !normalizeSearch(`${ref.text ?? ""} ${ref.name ?? ""}`).includes(text)) {
      continue;
    }
    if (name && !normalizeSearch(ref.name).includes(name)) {
      continue;
    }
    if (placeholder && !normalizeSearch(ref.placeholder).includes(placeholder)) {
      continue;
    }
    matches.push(ref);
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

function normalizeSemanticRole(value: string | undefined): ComputerUseSemanticRefRole {
  const text = String(value ?? "").trim().toLowerCase();
  if (/button|pushbutton|splitbutton/.test(text)) return "button";
  if (/edit|textbox|text box|input|password|searchbox|combobox/.test(text)) return "textbox";
  if (/menuitem|menu item/.test(text)) return "menuitem";
  if (/menu/.test(text)) return "menu";
  if (/listitem|list item|option/.test(text)) return "listitem";
  if (/list|listbox/.test(text)) return "list";
  if (/check|checkbox/.test(text)) return "checkbox";
  if (/radio/.test(text)) return "radio";
  if (/tab/.test(text)) return "tab";
  if (/link|anchor/.test(text)) return "link";
  if (/image|img|icon/.test(text)) return "image";
  if (/group|pane|panel|container/.test(text)) return "group";
  if (/text|label|static/.test(text)) return "text";
  if (/window|dialog/.test(text)) return "window";
  return "unknown";
}

function summarizeSemanticRefs(refs: Record<string, ComputerUseSemanticRefSummary>): ComputerUseSemanticTreeSummary["stats"] {
  const roleCounts: Record<string, number> = {};
  let windowCount = 0;
  let elementCount = 0;
  for (const ref of Object.values(refs)) {
    roleCounts[ref.role] = (roleCounts[ref.role] ?? 0) + 1;
    if (ref.role === "window") {
      windowCount += 1;
    } else {
      elementCount += 1;
    }
  }
  return { windowCount, elementCount, roleCounts };
}

function isSensitiveElement(element: NonNullable<NativeDesktopHelperSnapshot["elements"]>[number]): boolean {
  const joined = [
    element.id,
    element.role,
    element.label,
    element.placeholder,
    element.selector,
    element.inputType,
    ...(element.riskHints ?? [])
  ].join(" ");
  return /password|passwd|token|cookie|credential|secret|api[_-]?key/i.test(joined);
}

function readFixtureWindow(value: unknown): NonNullable<NativeDesktopHelperSnapshot["windows"]>[number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    processName: readString(record.processName) ?? "unknown",
    id: Number.isFinite(Number(record.id)) ? Number(record.id) : 0,
    title: readString(record.title) ?? ""
  };
}

function readFixtureElement(value: unknown): NonNullable<NativeDesktopHelperSnapshot["elements"]>[number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    id: readString(record.id),
    role: readString(record.role),
    tagName: readString(record.tagName),
    label: readString(record.label),
    text: readString(record.text),
    value: readString(record.value),
    placeholder: readString(record.placeholder),
    selector: readString(record.selector),
    bbox: readBounds(record.bbox),
    visible: readBoolean(record.visible),
    enabled: readBoolean(record.enabled),
    editable: readBoolean(record.editable),
    checked: readBoolean(record.checked),
    selected: readBoolean(record.selected),
    inputType: readString(record.inputType),
    confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : undefined,
    riskHints: normalizeStringArray(record.riskHints)
  };
}

function readBounds(value: unknown): { x: number; y: number; w: number; h: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const w = Number(record.w ?? record.width);
  const h = Number(record.h ?? record.height);
  return areFiniteNumbers(x, y, w, h) ? { x, y, w, h } : undefined;
}

function uniqueRef(refs: Record<string, unknown>, base: string): string {
  const normalized = base.replace(/[^a-z0-9:_-]+/gi, "-").replace(/-+/g, "-").slice(0, 96) || "ref";
  if (!refs[normalized]) {
    return normalized;
  }
  let index = 2;
  while (refs[`${normalized}:${index}`]) {
    index += 1;
  }
  return `${normalized}:${index}`;
}

function readStableToken(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed : "unknown";
}

function trimOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function uniqueStrings(value: string[]): string[] {
  return [...new Set(value)];
}

function normalizeSearch(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function areFiniteNumbers(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}
