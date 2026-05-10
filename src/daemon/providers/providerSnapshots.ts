import { createHash } from "node:crypto";

export type DomSnapshot = {
  url: string;
  title: string;
  selection: string;
  text: string;
  elements: unknown[];
  focusedElementId?: string;
  readyState?: string;
  viewport?: unknown;
  viewGraph?: unknown;
  capturedAt: string;
};

export type ScreenSnapshot = {
  source: string;
  title: string;
  description: string;
  ocrText: string;
  imageDataUrl: string;
  imageHash: string;
  imageChanged: boolean;
  imageDiffRatio: number;
  imageDiffThreshold: number;
  imageMeaningfullyChanged: boolean;
  capturedAt: string;
};

const MAX_DOM_TEXT_LENGTH = 20_000;
const MAX_PROVIDER_FIELD_LENGTH = 2_000;
const MAX_SCREEN_TEXT_LENGTH = 20_000;
const MAX_SCREEN_IMAGE_LENGTH = 1_500_000;

export function createDomSnapshot(input: unknown): DomSnapshot {
  const record = readRecord(input);
  const snapshot: DomSnapshot = {
    url: trimField(record?.url, MAX_PROVIDER_FIELD_LENGTH),
    title: trimField(record?.title, MAX_PROVIDER_FIELD_LENGTH),
    selection: trimField(record?.selection, MAX_DOM_TEXT_LENGTH),
    text: trimField(record?.text, MAX_DOM_TEXT_LENGTH),
    elements: Array.isArray(record?.elements) ? record.elements.slice(0, 220) : [],
    focusedElementId: trimField(record?.focusedElementId, MAX_PROVIDER_FIELD_LENGTH) || undefined,
    readyState: trimField(record?.readyState, MAX_PROVIDER_FIELD_LENGTH) || undefined,
    viewport: typeof record?.viewport === "object" && record.viewport !== null ? record.viewport : undefined,
    viewGraph: typeof record?.viewGraph === "object" && record.viewGraph !== null ? record.viewGraph : undefined,
    capturedAt: new Date().toISOString()
  };

  if (!snapshot.url && !snapshot.title && !snapshot.selection && !snapshot.text) {
    throw new Error("DOM snapshot must include url, title, selection, or text.");
  }

  return snapshot;
}

export function createScreenSnapshot(input: unknown, previous: ScreenSnapshot | null): ScreenSnapshot {
  const record = readRecord(input);
  const imageDataUrl = trimField(record?.imageDataUrl ?? record?.image_data_url, MAX_SCREEN_IMAGE_LENGTH);
  const imageHash = hashScreenImageDataUrl(imageDataUrl);
  const imageDiffRatio = diffScreenImageDataUrl(previous?.imageDataUrl, imageDataUrl);
  const imageDiffThreshold = resolveScreenDiffThreshold();
  const snapshot: ScreenSnapshot = {
    source: trimField(record?.source, MAX_PROVIDER_FIELD_LENGTH),
    title: trimField(record?.title, MAX_PROVIDER_FIELD_LENGTH),
    description: trimField(record?.description, MAX_SCREEN_TEXT_LENGTH),
    ocrText: trimField(record?.ocrText ?? record?.ocr_text, MAX_SCREEN_TEXT_LENGTH),
    imageDataUrl,
    imageHash,
    imageChanged: imageHash ? imageHash !== previous?.imageHash : true,
    imageDiffRatio,
    imageDiffThreshold,
    imageMeaningfullyChanged: imageHash ? imageDiffRatio >= imageDiffThreshold : true,
    capturedAt: new Date().toISOString()
  };

  if (!snapshot.source && !snapshot.title && !snapshot.description && !snapshot.ocrText && !snapshot.imageDataUrl) {
    throw new Error("Screen snapshot must include source, title, description, ocrText, or imageDataUrl.");
  }

  return snapshot;
}

export function readDomDetail(snapshot: DomSnapshot): string {
  if (snapshot.title) {
    return snapshot.title;
  }
  if (snapshot.url) {
    try {
      return new URL(snapshot.url).hostname;
    } catch {
      return snapshot.url;
    }
  }
  return "DOM snapshot attached";
}

export function readScreenDetail(snapshot: ScreenSnapshot): string {
  if (snapshot.source) {
    return snapshot.source;
  }
  if (snapshot.title) {
    return snapshot.title;
  }
  if (snapshot.description) {
    return snapshot.description.slice(0, 80);
  }
  return "Screen snapshot attached";
}

export function formatScreenDiffRatio(value: number): string {
  return value.toFixed(4);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function trimField(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function hashScreenImageDataUrl(value: string): string {
  if (!value) {
    return "";
  }
  return createHash("sha256").update(value).digest("hex");
}

function diffScreenImageDataUrl(previous: string | undefined, current: string): number {
  if (!current) {
    return 0;
  }
  if (!previous) {
    return 1;
  }

  const previousBytes = readImagePayloadBytes(previous);
  const currentBytes = readImagePayloadBytes(current);
  const maxLength = Math.max(previousBytes.length, currentBytes.length);
  if (maxLength === 0) {
    return 0;
  }

  let changed = Math.abs(previousBytes.length - currentBytes.length);
  const sharedLength = Math.min(previousBytes.length, currentBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (previousBytes[index] !== currentBytes[index]) {
      changed += 1;
    }
  }

  return changed / maxLength;
}

function readImagePayloadBytes(value: string): Buffer {
  const commaIndex = value.indexOf(",");
  const payload = commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
  try {
    return Buffer.from(payload, "base64");
  } catch {
    return Buffer.from(value, "utf8");
  }
}

function resolveScreenDiffThreshold(): number {
  const configured = Number.parseFloat(process.env.CODEX_WIDGET_SCREEN_DIFF_THRESHOLD ?? "");
  if (!Number.isFinite(configured)) {
    return 0.01;
  }
  return Math.min(1, Math.max(0, configured));
}
