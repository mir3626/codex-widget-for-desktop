import type { BrowserActionSource } from "../../browser-action/index.js";

export function readBrowserSourceFromSnapshot(snapshot: unknown): Partial<BrowserActionSource> | undefined {
  const record = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : undefined;
  const url = readOptionalString(record?.url);
  const title = readOptionalString(record?.title);
  if (!url && !title) {
    return undefined;
  }
  return {
    kind: "active_tab",
    browser: "unknown",
    ...(url ? { url } : {}),
    ...(title ? { title } : {})
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
