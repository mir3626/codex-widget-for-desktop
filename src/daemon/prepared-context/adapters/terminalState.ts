import { createHash } from "node:crypto";
import type { PreparedContextSnapshot } from "../types.js";

export function terminalStateToPreparedContext(input: {
  sessionId?: string;
  cwd?: string;
  shell?: string;
  command?: string;
  outputPreview?: string;
  capturedAt?: string;
}): PreparedContextSnapshot {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const digest = createHash("sha256")
    .update([input.cwd, input.shell, input.command, input.outputPreview].filter(Boolean).join("\0"))
    .digest("hex")
    .slice(0, 24);
  return {
    schemaVersion: "prepared-context.v1",
    identity: {
      surface: "terminal",
      sourceId: input.shell ?? "terminal",
      surfaceId: input.sessionId,
      title: input.cwd,
      routeKey: input.cwd,
      revision: digest,
      digest
    },
    freshness: "fresh",
    stability: "stable",
    capturedAt,
    updatedAt: capturedAt,
    expiresAt: new Date(Date.parse(capturedAt) + 30_000).toISOString(),
    redaction: {
      mode: "redacted_summary",
      persistedFields: ["identity", "commandMetadata", "outputPreview"]
    },
    diagnostics: {
      commandLength: input.command?.length ?? 0,
      outputPreviewLength: input.outputPreview?.length ?? 0
    }
  };
}

