import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type { ArtifactFilePreview } from "./types.js";
import type { StoragePaths } from "./paths.js";
import {
  inferMime,
  renderSimpleDiff,
  sanitizeBlobExtension
} from "./fileUtils.js";

const MAX_ARTIFACT_TEXT_PREVIEW_BYTES = 24 * 1024;
const MAX_ARTIFACT_IMAGE_PREVIEW_BYTES = 512 * 1024;

export type StoredBlob = {
  id: string;
  path: string;
  size: number;
  mime: string;
  hash: string;
};

export function writeBlob(paths: StoragePaths, bytes: Buffer, mime: string, displayName: string): StoredBlob {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const extension = sanitizeBlobExtension(extname(displayName));
  const dir = join(paths.blobDir, hash.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${hash}${extension}`);
  if (!existsSync(path)) {
    writeFileSync(path, bytes);
  }
  return {
    id: `blob:${hash}`,
    path,
    size: bytes.byteLength,
    mime,
    hash
  };
}

export function insertBlob(
  database: NodeDatabaseSync,
  blob: { id: string; path: string; size: number; mime: string }
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO blobs (id, path, size, mime, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(blob.id, blob.path, blob.size, blob.mime, new Date().toISOString());
}

export function readBlob(database: NodeDatabaseSync, id: string): StoredBlob | null {
  const row = database
    .prepare("SELECT id, path, size, mime FROM blobs WHERE id = ?")
    .get(id) as { id: string; path: string; size: number; mime: string } | undefined;
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    path: row.path,
    size: row.size,
    mime: row.mime,
    hash: row.id.startsWith("blob:") ? row.id.slice("blob:".length) : row.id
  };
}

export function readFileSnapshot(paths: StoragePaths, sourcePath: string): {
  blob: StoredBlob | null;
  mime: string;
  fileKind: string;
} {
  if (!existsSync(sourcePath)) {
    return {
      blob: null,
      mime: "application/octet-stream",
      fileKind: "missing"
    };
  }
  const stats = statSync(sourcePath);
  if (!stats.isFile()) {
    return {
      blob: null,
      mime: "application/octet-stream",
      fileKind: "directory"
    };
  }
  const bytes = readFileSync(sourcePath);
  const mime = inferMime(sourcePath, bytes);
  const fileKind = mime.startsWith("text/") || mime === "application/json" ? "text" : "binary";
  return {
    blob: writeBlob(paths, bytes, mime, basename(sourcePath)),
    mime,
    fileKind
  };
}

export function persistDiffForVersion(database: NodeDatabaseSync, paths: StoragePaths, versionId: string): void {
  const row = database
    .prepare(
      `SELECT before_blob.path AS before_path, after_blob.path AS after_path
       FROM artifact_versions
       LEFT JOIN blobs AS before_blob ON before_blob.id = artifact_versions.before_blob_id
       LEFT JOIN blobs AS after_blob ON after_blob.id = artifact_versions.after_blob_id
       WHERE artifact_versions.id = ?`
    )
    .get(versionId);
  if (typeof row?.before_path !== "string" || typeof row?.after_path !== "string") {
    return;
  }
  const beforeText = readUtf8IfText(row.before_path);
  const afterText = readUtf8IfText(row.after_path);
  if (beforeText === null || afterText === null || beforeText === afterText) {
    return;
  }
  const diff = renderSimpleDiff(beforeText, afterText);
  const blob = writeBlob(paths, Buffer.from(diff, "utf8"), "text/x-diff", `${versionId}.diff`);
  insertBlob(database, blob);
  database.prepare("UPDATE artifact_versions SET diff_blob_id = ? WHERE id = ?").run(blob.id, versionId);
}

export function readArtifactFilePreview(input: {
  path?: string;
  mime: string;
  displayName: string;
  size?: number;
}): ArtifactFilePreview | undefined {
  if (!input.path || !existsSync(input.path)) {
    return undefined;
  }
  if (input.mime.startsWith("image/")) {
    return readImageArtifactPreview(input.path, input.mime, input.size);
  }
  if (!isPreviewTextFile(input.mime, input.displayName)) {
    return undefined;
  }
  return readTextArtifactPreview(input.path, input.mime);
}

function readUtf8IfText(path: string): string | null {
  try {
    const bytes = readFileSync(path);
    if (bytes.includes(0)) {
      return null;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function readTextArtifactPreview(path: string, mime: string): ArtifactFilePreview | undefined {
  try {
    const bytes = readFileSync(path);
    const truncated = bytes.byteLength > MAX_ARTIFACT_TEXT_PREVIEW_BYTES;
    const previewBytes = truncated ? bytes.subarray(0, MAX_ARTIFACT_TEXT_PREVIEW_BYTES) : bytes;
    if (previewBytes.includes(0)) {
      return undefined;
    }
    return {
      kind: "text",
      mime,
      data: new TextDecoder("utf-8", { fatal: true }).decode(previewBytes),
      truncated,
      size: bytes.byteLength
    };
  } catch {
    return undefined;
  }
}

function readImageArtifactPreview(path: string, mime: string, knownSize?: number): ArtifactFilePreview | undefined {
  try {
    const size = knownSize && knownSize > 0 ? knownSize : statSync(path).size;
    if (size > MAX_ARTIFACT_IMAGE_PREVIEW_BYTES) {
      return undefined;
    }
    const bytes = readFileSync(path);
    return {
      kind: "image",
      mime,
      data: `data:${mime};base64,${bytes.toString("base64")}`,
      size: bytes.byteLength
    };
  } catch {
    return undefined;
  }
}

function isPreviewTextFile(mime: string, displayName: string): boolean {
  const normalizedMime = mime.toLowerCase();
  const extension = extname(displayName).toLowerCase();
  return (
    normalizedMime.startsWith("text/") ||
    [
      "application/json",
      "application/javascript",
      "application/typescript",
      "application/xml",
      "application/yaml",
      "text/x-python",
      "text/x-shellscript",
      "text/x-powershell"
    ].includes(normalizedMime) ||
    [
      ".md",
      ".txt",
      ".json",
      ".jsonl",
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".py",
      ".ps1",
      ".sh",
      ".css",
      ".html",
      ".xml",
      ".yml",
      ".yaml",
      ".csv",
      ".log",
      ".diff",
      ".patch",
      ".toml",
      ".rs"
    ].includes(extension)
  );
}
