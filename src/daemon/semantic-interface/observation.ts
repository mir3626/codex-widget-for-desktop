import type { AdapterCapabilities, SemanticSnapshot, SemanticSourceWarning } from "./types.js";

export const DEFAULT_SEMANTIC_CAPABILITIES: AdapterCapabilities = {
  observe: true,
  locate: true,
  execute: false,
  shadowProbe: false,
  dryRun: true,
  snapshotImmutable: true,
  revalidateBeforeExecute: true
};

export function readSnapshotAgeMs(snapshot: SemanticSnapshot, now: Date = new Date()): number {
  const createdAt = Date.parse(snapshot.createdAt);
  return Number.isFinite(createdAt) ? Math.max(0, now.getTime() - createdAt) : Number.POSITIVE_INFINITY;
}

export function buildSourceWarnings(input: {
  snapshot: SemanticSnapshot;
  now?: Date;
  maxSnapshotAgeMs?: number;
}): SemanticSourceWarning[] {
  const ageMs = readSnapshotAgeMs(input.snapshot, input.now);
  const warnings: SemanticSourceWarning[] = [];
  if (input.maxSnapshotAgeMs !== undefined && ageMs > input.maxSnapshotAgeMs) {
    warnings.push({
      kind: "snapshot_stale",
      severity: "warn",
      evidenceIds: input.snapshot.evidence.map((evidence) => evidence.id).slice(0, 5),
      description: `Snapshot age ${Math.round(ageMs)}ms exceeds ${input.maxSnapshotAgeMs}ms profile limit.`
    });
  }
  if (input.snapshot.evidence.some((evidence) => evidence.redaction?.redacted)) {
    warnings.push({
      kind: "redacted_evidence",
      severity: "info",
      evidenceIds: input.snapshot.evidence.filter((evidence) => evidence.redaction?.redacted).map((evidence) => evidence.id),
      description: "Snapshot contains redacted evidence; durable traces must not restore raw values."
    });
  }
  if (!input.snapshot.capabilities.observe || !input.snapshot.capabilities.locate) {
    warnings.push({
      kind: "unsupported_surface",
      severity: "block",
      evidenceIds: [],
      description: "Adapter cannot observe and locate semantic targets on this surface."
    });
  }
  return warnings;
}

export function isVisibleStateKnown(value: unknown): boolean {
  return typeof value === "boolean";
}
