import type { AudioSegment } from "./types.js";

export function createMockVadSegments(input: Array<{ path?: string; startMs: number; endMs: number }>): AudioSegment[] {
  return input.map((segment, index) => ({
    id: `audio-${index + 1}`,
    path: segment.path,
    startMs: Math.max(0, Math.floor(segment.startMs)),
    endMs: Math.max(segment.startMs, Math.floor(segment.endMs))
  }));
}
