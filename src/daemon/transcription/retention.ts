import { promises as fs } from "node:fs";
import type { AudioSegment } from "./types.js";

export async function deleteRawAudioSegments(segments: AudioSegment[]): Promise<string[]> {
  const deleted: string[] = [];
  for (const path of segments.map((segment) => segment.path).filter((path): path is string => Boolean(path))) {
    try {
      await fs.rm(path, { force: true });
      deleted.push(path);
    } catch {
      // Best-effort deletion; missing temp chunks should not fail the turn.
    }
  }
  return deleted;
}
