import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { ComputerSessionObservationResourceSummary } from "../../shared/protocol.js";

type TerminalOutputRootSnapshot = {
  root: string;
  files: Map<string, { size: number; mtimeMs: number; sha256: string }>;
};

type TerminalOutputRootDeltaEntry = {
  path: string;
  root: string;
  change: "created" | "modified" | "deleted";
  basename: string;
  relativePathHash: string;
  depth: number;
  size?: number;
  mtimeMs?: number;
  sha256?: string;
  previousSize?: number;
  previousSha256?: string;
};

type TerminalOutputRootDeltaResult = {
  resources: ComputerSessionObservationResourceSummary[];
  manifestResource?: ComputerSessionObservationResourceSummary;
  summary: {
    outputRootCount: number;
    createdCount: number;
    modifiedCount: number;
    deletedCount: number;
    capturedArtifactCount: number;
    manifestEntryCount: number;
    omittedEntryCount: number;
    rollbackCandidateCount: number;
  };
  rollbackTargets: TerminalArtifactRollbackTarget[];
};

type TerminalArtifactRollbackTarget = {
  path: string;
  basename: string;
  sha256: string;
  size: number;
  change: "created";
  blobId?: string;
  evalResourceId?: string;
};

export function readExpectedTerminalArtifacts(value: unknown): Array<{
  path: string;
  role?: string;
  mime?: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      path: typeof item.path === "string" ? item.path.trim() : "",
      role: typeof item.role === "string" && item.role.trim() ? item.role.trim() : undefined,
      mime: typeof item.mime === "string" && item.mime.trim() ? item.mime.trim() : undefined
    }))
    .filter((item) => item.path);
}

export function readTerminalArtifactRollbackTargets(value: unknown): TerminalArtifactRollbackTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const targets: TerminalArtifactRollbackTarget[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.change !== "created" || typeof record.path !== "string" || typeof record.sha256 !== "string") {
      continue;
    }
    targets.push({
      path: record.path,
      basename: typeof record.basename === "string" ? record.basename : basename(record.path),
      sha256: record.sha256,
      size: typeof record.size === "number" && Number.isFinite(record.size) ? record.size : 0,
      change: "created",
      blobId: typeof record.blobId === "string" ? record.blobId : undefined,
      evalResourceId: typeof record.evalResourceId === "string" ? record.evalResourceId : undefined
    });
  }
  return targets;
}

export function readTerminalOutputRoots(input: Record<string, unknown>): string[] {
  const candidates = [
    input.trackOutputRoots,
    input.outputRoots,
    input.expectedOutputRoots
  ];
  const roots: string[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    for (const value of candidate) {
      if (typeof value === "string" && value.trim()) {
        roots.push(value.trim());
      }
    }
  }
  return roots;
}

export function snapshotTerminalOutputRoot(root: string): TerminalOutputRootSnapshot["files"] {
  const files = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
  for (const path of listTerminalOutputRootFiles(root, 200)) {
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
        continue;
      }
      const bytes = readFileSync(path);
      files.set(path, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: createHash("sha256").update(bytes).digest("hex")
      });
    } catch {
      // Best-effort diffing must not turn terminal execution into a failure.
    }
  }
  return files;
}

export function diffTerminalOutputRootSnapshot(snapshot: TerminalOutputRootSnapshot): { entries: TerminalOutputRootDeltaEntry[]; omittedEntryCount: number } {
  const entries: TerminalOutputRootDeltaEntry[] = [];
  const currentPaths = new Set<string>();
  const currentFiles = listTerminalOutputRootFiles(snapshot.root, 250);
  for (const path of currentFiles) {
    currentPaths.add(path);
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
        continue;
      }
      const bytes = readFileSync(path);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const previous = snapshot.files.get(path);
      if (!previous) {
        entries.push(createTerminalOutputRootDeltaEntry(snapshot.root, path, "created", {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256
        }));
      } else if (previous.size !== stat.size || previous.sha256 !== sha256) {
        entries.push(createTerminalOutputRootDeltaEntry(snapshot.root, path, "modified", {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256,
          previousSize: previous.size,
          previousSha256: previous.sha256
        }));
      }
    } catch {
      // Ignore files that disappeared or became unreadable during command execution.
    }
  }
  for (const [path, previous] of snapshot.files.entries()) {
    if (!currentPaths.has(path)) {
      entries.push(createTerminalOutputRootDeltaEntry(snapshot.root, path, "deleted", {
        previousSize: previous.size,
        previousSha256: previous.sha256
      }));
    }
  }
  const omittedEntryCount = Math.max(0, entries.length - 100) + (currentFiles.length >= 250 ? 1 : 0);
  return { entries: entries.slice(0, 100), omittedEntryCount };
}

