import type { TaskCapsule } from "../../vision-context/types.js";
import type { PreparedContextSnapshot } from "../types.js";

export function taskCapsuleToPreparedContext(capsule: TaskCapsule): PreparedContextSnapshot {
  const sourceId = capsule.source?.kind ?? "vision";
  return {
    schemaVersion: "prepared-context.v1",
    identity: {
      surface: capsule.source?.kind === "browser_tab" ? "browser_page" : "screen",
      sourceId,
      surfaceId: capsule.captureSessionId,
      url: capsule.source?.url,
      title: capsule.source?.windowTitle ?? capsule.source?.appName,
      routeKey: capsule.source?.url,
      revision: capsule.id,
      digest: capsule.evidence.map((item) => `${item.kind}:${item.title}:${item.path ?? item.text ?? ""}`).join("|")
    },
    freshness: "fresh",
    stability: "stable",
    capturedAt: capsule.createdAt,
    updatedAt: capsule.createdAt,
    expiresAt: new Date(Date.parse(capsule.createdAt) + 60_000).toISOString(),
    redaction: {
      mode: "redacted_summary",
      persistedFields: ["identity", "resolvedIntent", "uncertainties", "evidenceMetadata"]
    },
    diagnostics: {
      resolvedIntent: capsule.resolvedIntent,
      evidenceCount: capsule.evidence.length,
      uncertaintyCount: capsule.uncertainties.length,
      retention: capsule.retention
    }
  };
}

