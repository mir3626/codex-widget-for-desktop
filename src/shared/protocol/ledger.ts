export type ArtifactKind = "generated" | "modified" | "deleted" | "external";

export type ArtifactFileVersionSummary = {
  id: string;
  label?: string;
  operation?: "create" | "modify" | "delete";
  sourcePath?: string;
  size?: number;
  createdAt: string;
  hasBefore: boolean;
  hasAfter: boolean;
  hasDiff: boolean;
};

export type ArtifactFilePreview = {
  kind: "text" | "image";
  mime: string;
  data: string;
  truncated?: boolean;
  size?: number;
};

export type ArtifactFileSummary = {
  id: string;
  artifactId: string;
  logicalPath: string;
  displayName: string;
  fileKind: string;
  mime: string;
  currentVersionId?: string;
  currentVersionLabel?: string;
  operation?: "create" | "modify" | "delete";
  sourcePath?: string;
  size?: number;
  createdAt: string;
  versions?: ArtifactFileVersionSummary[];
  preview?: ArtifactFilePreview;
};

export type ArtifactSummary = {
  id: string;
  sessionId?: string;
  messageId?: string;
  title: string;
  kind: ArtifactKind;
  status: "active" | "trashed";
  createdAt: string;
  updatedAt: string;
  files: ArtifactFileSummary[];
};

export type ActivityLogEntry = {
  id: string;
  sessionId?: string;
  level: "debug" | "info" | "warn" | "error";
  category: string;
  summary: string;
  detail?: unknown;
  createdAt: string;
};

export type ProviderSnapshotProvider = "dom" | "vision" | "terminal";

export type ProviderSnapshotSummary = {
  id: string;
  sessionId?: string;
  messageId?: string;
  provider: ProviderSnapshotProvider;
  title: string;
  summary: string;
  data?: unknown;
  capturedAt: string;
};

export type LedgerSnapshot = {
  sessionId: string;
  artifacts: ArtifactSummary[];
  activities: ActivityLogEntry[];
  providerSnapshots: ProviderSnapshotSummary[];
};

export type ArtifactFileChangePhase = "before" | "after";

export type ArtifactFileChangeEvent = {
  type: "artifact.fileChange";
  id: string;
  changeId: string;
  phase: ArtifactFileChangePhase;
  title: string;
  operation: "create" | "modify" | "delete";
  paths: string[];
  detail?: unknown;
};
