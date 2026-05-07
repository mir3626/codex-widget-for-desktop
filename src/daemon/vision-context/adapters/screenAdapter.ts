import type { Observation, ScreenSnapshotLike, VisionContextAdapter } from "../types.js";

export const screenAdapter: VisionContextAdapter = {
  id: "screen",
  label: "Screen",
  async isAvailable(input) {
    return Boolean(input.captureSession.timeline.some((event) => event.type === "screenshot"));
  },
  async collect(input) {
    const observations: Observation[] = [];
    const snapshot = readScreenSnapshot(input.providerState?.screenSnapshot);
    if (snapshot) {
      observations.push({
        id: `screen-provider:${snapshot.capturedAt}`,
        t: input.timeRange.endMs,
        source: "screen",
        kind: "image",
        label: snapshot.title || snapshot.source || "screen snapshot",
        text: [snapshot.description, snapshot.ocrText].filter(Boolean).join("\n\n"),
        dataUrl: snapshot.imageDataUrl,
        metadata: {
          source: snapshot.source,
          imageHash: snapshot.imageHash,
          imageChanged: snapshot.imageChanged,
          imageDiffRatio: snapshot.imageDiffRatio,
          imageMeaningfullyChanged: snapshot.imageMeaningfullyChanged,
          capturedAt: snapshot.capturedAt
        },
        confidence: 0.82
      });
      if (snapshot.ocrText) {
        observations.push({
          id: `screen-ocr:${snapshot.capturedAt}`,
          t: input.timeRange.endMs,
          source: "ocr",
          kind: snapshot.ocrText.match(/error|failed|오류|에러/i) ? "error" : "text",
          label: "OCR text",
          text: snapshot.ocrText,
          confidence: 0.7
        });
      }
    }

    for (const event of input.captureSession.timeline) {
      if (event.type !== "screenshot") {
        continue;
      }
      observations.push({
        id: `screen-event:${event.id}`,
        t: event.t,
        source: event.text ? "ocr" : "screen",
        kind: event.purpose === "error_evidence" ? "error" : event.purpose === "primary_media" ? "media" : "image",
        label: event.purpose,
        text: event.text,
        bbox: event.bbox,
        path: event.path,
        dataUrl: event.dataUrl,
        metadata: { cropOf: event.cropOf, perceptualHash: event.perceptualHash },
        confidence: 0.8
      });
    }
    return observations;
  }
};

function readScreenSnapshot(value: unknown): ScreenSnapshotLike | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    source: readString(record.source),
    title: readString(record.title),
    description: readString(record.description),
    ocrText: readString(record.ocrText),
    imageDataUrl: readString(record.imageDataUrl),
    imageHash: readString(record.imageHash),
    imageChanged: record.imageChanged === true,
    imageDiffRatio: Number(record.imageDiffRatio ?? 0),
    imageMeaningfullyChanged: record.imageMeaningfullyChanged !== false,
    capturedAt: readString(record.capturedAt) || new Date().toISOString()
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
