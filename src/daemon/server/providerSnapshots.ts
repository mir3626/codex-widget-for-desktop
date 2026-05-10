import type { DomSnapshot, ScreenSnapshot } from "../providers/providerRegistry.js";

export function summarizeScreenSnapshot(snapshot: ScreenSnapshot): Omit<ScreenSnapshot, "imageDataUrl"> & {
  imageDataUrlLength: number;
} {
  return {
    source: snapshot.source,
    title: snapshot.title,
    description: snapshot.description,
    ocrText: snapshot.ocrText,
    imageHash: snapshot.imageHash,
    imageChanged: snapshot.imageChanged,
    imageDiffRatio: snapshot.imageDiffRatio,
    imageDiffThreshold: snapshot.imageDiffThreshold,
    imageMeaningfullyChanged: snapshot.imageMeaningfullyChanged,
    imageDataUrlLength: snapshot.imageDataUrl.length,
    capturedAt: snapshot.capturedAt
  };
}

export function summarizeDomSnapshot(snapshot: DomSnapshot): string {
  const label = snapshot.title || readUrlHost(snapshot.url) || "DOM snapshot";
  const selected = snapshot.selection ? `${snapshot.selection.length} selected chars` : "";
  const text = snapshot.text ? `${snapshot.text.length} page chars` : "";
  const elements = snapshot.elements.length > 0 ? `${snapshot.elements.length} elements` : "";
  return [label, selected, text, elements].filter(Boolean).join(" · ");
}

export function summarizeDomSnapshotData(snapshot: DomSnapshot): Record<string, unknown> {
  return {
    url: snapshot.url || undefined,
    title: snapshot.title || undefined,
    selectionLength: snapshot.selection.length,
    textLength: snapshot.text.length,
    elementCount: snapshot.elements.length,
    focusedElementId: snapshot.focusedElementId,
    selectionPreview: snapshot.selection ? snapshot.selection.slice(0, 240) : undefined,
    capturedAt: snapshot.capturedAt
  };
}

export function summarizeVisionSnapshot(snapshot: ScreenSnapshot): string {
  const label = snapshot.title || snapshot.source || "Vision snapshot";
  const ocr = snapshot.ocrText ? `${snapshot.ocrText.length} OCR chars` : "";
  const changed = snapshot.imageHash ? `changed ${snapshot.imageMeaningfullyChanged ? "yes" : "no"}` : "";
  return [label, ocr, changed].filter(Boolean).join(" · ");
}

function readUrlHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}
