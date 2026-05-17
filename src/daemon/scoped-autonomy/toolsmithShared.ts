import { createHash } from "node:crypto";
import type { AutonomyToolRunSummary } from "../../shared/protocol.js";

export type ToolCommandMode = AutonomyToolRunSummary["mode"];

export function evalKindForToolMode(mode: ToolCommandMode): string {
  if (mode === "smoke") {
    return "toolsmith_smoke";
  }
  if (mode === "rerun") {
    return "toolsmith_rerun";
  }
  if (mode === "rollback") {
    return "toolsmith_rollback";
  }
  if (mode === "dependency_prepare") {
    return "toolsmith_dependency_prepare";
  }
  return "toolsmith_execute";
}

export function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "autonomy-run";
}
