import { promises as fs } from "node:fs";
import type { TaskCapsule, VisionCaptureSession } from "./types.js";

export async function deleteRawMedia(session: VisionCaptureSession): Promise<string[]> {
  const deleted: string[] = [];
  for (const path of readRawMediaPaths(session)) {
    try {
      await fs.rm(path, { force: true });
      deleted.push(path);
    } catch {
      // Deletion is best-effort for missing or concurrently removed temp files.
    }
  }
  return deleted;
}

export async function enforceRetentionAfterCapsule(input: {
  session: VisionCaptureSession;
  capsule?: TaskCapsule;
}): Promise<{ deletedRawMedia: string[] }> {
  const deletedRawMedia = await deleteRawMedia(input.session);
  return { deletedRawMedia };
}

export function readRawMediaPaths(session: VisionCaptureSession): string[] {
  return [
    session.rawMedia?.videoPath,
    session.rawMedia?.audioPath,
    ...(session.rawMedia?.segmentPaths ?? [])
  ]
    .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
    .map((path) => path.trim());
}
