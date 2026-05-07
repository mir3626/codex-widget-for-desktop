import { randomUUID } from "node:crypto";
import type { BrowserActionTimelineEvent } from "./types.js";

export function createTimelineEvent(input: Omit<BrowserActionTimelineEvent, "id" | "t"> & { startedAt: string }): BrowserActionTimelineEvent {
  return {
    id: `browser-event-${randomUUID()}`,
    t: Math.max(0, Date.now() - Date.parse(input.startedAt)),
    type: input.type,
    summary: input.summary,
    detail: input.detail
  };
}
