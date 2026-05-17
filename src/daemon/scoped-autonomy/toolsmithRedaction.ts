import { basename } from "node:path";
import type {
  AutonomyGeneratedToolSpec,
  AutonomyToolRunSummary
} from "../../shared/protocol.js";

export function redactToolSpec(spec: AutonomyGeneratedToolSpec): AutonomyGeneratedToolSpec {
  return {
    ...spec,
    artifacts: spec.artifacts.map((artifact) => ({
      ...artifact,
      path: redactPath(artifact.path)
    })),
    manifest: spec.manifest
      ? {
        ...spec.manifest,
        entrypoint: redactPath(spec.manifest.entrypoint),
        rollback: spec.manifest.rollback.map((action) => ({ ...action, target: redactPath(action.target) }))
      }
      : undefined
  };
}

export function redactToolRun(run: AutonomyToolRunSummary): AutonomyToolRunSummary {
  return {
    ...run,
    input: redactPaths(run.input),
    output: redactPaths(run.output)
  };
}

export function redactPaths(value: unknown): unknown {
  if (typeof value === "string") {
    return redactPathLikeString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactPaths);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "path" || key.endsWith("Path") || key.endsWith("Dir")) && typeof nested === "string") {
      output[key] = redactPath(nested);
    } else {
      output[key] = redactPaths(nested);
    }
  }
  return output;
}

export function redactPathLikeString(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (/^file:(\/\/\/)?[A-Za-z]:\//i.test(normalized)) {
    return `file:<redacted>/${basename(normalized)}`;
  }
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) {
    return redactPath(normalized);
  }
  return value;
}

export function redactPath(path: string): string {
  if (!path) {
    return path;
  }
  return `<redacted>/${basename(path)}`;
}
