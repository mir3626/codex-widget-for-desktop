import type { PreparedContextSnapshot } from "../../prepared-context/types.js";
import type { SemanticSnapshot, SemanticSurfaceKind } from "../types.js";

export function preparedContextToSemanticSnapshot(input: {
  context: PreparedContextSnapshot;
  snapshotId?: string;
  adapterId?: string;
  createdAt?: string;
}): SemanticSnapshot {
  const surfaceKind = readSemanticSurfaceKind(input.context.identity.surface);
  const snapshotId = input.snapshotId ?? `semantic-prepared-${input.context.identity.surface}-${input.context.identity.digest ?? input.context.identity.revision ?? "unknown"}`;
  const evidenceId = `${snapshotId}:surface`;
  return {
    id: snapshotId,
    createdAt: input.createdAt ?? input.context.updatedAt,
    surface: {
      id: input.context.identity.surfaceId ?? input.context.identity.sourceId,
      kind: surfaceKind,
      title: input.context.identity.title,
      url: input.context.identity.url,
      adapterId: input.adapterId ?? input.context.identity.sourceId,
      viewIdentityHash: input.context.identity.digest ?? input.context.identity.revision
    },
    capabilities: {
      observe: input.context.freshness !== "blocked" && input.context.freshness !== "unavailable",
      locate: false,
      execute: false,
      shadowProbe: false,
      dryRun: true,
      snapshotImmutable: true,
      revalidateBeforeExecute: true
    },
    evidence: [
      {
        id: evidenceId,
        snapshotId,
        adapterId: input.adapterId ?? input.context.identity.sourceId,
        source: surfaceKind === "terminal" ? "terminal" : surfaceKind === "workspace" ? "workspace" : "action_result",
        observedAt: input.context.updatedAt,
        confidence: input.context.freshness === "fresh" ? 1 : 0.6,
        value: {
          label: input.context.identity.title ?? input.context.identity.url ?? input.context.identity.surfaceId,
          state: {
            freshness: input.context.freshness,
            stability: input.context.stability,
            routeKey: input.context.identity.routeKey,
            revision: input.context.identity.revision
          }
        },
        redaction: {
          redacted: input.context.redaction.mode !== "redacted_summary",
          reason: "Prepared context adapter emits metadata only."
        }
      }
    ],
    entities: [
      {
        id: `${snapshotId}:surface-entity`,
        kind: "surface",
        surfaceId: input.context.identity.surfaceId ?? input.context.identity.sourceId,
        label: input.context.identity.title ?? input.context.identity.url ?? input.context.identity.surfaceId,
        affordances: ["read"],
        evidenceIds: [evidenceId],
        state: { visible: input.context.freshness !== "blocked" && input.context.freshness !== "unavailable" },
        tier1: { role: "observe", risk: "read_only" }
      }
    ],
    relations: [],
    provenance: {}
  };
}

function readSemanticSurfaceKind(surface: PreparedContextSnapshot["identity"]["surface"]): SemanticSurfaceKind {
  if (surface === "browser_page" || surface === "terminal" || surface === "workspace") {
    return surface;
  }
  if (surface === "screen") {
    return "desktop_screen";
  }
  return "app_window";
}

