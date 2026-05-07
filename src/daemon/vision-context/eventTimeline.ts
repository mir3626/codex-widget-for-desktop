import type { CaptureEvent, CapturePointerEvent, ScreenshotEvent, SpeechEvent } from "./types.js";

export function sortTimeline(events: CaptureEvent[]): CaptureEvent[] {
  return [...events].sort((left, right) => left.t - right.t || left.id.localeCompare(right.id));
}

export function readSpeechEvents(events: CaptureEvent[]): SpeechEvent[] {
  return sortTimeline(events).filter((event): event is SpeechEvent => event.type === "speech");
}

export function readPointerEvents(events: CaptureEvent[]): CapturePointerEvent[] {
  return sortTimeline(events).filter((event): event is CapturePointerEvent => event.type === "pointer");
}

export function readScreenshotEvents(events: CaptureEvent[]): ScreenshotEvent[] {
  return sortTimeline(events).filter((event): event is ScreenshotEvent => event.type === "screenshot");
}

export function renderUserUtterance(events: CaptureEvent[]): string {
  return readSpeechEvents(events)
    .map((event) => event.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function readTimelineRange(events: CaptureEvent[]): { startMs: number; endMs: number } {
  if (events.length === 0) {
    return { startMs: 0, endMs: 0 };
  }
  const sorted = sortTimeline(events);
  return {
    startMs: sorted[0]?.t ?? 0,
    endMs: sorted.at(-1)?.t ?? 0
  };
}