export function createTerminalOutputRootDeltaEntry(
  root: string,
  path: string,
  change: TerminalOutputRootDeltaEntry["change"],
  metadata: {
    size?: number;
    mtimeMs?: number;
    sha256?: string;
    previousSize?: number;
    previousSha256?: string;
  }
): TerminalOutputRootDeltaEntry {
  const relativePath = relative(root, path);
  const normalizedRelativePath = relativePath.split("\\").join("/");
  return {
    path,
    root,
    change,
    basename: basename(path),
    relativePathHash: createHash("sha256").update(normalizedRelativePath || basename(path), "utf8").digest("hex"),
    depth: normalizedRelativePath ? normalizedRelativePath.split("/").filter(Boolean).length : 0,
    ...metadata
  };
}

export function emptyTerminalOutputRootDeltaResult(): TerminalOutputRootDeltaResult {
  return {
    resources: [],
    summary: {
      outputRootCount: 0,
      createdCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      capturedArtifactCount: 0,
      manifestEntryCount: 0,
      omittedEntryCount: 0,
      rollbackCandidateCount: 0
    },
    rollbackTargets: []
  };
}

export function buildTerminalOutputRootDeltaManifest(input: {
  sessionId: string;
  dagNodeId: string;
  entries: TerminalOutputRootDeltaEntry[];
  outputRootCount: number;
  omittedEntryCount: number;
  capturedArtifactCount: number;
  rollbackCandidateCount: number;
}): {
  schemaVersion: "computer-session-terminal-artifact-delta.v1";
  sessionId: string;
  dagNodeId: string;
  summary: TerminalOutputRootDeltaResult["summary"];
  entries: Array<Record<string, unknown>>;
  redaction: Record<string, unknown>;
} {
  const createdCount = input.entries.filter((entry) => entry.change === "created").length;
  const modifiedCount = input.entries.filter((entry) => entry.change === "modified").length;
  const deletedCount = input.entries.filter((entry) => entry.change === "deleted").length;
  return {
    schemaVersion: "computer-session-terminal-artifact-delta.v1",
    sessionId: input.sessionId,
    dagNodeId: input.dagNodeId,
    summary: {
      outputRootCount: input.outputRootCount,
      createdCount,
      modifiedCount,
      deletedCount,
      capturedArtifactCount: input.capturedArtifactCount,
      manifestEntryCount: input.entries.length,
      omittedEntryCount: input.omittedEntryCount,
      rollbackCandidateCount: input.rollbackCandidateCount
    },
    entries: input.entries.map((entry) => ({
      change: entry.change,
      basename: entry.basename,
      relativePathHash: entry.relativePathHash,
      depth: entry.depth,
      size: entry.size,
      sha256: entry.sha256,
      previousSize: entry.previousSize,
      previousSha256: entry.previousSha256
    })),
    redaction: {
      absolutePaths: "not_stored_in_manifest",
      roots: "hashed_only",
      credentials: "not_applicable",
      rollbackTargets: "stored_in_session_state_for_confirmed_delete_only"
    }
  };
}

export function listTerminalOutputRootFiles(root: string, limit: number): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const stack = [root];
  while (stack.length && files.length < limit) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile()) {
        files.push(path);
        if (files.length >= limit) {
          break;
        }
      }
    }
  }
  return files;
}

export function isPathWithinAnyRoot(path: string, roots: string[]): boolean {
  const absolutePath = resolve(path);
  return roots.some((root) => {
    const absoluteRoot = resolve(root);
    const relation = relative(absoluteRoot, absolutePath);
    return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
  });
}
