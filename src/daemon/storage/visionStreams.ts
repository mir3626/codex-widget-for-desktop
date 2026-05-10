import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type { StoragePaths } from "./paths.js";
import { insertBlob, writeBlob } from "./blobs.js";
import { readDataUrlBytes } from "./fileUtils.js";
import {
  normalizeOptionalNumber,
  normalizeRecordingMime,
  normalizeVisionStreamMode,
  normalizeVisionStreamStatus,
  optionalString,
  parseJsonField,
  readRecord,
  stringOrNow
} from "./normalizers.js";
import type {
  CompleteVisionRecordingInput,
  StopVisionStreamInput,
  VisionStreamInput,
  VisionStreamStatus,
  VisionStreamSummary
} from "./types.js";

export function createVisionStream(database: NodeDatabaseSync, input: VisionStreamInput): VisionStreamSummary {
  const now = input.startedAt ?? new Date().toISOString();
  const status: VisionStreamStatus = input.mode === "recording" ? "recording" : "streaming";
  const detail = {
    ...(readRecord(input.detail) ?? {}),
    maxDurationMs: normalizeOptionalNumber(input.maxDurationMs)
  };
  database
    .prepare(
      `INSERT OR REPLACE INTO vision_streams (
         id, session_id, status, mode, fps, frame_interval_ms, recording_blob_id, started_at, stopped_at, detail_json
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`
    )
    .run(
      input.id,
      input.sessionId ?? null,
      status,
      input.mode,
      normalizeOptionalNumber(input.fps) ?? null,
      normalizeOptionalNumber(input.frameIntervalMs) ?? null,
      now,
      JSON.stringify(detail)
    );
  return readVisionStream(database, input.id);
}

export function stopVisionStream(database: NodeDatabaseSync, input: StopVisionStreamInput): VisionStreamSummary {
  const now = input.stoppedAt ?? new Date().toISOString();
  const current = readVisionStream(database, input.id);
  const nextDetail = {
    ...(readRecord(current.detail) ?? {}),
    reason: input.reason || undefined
  };
  database
    .prepare(
      `UPDATE vision_streams
       SET status = ?, stopped_at = ?, detail_json = ?
       WHERE id = ?`
    )
    .run(input.status ?? "stopped", now, JSON.stringify(nextDetail), input.id);
  return readVisionStream(database, input.id);
}

export function completeVisionRecording(database: NodeDatabaseSync, paths: StoragePaths, input: CompleteVisionRecordingInput): VisionStreamSummary {
  const now = input.stoppedAt ?? new Date().toISOString();
  const current = readVisionStream(database, input.id);
  const bytes = readDataUrlBytes(input.dataUrl);
  const mime = normalizeRecordingMime(input.mime);
  const blob = writeBlob(paths, bytes, mime, `${input.id}.webm`);
  insertBlob(database, blob);
  const nextDetail = {
    ...(readRecord(current.detail) ?? {}),
    durationMs: normalizeOptionalNumber(input.durationMs),
    size: normalizeOptionalNumber(input.size) ?? bytes.byteLength,
    mime
  };
  database
    .prepare(
      `UPDATE vision_streams
       SET status = 'stopped', stopped_at = ?, recording_blob_id = ?, detail_json = ?
       WHERE id = ?`
    )
    .run(now, blob.id, JSON.stringify(nextDetail), input.id);
  return readVisionStream(database, input.id);
}

function readVisionStream(database: NodeDatabaseSync, id: string): VisionStreamSummary {
  const row = database
    .prepare(
      `SELECT id, session_id, status, mode, fps, frame_interval_ms, recording_blob_id, started_at, stopped_at, detail_json
       FROM vision_streams
       WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row || typeof row.id !== "string") {
    throw new Error(`Vision stream not found: ${id}`);
  }
  return {
    id: row.id,
    sessionId: optionalString(row.session_id),
    mode: normalizeVisionStreamMode(row.mode),
    status: normalizeVisionStreamStatus(row.status),
    fps: normalizeOptionalNumber(row.fps),
    frameIntervalMs: normalizeOptionalNumber(row.frame_interval_ms),
    recordingBlobId: optionalString(row.recording_blob_id),
    startedAt: stringOrNow(row.started_at),
    stoppedAt: optionalString(row.stopped_at),
    detail: parseJsonField(row.detail_json)
  };
}
