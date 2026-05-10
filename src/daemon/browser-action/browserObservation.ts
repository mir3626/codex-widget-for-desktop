import { randomUUID } from "node:crypto";
import type {
  BrowserElement,
  BrowserObservation,
  BrowserViewport
} from "./types.js";
import {
  normalizeElement,
  summarizeBrowserElement
} from "./browserObservation/elementNormalizer.js";
import {
  clampNumber,
  hashStable,
  readRecord,
  trimField
} from "./browserObservation/utils.js";
import { normalizeViewGraph } from "./browserObservation/viewGraph.js";

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
  const capturedAt = trimField(record?.capturedAt, 128) || (input.now ?? new Date()).toISOString();
  const text = trimField(record?.text, MAX_TEXT_LENGTH);
  const viewGraph = normalizeViewGraph(record?.viewGraph, {
    source,
    url,
    title,
    capturedAt,
    text,
    elements
  });
  return {
    id: `obs-${hashStable(`${url}:${title}:${record?.capturedAt ?? ""}:${elements.length}:${randomUUID()}`).slice(0, 16)}`,
    capturedAt,
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
    text,
    elements,
    screenshot: normalizeScreenshot(record?.screenshot),
    viewGraph
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
    viewGraphNodes: observation.viewGraph?.nodes.length ?? 0,
    viewRevision: observation.viewGraph?.identity.viewRevision,
    focusedElementId: observation.focusedElementId,
    interactive: observation.elements.slice(0, 12).map((element) => summarizeBrowserElement(element))
  };
}

export { summarizeBrowserElement };

function normalizeViewport(value: unknown): BrowserViewport | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
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
  if (!record) return undefined;
  return {
    path: trimField(record.path, 1000),
    dataUrl: trimField(record.dataUrl, 1_500_000),
    title: trimField(record.title, 500)
  };
}

function resolveFocusedElementId(elements: BrowserElement[], value: unknown): string | undefined {
  const id = trimField(value, 120);
  if (id && elements.some((element) => element.id === id)) {
    return id;
  }
  return elements.find((element) => element.selected || element.confidence > 0.9 && element.editable)?.id;
}
