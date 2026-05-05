import type { ProviderStatus, WidgetMode } from "../../shared/protocol.js";

export type DomSnapshot = {
  url: string;
  title: string;
  selection: string;
  text: string;
  capturedAt: string;
};

export type ScreenSnapshot = {
  source: string;
  title: string;
  description: string;
  ocrText: string;
  imageDataUrl: string;
  capturedAt: string;
};

const MAX_DOM_TEXT_LENGTH = 20_000;
const MAX_PROVIDER_FIELD_LENGTH = 2_000;
const MAX_SCREEN_TEXT_LENGTH = 20_000;
const MAX_SCREEN_IMAGE_LENGTH = 1_500_000;

export class ProviderRegistry {
  private domSnapshot: DomSnapshot | null = null;
  private screenSnapshot: ScreenSnapshot | null = null;

  setDomSnapshot(input: unknown): DomSnapshot {
    const record = readRecord(input);
    const snapshot: DomSnapshot = {
      url: trimField(record?.url, MAX_PROVIDER_FIELD_LENGTH),
      title: trimField(record?.title, MAX_PROVIDER_FIELD_LENGTH),
      selection: trimField(record?.selection, MAX_DOM_TEXT_LENGTH),
      text: trimField(record?.text, MAX_DOM_TEXT_LENGTH),
      capturedAt: new Date().toISOString()
    };

    if (!snapshot.url && !snapshot.title && !snapshot.selection && !snapshot.text) {
      throw new Error("DOM snapshot must include url, title, selection, or text.");
    }

    this.domSnapshot = snapshot;
    return snapshot;
  }

  getDomSnapshot(): DomSnapshot | null {
    return this.domSnapshot;
  }

  setScreenSnapshot(input: unknown): ScreenSnapshot {
    const record = readRecord(input);
    const snapshot: ScreenSnapshot = {
      source: trimField(record?.source, MAX_PROVIDER_FIELD_LENGTH),
      title: trimField(record?.title, MAX_PROVIDER_FIELD_LENGTH),
      description: trimField(record?.description, MAX_SCREEN_TEXT_LENGTH),
      ocrText: trimField(record?.ocrText ?? record?.ocr_text, MAX_SCREEN_TEXT_LENGTH),
      imageDataUrl: trimField(record?.imageDataUrl ?? record?.image_data_url, MAX_SCREEN_IMAGE_LENGTH),
      capturedAt: new Date().toISOString()
    };

    if (!snapshot.source && !snapshot.title && !snapshot.description && !snapshot.ocrText && !snapshot.imageDataUrl) {
      throw new Error("Screen snapshot must include source, title, description, ocrText, or imageDataUrl.");
    }

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
        label: "DOM",
        state: this.domSnapshot ? "ready" : "stub",
        detail: this.domSnapshot ? readDomDetail(this.domSnapshot) : "Waiting for DOM snapshot",
        capabilities: ["active-tab", "selection", "metadata", "snapshot"]
      },
      {
        mode: "screen",
        label: "Vision",
        state: this.screenSnapshot ? "ready" : "stub",
        detail: this.screenSnapshot ? readScreenDetail(this.screenSnapshot) : "Waiting for screen snapshot",
        capabilities: ["capture", "crop", "diff", "ocr", "snapshot"]
      },
      {
        mode: "terminal",
        label: "PTY",
        state: "ready",
        detail: "Terminal command provider",
        capabilities: ["shell", "output", "cancel", "timeout"]
      }
    ];
  }
}

export function augmentRequestWithProviderContext<T extends {
  mode: WidgetMode;
  text: string;
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
      text: [
        "Screen/Vision context:",
        `Source: ${screenSnapshot.source || "(unknown)"}`,
        screenSnapshot.title ? `Title: ${screenSnapshot.title}` : "",
        `Captured: ${screenSnapshot.capturedAt}`,
        screenSnapshot.description ? `Description:\n${screenSnapshot.description}` : "",
        screenSnapshot.ocrText ? `OCR text:\n${screenSnapshot.ocrText}` : "",
        screenSnapshot.imageDataUrl ? "Image data URL is attached to the daemon snapshot but not embedded in this text turn." : "",
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
    snapshot.text ? `Page text excerpt:\n${snapshot.text.slice(0, 3000)}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function readDomDetail(snapshot: DomSnapshot): string {
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

function readScreenDetail(snapshot: ScreenSnapshot): string {
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

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function trimField(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
