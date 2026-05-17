import { existsSync, readFileSync, statSync } from "node:fs";
import type { ScopedAutonomyDagResult } from "../scoped-autonomy/index.js";

export function summarizeToolsmithDagResult(result: ScopedAutonomyDagResult): Record<string, unknown> {
  const artifacts = collectToolsmithArtifacts(result);
  const sourceSummary = collectToolsmithSourceSummary(result);
  return {
    ok: result.run.status === "completed",
    autonomyRunId: result.run.id,
    autonomyEvalRunId: result.run.evalRunId,
    autonomyDagRunId: result.run.dagRunId,
    status: result.run.status,
    failureClass: result.run.failureClass,
    toolSpecId: result.spec?.id,
    toolRunIds: result.toolRuns.map((toolRun) => toolRun.id),
    artifactCount: artifacts.length,
    sourceSummary,
    artifacts: artifacts.map((artifact) => ({
      role: artifact.role,
      mime: artifact.mime,
      size: artifact.size,
      sha256: artifact.sha256,
      blobId: artifact.blobId,
      resourceId: artifact.resourceId,
      basename: artifact.basename
    })),
    verification: {
      status: result.run.status === "completed" ? "passed" : "failed",
      reason: result.run.status === "completed"
        ? "Scoped autonomy DAG completed and produced artifact evidence."
        : result.run.failureClass ?? "scoped_autonomy_failed"
    }
  };
}

export function collectToolsmithArtifacts(result: ScopedAutonomyDagResult): Array<{
  role: string;
  mime?: string;
  size?: number;
  sha256?: string;
  blobId?: string;
  resourceId?: string;
  basename?: string;
}> {
  const artifacts: Array<{
    role: string;
    mime?: string;
    size?: number;
    sha256?: string;
    blobId?: string;
    resourceId?: string;
    basename?: string;
  }> = [];
  for (const toolRun of result.toolRuns) {
    const output = toolRun.output && typeof toolRun.output === "object" ? toolRun.output as Record<string, unknown> : {};
    const rawArtifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
    for (const raw of rawArtifacts) {
      const artifact = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const role = typeof artifact.role === "string" ? artifact.role : "artifact";
      const path = typeof artifact.path === "string" ? artifact.path : "";
      artifacts.push({
        role,
        mime: typeof artifact.mime === "string" ? artifact.mime : undefined,
        size: typeof artifact.size === "number" ? artifact.size : undefined,
        sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : undefined,
        blobId: typeof artifact.blobId === "string" ? artifact.blobId : undefined,
        resourceId: typeof artifact.resourceId === "string" ? artifact.resourceId : undefined,
        basename: path ? path.split(/[\\/]/).pop() : undefined
      });
    }
  }
  return artifacts;
}

export function collectToolsmithSourceSummary(result: ScopedAutonomyDagResult): {
  sourceCount: number;
  rows: Array<{
    title?: string;
    url?: string;
    status?: string;
    browserFallback?: boolean;
    chars?: number;
    excerpt?: string;
  }>;
  fetchedUrls: string[];
  browserFallbackUrls: string[];
  warnings: string[];
} {
  const rows: Array<{
    title?: string;
    url?: string;
    status?: string;
    browserFallback?: boolean;
    chars?: number;
    excerpt?: string;
  }> = [];
  const fetchedUrls = new Set<string>();
  const browserFallbackUrls = new Set<string>();
  const warnings = new Set<string>();
  const requestedUrls = new Set<string>();
  let sourceCount = 0;
  for (const toolRun of result.toolRuns) {
    const input = toolRun.input && typeof toolRun.input === "object" ? toolRun.input as Record<string, unknown> : {};
    readStringArray(input.urls).forEach((url) => requestedUrls.add(url));
    const output = toolRun.output && typeof toolRun.output === "object" ? toolRun.output as Record<string, unknown> : {};
    if (typeof output.sourceCount === "number" && output.sourceCount > sourceCount) {
      sourceCount = output.sourceCount;
    }
    const evidence = output.evidence && typeof output.evidence === "object" ? output.evidence as Record<string, unknown> : {};
    readStringArray(evidence.urlsFetched).forEach((url) => fetchedUrls.add(url));
    readStringArray(evidence.browserFallbackUrls).forEach((url) => browserFallbackUrls.add(url));
    readStringArray(output.warnings).forEach((warning) => warnings.add(warning));
    for (const artifact of readArtifactRecords(output.artifacts)) {
      const role = typeof artifact.role === "string" ? artifact.role : "";
      const path = typeof artifact.path === "string" ? artifact.path : "";
      if ((role !== "citation" && role !== "source") || !path || !existsSync(path)) {
        continue;
      }
      try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.size > 128 * 1024) {
          continue;
        }
        const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
        const records = Array.isArray(parsed) ? parsed : [];
        for (const record of records.slice(0, 20)) {
          if (!record || typeof record !== "object") {
            continue;
          }
          const item = record as Record<string, unknown>;
          const url = typeof item.url === "string" ? item.url : undefined;
          const title = typeof item.title === "string" ? item.title : undefined;
          const key = `${url ?? ""}\n${title ?? ""}`;
          if (rows.some((row) => `${row.url ?? ""}\n${row.title ?? ""}` === key)) {
            continue;
          }
          rows.push({
            title,
            url,
            status: typeof item.status === "string" ? item.status : undefined,
            browserFallback: item.browserFallback === true,
            chars: typeof item.chars === "number"
              ? item.chars
              : typeof item.text === "string"
                ? item.text.length
                : undefined,
            excerpt: typeof item.excerpt === "string"
              ? item.excerpt.slice(0, 160)
              : typeof item.text === "string"
                ? item.text.slice(0, 160)
                : undefined
          });
        }
      } catch {
        warnings.add(`source_summary_parse_failed:${role}`);
      }
    }
  }
  if (!sourceCount) {
    sourceCount = rows.length || fetchedUrls.size + browserFallbackUrls.size;
  }
  for (const warning of warnings) {
    const match = /^browser_fallback_used:([^:]+):/.exec(warning);
    if (!match) {
      continue;
    }
    const host = match[1];
    const url = [...requestedUrls].find((candidate) => readUrlHost(candidate) === host) ?? host;
    browserFallbackUrls.add(url);
  }
  for (const url of fetchedUrls) {
    if (!rows.some((row) => row.url === url)) {
      rows.push({ url, status: "fetched" });
    }
  }
  for (const url of browserFallbackUrls) {
    if (!rows.some((row) => row.url === url && row.browserFallback)) {
      rows.push({ url, status: "browser_fallback", browserFallback: true });
    }
  }
  return {
    sourceCount,
    rows: rows.slice(0, 12),
    fetchedUrls: [...fetchedUrls].slice(0, 12),
    browserFallbackUrls: [...browserFallbackUrls].slice(0, 12),
    warnings: [...warnings].slice(0, 20)
  };
}

export function readArtifactRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function readUrlHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export function readToolsmithVerification(output: unknown): unknown {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  return record.verification;
}
