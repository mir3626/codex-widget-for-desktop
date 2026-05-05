import type { ProviderStatus, WidgetMode } from "../../shared/protocol.js";

export type DomSnapshot = {
  url: string;
  title: string;
  selection: string;
  text: string;
  capturedAt: string;
};

const MAX_DOM_TEXT_LENGTH = 20_000;
const MAX_DOM_FIELD_LENGTH = 2_000;

export class ProviderRegistry {
  private domSnapshot: DomSnapshot | null = null;

  setDomSnapshot(input: unknown): DomSnapshot {
    const record = readRecord(input);
    const snapshot: DomSnapshot = {
      url: trimField(record?.url, MAX_DOM_FIELD_LENGTH),
      title: trimField(record?.title, MAX_DOM_FIELD_LENGTH),
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
        state: "stub",
        detail: "Screen capture pending",
        capabilities: ["capture", "crop", "diff"]
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
    return input;
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

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function trimField(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
