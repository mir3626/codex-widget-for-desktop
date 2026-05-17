import { asRecord } from "./toolsmithShared.js";

export function compareStableOutput(left: unknown, right: unknown): Record<string, unknown> & { matched: boolean } {
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  const leftFingerprint = stableFingerprint(leftRecord);
  const rightFingerprint = stableFingerprint(rightRecord);
  const artifactComparison = compareArtifactFingerprints(leftFingerprint.artifacts, rightFingerprint.artifacts);
  const scalarMatched = JSON.stringify({ ...leftFingerprint, artifacts: [] }) === JSON.stringify({ ...rightFingerprint, artifacts: [] });
  const matched = scalarMatched && artifactComparison.matched;
  return {
    schemaVersion: "toolsmith-rerun-comparison.v1",
    matched,
    scalarMatched,
    artifactComparison,
    left: leftFingerprint,
    right: rightFingerprint
  };
}

type StableOutputFingerprint = {
  ok: unknown;
  stage: unknown;
  sourceCount: unknown;
  verified: unknown;
  artifacts: Array<{
    role: unknown;
    mime: unknown;
    size: unknown;
    sha256: unknown;
  }>;
};

function stableFingerprint(value: Record<string, unknown>): StableOutputFingerprint {
  const artifacts = Array.isArray(value.artifacts)
    ? value.artifacts.map((artifact) => {
      const record = asRecord(artifact);
      return {
        role: record.role,
        mime: record.mime,
        size: record.size,
        sha256: record.sha256
      };
    })
    : [];
  return {
    ok: value.ok,
    stage: value.stage,
    sourceCount: value.sourceCount,
    verified: value.verified,
    artifacts
  };
}

function compareArtifactFingerprints(
  leftArtifacts: StableOutputFingerprint["artifacts"],
  rightArtifacts: StableOutputFingerprint["artifacts"]
): Record<string, unknown> & { matched: boolean } {
  const left = new Map(leftArtifacts.map((artifact, index) => [artifactKey(artifact, index), artifact]));
  const right = new Map(rightArtifacts.map((artifact, index) => [artifactKey(artifact, index), artifact]));
  const changed: string[] = [];
  const missing: string[] = [];
  const added: string[] = [];
  for (const [key, leftArtifact] of left.entries()) {
    const rightArtifact = right.get(key);
    if (!rightArtifact) {
      missing.push(key);
      continue;
    }
    if (JSON.stringify(leftArtifact) !== JSON.stringify(rightArtifact)) {
      changed.push(key);
    }
  }
  for (const key of right.keys()) {
    if (!left.has(key)) {
      added.push(key);
    }
  }
  return {
    matched: changed.length === 0 && missing.length === 0 && added.length === 0,
    leftCount: leftArtifacts.length,
    rightCount: rightArtifacts.length,
    changed,
    missing,
    added
  };
}

function artifactKey(artifact: StableOutputFingerprint["artifacts"][number], index: number): string {
  return [artifact.role, artifact.mime, index].filter((part) => part !== undefined && part !== null && part !== "").join(":") || `artifact:${index}`;
}
