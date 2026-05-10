import type { ProviderStatus, WidgetMode } from "../../shared/protocol.js";
import { buildBrowserObservation, type BrowserObservation } from "../browser-action/index.js";
import {
  createDomSnapshot,
  createScreenSnapshot,
  formatScreenDiffRatio,
  readDomDetail,
  readScreenDetail,
  type DomSnapshot,
  type ScreenSnapshot
} from "./providerSnapshots.js";

export type { DomSnapshot, ScreenSnapshot } from "./providerSnapshots.js";

export class ProviderRegistry {
  private domSnapshot: DomSnapshot | null = null;
  private domObservation: BrowserObservation | null = null;
  private screenSnapshot: ScreenSnapshot | null = null;

  setDomSnapshot(input: unknown): DomSnapshot {
    const snapshot = createDomSnapshot(input);
    const observation = buildBrowserObservation({
      source: {
        kind: "active_tab",
        browser: "unknown",
        url: snapshot.url,
        title: snapshot.title
      },
      snapshot
    });
    snapshot.viewGraph = observation.viewGraph;
    this.domSnapshot = snapshot;
    this.domObservation = observation;
    return snapshot;
  }

  getDomSnapshot(): DomSnapshot | null {
    return this.domSnapshot;
  }

  getDomObservation(): BrowserObservation | null {
    return this.domObservation;
  }

  setScreenSnapshot(input: unknown): ScreenSnapshot {
    const snapshot = createScreenSnapshot(input, this.screenSnapshot);
    this.screenSnapshot = snapshot;
    return snapshot;
  }

  getScreenSnapshot(): ScreenSnapshot | null {
    return this.screenSnapshot;
  }

  getStatuses(): ProviderStatus[] {
    return [
      {
        mode: "agent",
        label: "Agent",
        state: "ready",
        detail: "Codex app-server runtime",
        capabilities: ["streaming", "session", "approval"]
      },
      {
        mode: "browser",
        label: "Browser Bridge",
        state: this.domSnapshot ? "ready" : "stub",
        detail: this.domSnapshot ? readDomDetail(this.domSnapshot) : "Waiting for Browser Bridge page context",
        capabilities: ["active-tab", "selection", "metadata", "browser-bridge", "structured-elements", "browser-action", "typed-actions"]
      },
      {
        mode: "screen",
        label: "Vision",
        state: this.screenSnapshot ? "ready" : "stub",
        detail: this.screenSnapshot ? readScreenDetail(this.screenSnapshot) : "Waiting for screen snapshot",
        capabilities: ["capture", "crop", "diff", "ocr", "snapshot", "webm-recording", "agent-stream"]
      },
      {
        mode: "terminal",
        label: "PTY",
        state: "ready",
        detail: "Terminal PTY provider",
        capabilities: ["shell", "pty", "resize", "raw-input", "output", "cancel", "timeout"]
      }
    ];
  }
}

export function augmentRequestWithProviderContext<T extends {
  mode: WidgetMode;
  text: string;
  imageDataUrls?: string[];
}>(input: T, providers: ProviderRegistry | undefined): T {
  if (input.mode !== "browser") {
    if (input.mode !== "screen") {
      return input;
    }

    const screenSnapshot = providers?.getScreenSnapshot();
    if (!screenSnapshot) {
      return input;
    }

    return {
      ...input,
      imageDataUrls: screenSnapshot.imageDataUrl
        ? [...(input.imageDataUrls ?? []), screenSnapshot.imageDataUrl]
        : input.imageDataUrls,
      text: [
        "Screen/Vision context:",
        `Source: ${screenSnapshot.source || "(unknown)"}`,
        screenSnapshot.title ? `Title: ${screenSnapshot.title}` : "",
        `Captured: ${screenSnapshot.capturedAt}`,
        screenSnapshot.description ? `Description:\n${screenSnapshot.description}` : "",
        screenSnapshot.ocrText ? `OCR text:\n${screenSnapshot.ocrText}` : "",
        screenSnapshot.imageHash ? `Image changed since previous capture: ${screenSnapshot.imageChanged ? "yes" : "no"}` : "",
        screenSnapshot.imageHash ? `Image diff ratio: ${formatScreenDiffRatio(screenSnapshot.imageDiffRatio)} (threshold ${formatScreenDiffRatio(screenSnapshot.imageDiffThreshold)}; meaningful ${screenSnapshot.imageMeaningfullyChanged ? "yes" : "no"})` : "",
        screenSnapshot.imageDataUrl ? "Image input is attached to this Vision turn." : "",
        "",
        "User request:",
        input.text
      ]
        .filter(Boolean)
        .join("\n")
    } as T;
  }

  const snapshot = providers?.getDomSnapshot();
  if (!snapshot) {
    return input;
  }

  return {
    ...input,
    text: [
      "Browser DOM context:",
      `URL: ${snapshot.url || "(unknown)"}`,
      `Title: ${snapshot.title || "(unknown)"}`,
      snapshot.selection ? `Selection:\n${snapshot.selection}` : "",
      snapshot.text ? `Page text excerpt:\n${snapshot.text}` : "",
      snapshot.elements.length > 0 ? `Interactive elements: ${snapshot.elements.length} structured candidates attached.` : "",
      "",
      "User request:",
      input.text
    ]
      .filter(Boolean)
      .join("\n")
  } as T;
}

export function renderScreenSnapshotToolOutput(snapshot: ScreenSnapshot | null): string {
  if (!snapshot) {
    return "No screen snapshot is attached yet. POST a snapshot to `/providers/screen/snapshot` from a capture helper or local tool.";
  }

  return [
    `Source: ${snapshot.source || "(unknown)"}`,
    snapshot.title ? `Title: ${snapshot.title}` : "",
    `Captured: ${snapshot.capturedAt}`,
    snapshot.description ? `Description:\n${snapshot.description}` : "",
    snapshot.ocrText ? `OCR text:\n${snapshot.ocrText.slice(0, 3000)}` : "",
    snapshot.imageHash ? `Image changed since previous capture: ${snapshot.imageChanged ? "yes" : "no"}` : "",
    snapshot.imageHash ? `Image diff ratio: ${formatScreenDiffRatio(snapshot.imageDiffRatio)} (threshold ${formatScreenDiffRatio(snapshot.imageDiffThreshold)}; meaningful ${snapshot.imageMeaningfullyChanged ? "yes" : "no"})` : "",
    snapshot.imageDataUrl ? `Image data URL: ${snapshot.imageDataUrl.length} characters attached` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function renderDomSnapshotToolOutput(snapshot: DomSnapshot | null): string {
  if (!snapshot) {
    return "No DOM snapshot is attached yet. POST a snapshot to `/providers/dom/snapshot` from a browser extension, bookmarklet, or local tool.";
  }

  return [
    `URL: ${snapshot.url || "(unknown)"}`,
    `Title: ${snapshot.title || "(unknown)"}`,
    `Captured: ${snapshot.capturedAt}`,
    snapshot.selection ? `Selection:\n${snapshot.selection}` : "",
    snapshot.text ? `Page text excerpt:\n${snapshot.text.slice(0, 3000)}` : "",
    snapshot.elements.length > 0 ? `Interactive elements: ${snapshot.elements.length} structured candidates attached.` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}
