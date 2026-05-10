import {
  normalizePositiveNumber,
  readRecord
} from "./readers.js";

const MAX_VISION_RECORDING_DATA_URL_CHARS = 16 * 1024 * 1024;

export function readVisionGuardrails(
  mode: "recording" | "agent_stream",
  input: { frameIntervalMs?: number; maxDurationMs?: number; detail?: unknown } = {}
): Record<string, unknown> {
  const detail = readRecord(input.detail);
  const resource = readRecord(detail?.resource);
  const maxDurationMs = typeof input.maxDurationMs === "number" && Number.isFinite(input.maxDurationMs)
    ? input.maxDurationMs
    : 120_000;
  const frameIntervalMs = typeof input.frameIntervalMs === "number" && Number.isFinite(input.frameIntervalMs)
    ? input.frameIntervalMs
    : 1000;
  return mode === "recording"
    ? {
        format: "video/webm",
        maxIngestBytes: Math.floor(MAX_VISION_RECORDING_DATA_URL_CHARS * 0.75),
        maxDurationMs,
        localMaxBytes: normalizePositiveNumber(detail?.localMaxBytes),
        persistence: "blob"
      }
    : {
        frameIntervalMs,
        maxFps: Number((1000 / frameIntervalMs).toFixed(2)),
        maxDurationMs,
        maxFrameWidth: normalizePositiveNumber(resource?.maxFrameWidth),
        jpegQuality: normalizePositiveNumber(resource?.jpegQuality),
        overlapPolicy: typeof resource?.overlapPolicy === "string" ? resource.overlapPolicy : "drop_if_previous_frame_pending",
        persistence: "metadata_only",
        retention: "no_video_file"
      };
}
