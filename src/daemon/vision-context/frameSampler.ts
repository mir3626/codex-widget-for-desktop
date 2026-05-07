import type { ScreenshotEvent } from "./types.js";

export function selectRepresentativeFrames(events: ScreenshotEvent[], limit = 3): ScreenshotEvent[] {
  const ranked = [...events].sort((left, right) => frameScore(right) - frameScore(left) || right.t - left.t);
  return ranked.slice(0, Math.max(1, limit));
}

function frameScore(event: ScreenshotEvent): number {
  const purposeScore = event.purpose === "referent_crop" ? 1
    : event.purpose === "primary_media" ? 0.9
      : event.purpose === "error_evidence" ? 0.95
        : event.purpose === "temporal_evidence" ? 0.75
          : 0.55;
  const hasImage = event.path || event.dataUrl ? 0.2 : 0;
  const hasText = event.text ? 0.08 : 0;
  return purposeScore + hasImage + hasText;
}
