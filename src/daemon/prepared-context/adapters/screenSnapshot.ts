import { createHash } from "node:crypto";
import type { ScreenSnapshot } from "../../providers/providerRegistry.js";
import type { PreparedContextSnapshot } from "../types.js";

export function screenSnapshotToPreparedContext(snapshot: ScreenSnapshot): PreparedContextSnapshot {
  const digest = createHash("sha256")
    .update([
      snapshot.source,
      snapshot.title,
      snapshot.capturedAt,
      snapshot.description,
      snapshot.ocrText,
      snapshot.imageHash
    ].filter(Boolean).join("\0"))
    .digest("hex")
    .slice(0, 24);
  return {
    schemaVersion: "prepared-context.v1",
    identity: {
      surface: "screen",
      sourceId: snapshot.source || "screen",
      surfaceId: snapshot.title || snapshot.source || "screen",
      title: snapshot.title || snapshot.source,
      revision: snapshot.imageHash || digest,
      digest
    },
    freshness: snapshot.imageMeaningfullyChanged === false ? "stale" : "fresh",
    stability: "stable",
    capturedAt: snapshot.capturedAt,
    updatedAt: snapshot.capturedAt,
    expiresAt: new Date(Date.parse(snapshot.capturedAt) + 45_000).toISOString(),
    redaction: {
      mode: "redacted_summary",
      persistedFields: ["identity", "imageDiffMetadata", "ocrPreviewMetadata"]
    },
    diagnostics: {
      imageHash: snapshot.imageHash,
      imageChanged: snapshot.imageChanged,
      imageMeaningfullyChanged: snapshot.imageMeaningfullyChanged,
      imageDiffRatio: snapshot.imageDiffRatio,
      ocrTextLength: snapshot.ocrText?.length ?? 0,
      hasImageInput: Boolean(snapshot.imageDataUrl)
    }
  };
}
