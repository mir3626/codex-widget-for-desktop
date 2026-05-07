import type { Observation, VisionContextAdapter } from "../types.js";

export const browserAdapter: VisionContextAdapter = {
  id: "browser",
  label: "Browser",
  async isAvailable(input) {
    return input.captureSession.source.kind === "browser_tab";
  },
  async collect(input) {
    const snapshot = readDomSnapshot(input.providerState?.domSnapshot);
    if (!snapshot) {
      return [];
    }
    const observations: Observation[] = [
      {
        id: `browser-page:${snapshot.capturedAt}`,
        t: input.timeRange.endMs,
        source: "browser",
        kind: "page",
        label: snapshot.title || readUrlHost(snapshot.url) || "browser page",
        text: [snapshot.url, snapshot.title, snapshot.text].filter(Boolean).join("\n"),
        metadata: { url: snapshot.url, title: snapshot.title, capturedAt: snapshot.capturedAt },
        confidence: 0.82
      }
    ];
    if (snapshot.selection) {
      observations.push({
        id: `browser-selection:${snapshot.capturedAt}`,
        t: input.timeRange.endMs,
        source: "browser",
        kind: "selection",
        label: "selected text",
        text: snapshot.selection,
        metadata: { url: snapshot.url },
        confidence: 0.9
      });
    }
    return observations;
  }
};

function readDomSnapshot(value: unknown): { url: string; title: string; selection: string; text: string; capturedAt: string } | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const snapshot = {
    url: readString(record.url),
    title: readString(record.title),
    selection: readString(record.selection),
    text: readString(record.text),
    capturedAt: readString(record.capturedAt) || new Date().toISOString()
  };
  return snapshot.url || snapshot.title || snapshot.selection || snapshot.text ? snapshot : undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readUrlHost(value: string): string {
  try {
    return value ? new URL(value).hostname : "";
  } catch {
    return value;
  }
}
