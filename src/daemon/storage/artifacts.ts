import { existsSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type { StoragePaths } from "./paths.js";
import type {
  FileChangeArtifactInput,
  ProviderSnapshotInput,
  TextArtifactInput
} from "./types.js";
import {
  readFileSnapshot,
  insertBlob,
  persistDiffForVersion,
  writeBlob
} from "./blobs.js";
import {
  artifactKindFromOperation,
  sanitizeProviderSummary,
  stableId,
  stringifyBoundedJson
} from "./normalizers.js";
import {
  resolveWorkspacePath,
  safeRelativePath,
  slugify
} from "./fileUtils.js";

export {
  readActivities,
  readArtifacts,
  readProviderSnapshots
} from "./artifactReaders.js";

export function recordProviderSnapshot(database: NodeDatabaseSync, input: ProviderSnapshotInput): void {
  const dataJson = stringifyBoundedJson(input.data ?? {}, 32 * 1024);
  database
    .prepare(
      `INSERT INTO provider_snapshots (id, session_id, message_id, provider, title, summary, data_json, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      input.sessionId ?? null,
      input.messageId ?? null,
      input.provider,
      input.title.slice(0, 160),
      sanitizeProviderSummary(input.summary),
      dataJson,
      input.capturedAt ?? new Date().toISOString()
    );
}

export function recordTextArtifact(database: NodeDatabaseSync, paths: StoragePaths, input: TextArtifactInput): void {
  const text = input.text.trimEnd();
  if (!text) {
    return;
  }

  const now = input.createdAt ?? new Date().toISOString();
  const artifactId = randomUUID();
  const fileId = randomUUID();
  const versionId = randomUUID();
  const logicalPath = input.logicalPath ?? `${slugify(input.title)}.txt`;
  const displayName = input.displayName ?? basename(logicalPath);
  const blob = writeBlob(paths, Buffer.from(text, "utf8"), input.mime ?? "text/plain", displayName);

  database.exec("BEGIN IMMEDIATE");
  try {
    insertBlob(database, blob);
    database
      .prepare(
        `INSERT INTO artifacts (id, session_id, message_id, title, kind, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'generated', 'active', ?, ?)`
      )
      .run(artifactId, input.sessionId, input.messageId ?? null, sanitizeArtifactTitle(input.title, "Generated artifact"), now, now);
    database
      .prepare(
        `INSERT INTO artifact_files (id, artifact_id, logical_path, display_name, file_kind, mime, current_version_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(fileId, artifactId, logicalPath, displayName, input.fileKind ?? "text", input.mime ?? "text/plain", versionId, now);
    database
      .prepare(
        `INSERT INTO artifact_versions (
          id, artifact_file_id, version_label, operation, source_path, after_blob_id, after_hash, size, created_by_message_id, created_at
        )
        VALUES (?, ?, ?, 'create', ?, ?, ?, ?, ?, ?)`
      )
      .run(versionId, fileId, "v1", "", blob.id, blob.hash, blob.size, input.messageId ?? null, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function recordFileChangeArtifact(database: NodeDatabaseSync, paths: StoragePaths, input: FileChangeArtifactInput): void {
  const normalizedFiles = input.paths
    .map((filePath) => resolveWorkspacePath(input.workspaceRoot, filePath))
    .filter((filePath): filePath is string => Boolean(filePath))
    .slice(0, 20);
  if (normalizedFiles.length === 0) {
    return;
  }

  const now = input.createdAt ?? new Date().toISOString();
  const artifactId = stableId("artifact", input.sessionId, input.changeId);
  const kind = artifactKindFromOperation(input.operation);

  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `INSERT INTO artifacts (id, session_id, message_id, title, kind, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           kind = excluded.kind,
           updated_at = excluded.updated_at`
      )
      .run(artifactId, input.sessionId, input.messageId ?? null, input.title, kind, now, now);

    for (const sourcePath of normalizedFiles) {
      const relativePath = safeRelativePath(input.workspaceRoot, sourcePath);
      const fileId = stableId("artifact-file", artifactId, relativePath);
      const existingFile = database.prepare("SELECT current_version_id FROM artifact_files WHERE id = ?").get(fileId);
      const versionId = typeof existingFile?.current_version_id === "string" ? existingFile.current_version_id : stableId("artifact-version", fileId, "v1");
      const snapshot = readFileSnapshot(paths, sourcePath);
      const beforeColumn = input.phase === "before" ? "before_blob_id" : "after_blob_id";
      const beforeHashColumn = input.phase === "before" ? "before_hash" : "after_hash";
      const blobId = snapshot.blob?.id ?? null;
      if (snapshot.blob) {
        insertBlob(database, snapshot.blob);
      }

      database
        .prepare(
          `INSERT INTO artifact_files (id, artifact_id, logical_path, display_name, file_kind, mime, current_version_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             logical_path = excluded.logical_path,
             display_name = excluded.display_name,
             file_kind = excluded.file_kind,
             mime = excluded.mime,
             current_version_id = excluded.current_version_id`
        )
        .run(fileId, artifactId, relativePath, basename(sourcePath), snapshot.fileKind, snapshot.mime, versionId, now);

      database
        .prepare(
          `INSERT INTO artifact_versions (
            id, artifact_file_id, version_label, operation, source_path, ${beforeColumn}, ${beforeHashColumn},
            size, created_by_message_id, created_at
          )
          VALUES (?, ?, 'v1', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            operation = excluded.operation,
            source_path = excluded.source_path,
            ${beforeColumn} = excluded.${beforeColumn},
            ${beforeHashColumn} = excluded.${beforeHashColumn},
            size = COALESCE(excluded.size, size),
            created_by_message_id = COALESCE(excluded.created_by_message_id, created_by_message_id)`
        )
        .run(versionId, fileId, input.operation, sourcePath, blobId, snapshot.blob?.hash ?? null, snapshot.blob?.size ?? null, input.messageId ?? null, now);

      if (input.phase === "after") {
        persistDiffForVersion(database, paths, versionId);
      }
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function resolveArtifactOpenPath(database: NodeDatabaseSync, artifactFileId: string, versionId?: string): string | null {
  const row = database
    .prepare(
      `SELECT artifact_versions.source_path AS source_path,
              after_blob.path AS after_blob_path,
              before_blob.path AS before_blob_path
       FROM artifact_files
       LEFT JOIN artifact_versions ON artifact_versions.id = COALESCE(?, artifact_files.current_version_id)
       LEFT JOIN blobs AS after_blob ON after_blob.id = artifact_versions.after_blob_id
       LEFT JOIN blobs AS before_blob ON before_blob.id = artifact_versions.before_blob_id
       WHERE artifact_files.id = ?
         AND artifact_versions.artifact_file_id = artifact_files.id`
    )
    .get(versionId ?? null, artifactFileId);

  for (const value of [row?.after_blob_path, row?.source_path, row?.before_blob_path]) {
    if (typeof value === "string" && value && existsSync(value)) {
      return value;
    }
  }
  return null;
}

export function recordActivity(
  database: NodeDatabaseSync,
  input: {
    id: string;
    sessionId?: string | null;
    level?: "debug" | "info" | "warn" | "error";
    category: string;
    summary: string;
    detail?: unknown;
    createdAt?: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO activity_log (id, session_id, level, category, summary, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.sessionId ?? null,
      input.level ?? "info",
      input.category,
      input.summary,
      JSON.stringify(input.detail ?? {}),
      input.createdAt ?? new Date().toISOString()
    );
}

function sanitizeArtifactTitle(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 54 ? `${normalized.slice(0, 53)}...` : normalized;
}
