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
              <span className={`artifact-kind ${artifact.kind}`}>{artifact.kind}</span>
              <strong>{artifact.title}</strong>
              <small>{artifact.files.length} files</small>
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
                      title={file.sourcePath ?? file.logicalPath}
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
                              title={version.sourcePath ?? file.logicalPath}
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

function renderArtifactFileIcon(file: ArtifactFile): ReactNode {
  const visualKind = artifactFileVisualKind(file);
  if (visualKind === "image") {
    return <Camera size={13} />;
  }
  if (visualKind === "script") {
    return <SquareTerminal size={13} />;
  }
  if (visualKind === "folder") {
    return <FolderOpen size={13} />;
  }
  return <FileText size={13} />;
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
    file.fileKind,
    formatFileSize(file.size)
  ].filter(Boolean).join(" · ");
}

function formatArtifactVersionMeta(version: ArtifactFileVersion): string {
  return [
    version.operation,
    formatFileSize(version.size),
    version.sourcePath ? "snapshot" : null
  ].filter(Boolean).join(" · ");
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
