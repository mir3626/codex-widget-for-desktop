import { Camera, FileText, FolderOpen, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import type { ArtifactSummary } from "../../shared/protocol.js";

type ArtifactLedgerProps = {
  artifacts: ArtifactSummary[];
  onOpenFile: (artifactFileId: string, versionId?: string) => void;
  density?: "default" | "compact";
};

type ArtifactFile = ArtifactSummary["files"][number];
type ArtifactFileVersion = NonNullable<ArtifactFile["versions"]>[number];

export function ArtifactLedger({ artifacts, onOpenFile, density = "default" }: ArtifactLedgerProps) {
  return (
    <section className={`artifact-ledger ${density === "compact" ? "compact" : ""}`} aria-label="Artifacts">
      <div className="artifact-ledger-head">
        <FileText size={14} />
        <strong>Artifacts</strong>
        <span>{artifacts.length}</span>
      </div>
      <div className="artifact-list">
        {artifacts.map((artifact) => (
          <details key={artifact.id} className="artifact-card">
            <summary>
              {renderArtifactKindBadge(artifact)}
              <strong>{artifact.title}</strong>
              <small>{formatArtifactSummaryMeta(artifact)}</small>
            </summary>
            <div className="artifact-files">
              {artifact.files.map((file) => {
                const versions = file.versions ?? [];
                return (
                  <div key={file.id} className="artifact-file-card">
                    <button
                      type="button"
                      className="artifact-file-open"
                      onClick={() => onOpenFile(file.id)}
                      data-tooltip={file.sourcePath ?? file.logicalPath}
                      aria-label={`Open ${file.displayName}`}
                    >
                      <span className={`artifact-file-icon ${artifactFileVisualKind(file)}`}>
                        {renderArtifactFileIcon(file)}
                      </span>
                      <span className="artifact-file-main">
                        <strong>{file.displayName}</strong>
                        <small>{formatArtifactFileMeta(file)}</small>
                      </span>
                    </button>
                    {file.preview ? renderArtifactFilePreview(file) : null}
                    {versions.length > 0 ? (
                      <details className="artifact-version-list">
                        <summary>
                          <span>{versions.length} version{versions.length === 1 ? "" : "s"}</span>
                          {file.currentVersionLabel ? <small>current {file.currentVersionLabel}</small> : null}
                        </summary>
                        <div className="artifact-version-items">
                          {versions.map((version) => (
                            <button
                              key={version.id}
                              type="button"
                              className={version.id === file.currentVersionId ? "artifact-version active" : "artifact-version"}
                              onClick={() => onOpenFile(file.id, version.id)}
                              data-tooltip={version.sourcePath ?? file.logicalPath}
                              aria-label={`Open ${file.displayName} ${version.label ?? "version"}`}
                            >
                              <span>
                                <strong>{version.label ?? "version"}</strong>
                                <small>{formatArtifactVersionMeta(version)}</small>
                              </span>
                              <em>{formatArtifactVersionAvailability(version)}</em>
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function renderArtifactKindBadge(artifact: ArtifactSummary): ReactNode {
  if (artifact.kind !== "generated") {
    return <span className={`artifact-kind ${artifact.kind}`}>{artifact.kind}</span>;
  }

  const file = artifact.files[0];
  const visual = file ? readArtifactFileVisual(file) : readFallbackFileVisual();
  return (
    <span className={`artifact-kind generated ${visual.tone}`} aria-label={`${visual.name} generated`}>
      {file ? renderArtifactFileIcon(file, 11) : <FileText size={11} />}
      <span>{visual.extension}</span>
    </span>
  );
}

function renderArtifactFileIcon(file: ArtifactFile, size = 13): ReactNode {
  const visualKind = artifactFileVisualKind(file);
  if (visualKind === "image") {
    return <Camera size={size} />;
  }
  if (visualKind === "script") {
    return <SquareTerminal size={size} />;
  }
  if (visualKind === "folder") {
    return <FolderOpen size={size} />;
  }
  return <FileText size={size} />;
}

function readArtifactFileVisual(file: ArtifactFile): { extension: string; name: string; tone: string } {
  if (file.fileKind === "directory") {
    return { extension: "DIR", name: "Folder", tone: "folder" };
  }

  const extension = readFileExtension(file);
  const normalized = extension.toLowerCase();
  if (normalized === "md" || normalized === "markdown") {
    return { extension: "MD", name: "Markdown", tone: "markdown" };
  }
  if (normalized === "tsx" || normalized === "ts") {
    return { extension: extension.toUpperCase(), name: "TypeScript", tone: "typescript" };
  }
  if (["jsx", "js", "mjs", "cjs"].includes(normalized)) {
    return { extension: extension.toUpperCase(), name: "JavaScript", tone: "javascript" };
  }
  if (normalized === "py") {
    return { extension: "PY", name: "Python", tone: "python" };
  }
  if (["ps1", "sh", "bat", "cmd"].includes(normalized)) {
    return { extension: extension.toUpperCase(), name: "Script", tone: "script" };
  }
  if (normalized === "json") {
    return { extension: "JSON", name: "Data", tone: "data" };
  }
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(normalized)) {
    return { extension: extension.toUpperCase(), name: "Image", tone: "image" };
  }
  if (["html", "css"].includes(normalized)) {
    return { extension: extension.toUpperCase(), name: "Web", tone: "web" };
  }
  if (normalized === "pdf") {
    return { extension: "PDF", name: "Document", tone: "document" };
  }
  if (normalized === "csv") {
    return { extension: "CSV", name: "Table", tone: "data" };
  }
  if (normalized === "txt" || normalized === "log") {
    return { extension: extension.toUpperCase(), name: "Text", tone: "document" };
  }
  if (extension) {
    return { extension: extension.toUpperCase(), name: "File", tone: artifactFileVisualKind(file) };
  }
  return readFallbackFileVisual();
}

function readFallbackFileVisual(): { extension: string; name: string; tone: string } {
  return { extension: "FILE", name: "File", tone: "document" };
}

function readFileExtension(file: ArtifactFile): string {
  const source = file.displayName || file.logicalPath || file.sourcePath || "";
  const cleanName = source.split(/[\\/]/).pop() ?? "";
  const match = /\.([A-Za-z0-9]+)$/.exec(cleanName);
  return match?.[1] ?? "";
}

function renderArtifactFilePreview(file: ArtifactFile): ReactNode {
  if (!file.preview) {
    return null;
  }
  if (file.preview.kind === "image") {
    return (
      <div className="artifact-preview-image-frame" aria-hidden="true">
        <img className="artifact-preview-image" src={file.preview.data} alt="" />
      </div>
    );
  }
  return (
    <pre className="artifact-preview-text">
      {file.preview.data}
      {file.preview.truncated ? "\n... preview truncated ..." : ""}
    </pre>
  );
}

function artifactFileVisualKind(file: ArtifactFile): "document" | "folder" | "image" | "script" {
  const mime = file.mime.toLowerCase();
  const name = file.displayName.toLowerCase();
  if (mime.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|svg)$/.test(name)) {
    return "image";
  }
  if (
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    mime.includes("python") ||
    /\.(?:cjs|mjs|js|jsx|ts|tsx|py|ps1|sh|bat|cmd)$/.test(name)
  ) {
    return "script";
  }
  if (file.fileKind === "directory") {
    return "folder";
  }
  return "document";
}

function formatArtifactFileMeta(file: ArtifactFile): string {
  return [
    file.operation,
    file.currentVersionLabel,
    formatArtifactTimestamp(file.createdAt),
    file.fileKind,
    formatFileSize(file.size)
  ].filter(Boolean).join(" · ");
}

function formatArtifactVersionMeta(version: ArtifactFileVersion): string {
  return [
    version.operation,
    formatArtifactTimestamp(version.createdAt),
    formatFileSize(version.size),
    version.sourcePath ? "snapshot" : null
  ].filter(Boolean).join(" · ");
}

function formatArtifactSummaryMeta(artifact: ArtifactSummary): string {
  const firstVersionLabel = artifact.files.find((file) => file.currentVersionLabel)?.currentVersionLabel;
  return [
    `${artifact.files.length} file${artifact.files.length === 1 ? "" : "s"}`,
    firstVersionLabel,
    formatArtifactTimestamp(artifact.updatedAt || artifact.createdAt)
  ].filter(Boolean).join(" · ");
}

function formatArtifactTimestamp(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatArtifactVersionAvailability(version: ArtifactFileVersion): string {
  const preserved = version.hasBefore || version.hasAfter || version.hasDiff;
  if (!preserved && !version.sourcePath) {
    return "metadata";
  }
  return preserved ? "preserved" : "source";
}

function formatFileSize(value: number | undefined): string {
  if (!value || value < 0) {
    return "";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
