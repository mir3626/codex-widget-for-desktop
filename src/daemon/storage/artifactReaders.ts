import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type {
  ActivityLogEntry,
  ArtifactSummary,
  ProviderSnapshotSummary
} from "./types.js";
import { readArtifactFilePreview } from "./blobs.js";
import {
  normalizeActivityLevel,
  normalizeArtifactKind,
  normalizeArtifactOperation,
  normalizeProviderSnapshotProvider,
  optionalString,
  parseJsonField,
  stringOrNow
} from "./normalizers.js";

export function readArtifacts(database: NodeDatabaseSync, sessionId: string): ArtifactSummary[] {
  const artifacts = database
    .prepare(
      `SELECT id, session_id, message_id, title, kind, status, created_at, updated_at
       FROM artifacts
       WHERE session_id = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 40`
    )
    .all(sessionId);

  return artifacts.flatMap((artifact) => {
    const record = artifact as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.title !== "string") {
      return [];
    }
    return [{
      id: record.id,
      sessionId: optionalString(record.session_id),
      messageId: optionalString(record.message_id),
      title: record.title,
      kind: normalizeArtifactKind(record.kind),
      status: record.status === "trashed" ? "trashed" : "active",
      createdAt: stringOrNow(record.created_at),
      updatedAt: stringOrNow(record.updated_at),
      files: readArtifactFiles(database, record.id)
    }];
  });
}

export function readActivities(database: NodeDatabaseSync, sessionId: string): ActivityLogEntry[] {
  return database
    .prepare(
      `SELECT id, session_id, level, category, summary, detail_json, created_at
       FROM activity_log
       WHERE session_id = ? OR session_id IS NULL
       ORDER BY created_at DESC
       LIMIT 80`
    )
    .all(sessionId)
    .flatMap((activity) => {
      const record = activity as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.summary !== "string") {
        return [];
      }
      return [{
        id: record.id,
        sessionId: optionalString(record.session_id),
        level: normalizeActivityLevel(record.level),
        category: optionalString(record.category) ?? "general",
        summary: record.summary,
        detail: parseJsonField(record.detail_json),
        createdAt: stringOrNow(record.created_at)
      }];
    });
}

export function readProviderSnapshots(database: NodeDatabaseSync, sessionId: string): ProviderSnapshotSummary[] {
  return database
    .prepare(
      `SELECT id, session_id, message_id, provider, title, summary, data_json, captured_at
       FROM provider_snapshots
       WHERE session_id = ? OR session_id IS NULL
       ORDER BY captured_at DESC
       LIMIT 40`
    )
    .all(sessionId)
    .flatMap((snapshot) => {
      const record = snapshot as Record<string, unknown>;
      if (typeof record.id !== "string") {
        return [];
      }
      return [{
        id: record.id,
        sessionId: optionalString(record.session_id),
        messageId: optionalString(record.message_id),
        provider: normalizeProviderSnapshotProvider(record.provider),
        title: optionalString(record.title) ?? "Provider snapshot",
        summary: optionalString(record.summary) ?? "",
        data: parseJsonField(record.data_json),
        capturedAt: stringOrNow(record.captured_at)
      }];
    });
}

function readArtifactFiles(database: NodeDatabaseSync, artifactId: string): ArtifactSummary["files"] {
  return database
    .prepare(
      `SELECT artifact_files.id,
              artifact_files.artifact_id,
              artifact_files.logical_path,
              artifact_files.display_name,
              artifact_files.file_kind,
              artifact_files.mime,
              artifact_files.current_version_id,
              artifact_files.created_at,
              artifact_versions.version_label,
              artifact_versions.operation,
              artifact_versions.source_path,
              artifact_versions.size,
              after_blob.path AS after_blob_path,
              before_blob.path AS before_blob_path
       FROM artifact_files
       LEFT JOIN artifact_versions ON artifact_versions.id = artifact_files.current_version_id
       LEFT JOIN blobs AS after_blob ON after_blob.id = artifact_versions.after_blob_id
       LEFT JOIN blobs AS before_blob ON before_blob.id = artifact_versions.before_blob_id
       WHERE artifact_files.artifact_id = ?
       ORDER BY artifact_files.created_at ASC, artifact_files.display_name ASC`
    )
    .all(artifactId)
    .flatMap((file) => {
      const record = file as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.display_name !== "string") {
        return [];
      }
      const mime = optionalString(record.mime) ?? "application/octet-stream";
      const sourcePath = optionalString(record.source_path);
      const previewPath =
        optionalString(record.after_blob_path) ??
        sourcePath ??
        optionalString(record.before_blob_path);
      const size = typeof record.size === "number" ? record.size : Number(record.size ?? 0);
      return [{
        id: record.id,
        artifactId,
        logicalPath: optionalString(record.logical_path) ?? record.display_name,
        displayName: record.display_name,
        fileKind: optionalString(record.file_kind) ?? "unknown",
        mime,
        currentVersionId: optionalString(record.current_version_id),
        currentVersionLabel: optionalString(record.version_label),
        operation: normalizeArtifactOperation(record.operation),
        sourcePath,
        size,
        createdAt: stringOrNow(record.created_at),
        versions: readArtifactFileVersions(database, record.id),
        preview: readArtifactFilePreview({
          path: previewPath,
          mime,
          displayName: record.display_name,
          size
        })
      }];
    });
}

function readArtifactFileVersions(database: NodeDatabaseSync, artifactFileId: string): ArtifactSummary["files"][number]["versions"] {
  return database
    .prepare(
      `SELECT artifact_versions.id,
              artifact_versions.version_label,
              artifact_versions.operation,
              artifact_versions.source_path,
              artifact_versions.size,
              artifact_versions.before_blob_id,
              artifact_versions.after_blob_id,
              artifact_versions.diff_blob_id,
              artifact_versions.created_at
       FROM artifact_versions
       WHERE artifact_file_id = ?
       ORDER BY created_at DESC, version_label DESC`
    )
    .all(artifactFileId)
    .flatMap((version) => {
      const record = version as Record<string, unknown>;
      if (typeof record.id !== "string") {
        return [];
      }
      return [{
        id: record.id,
        label: optionalString(record.version_label),
        operation: normalizeArtifactOperation(record.operation),
        sourcePath: optionalString(record.source_path),
        size: typeof record.size === "number" ? record.size : Number(record.size ?? 0),
        createdAt: stringOrNow(record.created_at),
        hasBefore: typeof record.before_blob_id === "string" && record.before_blob_id.length > 0,
        hasAfter: typeof record.after_blob_id === "string" && record.after_blob_id.length > 0,
        hasDiff: typeof record.diff_blob_id === "string" && record.diff_blob_id.length > 0
      }];
    });
}
