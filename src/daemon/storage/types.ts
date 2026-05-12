import type {
  BranchContextMessage,
  ActivityLogEntry,
  ArtifactFilePreview,
  ArtifactKind,
  ArtifactSummary,
  ExecutionPermissionDecision,
  ExecutionPermissionSummary,
  LedgerSnapshot,
  MessageSnapshotStatus,
  ModelId,
  ProviderSnapshotProvider,
  ProviderSnapshotSummary,
  ReasoningEffort,
  SessionMessage,
  SessionSnapshot,
  SessionSummary,
  VisionStreamMode,
  VisionStreamStatus,
  VisionStreamSummary,
  WidgetMode,
  CapabilityJobSummary,
  CapabilityLockSummary,
  CapabilityResourceSummary
} from "../../shared/protocol.js";
import type {
  CapabilityJobCreateInput,
  CapabilityJobEventInput,
  CapabilityJobUpdateInput,
  CapabilityLockAcquireInput,
  CapabilityResourceCreateInput
} from "./capabilityJobs.js";
import type { BrowserActionPolicy } from "../browser-action/types.js";
import type { StoredBlob } from "./blobs.js";
import type { StoragePathOptions, StoragePaths } from "./paths.js";

export type StorageHealth = {
  state: "ready";
  appDataDir: string;
  databasePath: string;
  blobDir: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  migrationsApplied: number;
  tableCount: number;
  journalMode: string;
  foreignKeys: boolean;
  integrity: string;
};

export type StorageService = {
  paths: StoragePaths;
  close: () => void;
  health: (options?: { integrityCheck?: boolean }) => StorageHealth;
  getAppSetting: <T = unknown>(key: string) => T | null;
  setAppSetting: (key: string, value: unknown) => void;
  readExecutionPermissions: () => ExecutionPermissionSummary[];
  readExecutionPermissionDecision: (action: string) => ExecutionPermissionDecision;
  setExecutionPermission: (input: { action: string; decision: ExecutionPermissionDecision }) => ExecutionPermissionSummary[];
  readBrowserActionPolicies: () => BrowserActionPolicy[];
  setBrowserActionPolicy: (policy: BrowserActionPolicy) => BrowserActionPolicy[];
  revokeBrowserActionPolicy: (policyId: string) => BrowserActionPolicy[];
  ensureSessionSnapshot: (defaults?: SessionDefaults) => SessionSnapshot;
  createSession: (input?: SessionDefaults) => SessionSnapshot;
  openSession: (sessionId: string) => SessionSnapshot;
  discardSession: (sessionId: string) => SessionSnapshot;
  deleteSession: (sessionId: string) => SessionSnapshot;
  trashSession: (sessionId: string) => SessionSnapshot;
  restoreSession: (sessionId: string) => SessionSnapshot;
  branchSession: (input: BranchSessionInput) => SessionSnapshot;
  prepareAsk: (input: AskPersistenceInput) => { sessionId: string; snapshot: SessionSnapshot };
  appendAssistantDelta: (input: AssistantDeltaInput) => void;
  updateAssistantMessage: (input: AssistantUpdateInput) => void;
  readLedgerSnapshot: (sessionId?: string | null) => LedgerSnapshot;
  readRuntimeThread: (sessionId: string, provider: RuntimeThreadProvider) => RuntimeThreadSummary | null;
  writeRuntimeThread: (input: RuntimeThreadInput) => RuntimeThreadSummary;
  clearRuntimeThread: (sessionId: string, provider: RuntimeThreadProvider, error?: string) => void;
  recordProviderSnapshot: (input: ProviderSnapshotInput) => void;
  recordTextArtifact: (input: TextArtifactInput) => void;
  recordFileChangeArtifact: (input: FileChangeArtifactInput) => void;
  resolveArtifactOpenPath: (artifactFileId: string, versionId?: string) => string | null;
  createVisionStream: (input: VisionStreamInput) => VisionStreamSummary;
  stopVisionStream: (input: StopVisionStreamInput) => VisionStreamSummary;
  completeVisionRecording: (input: CompleteVisionRecordingInput) => VisionStreamSummary;
  writeBlob: (input: { bytes: Buffer; mime: string; displayName: string }) => StoredBlob;
  createCapabilityJob: (input: CapabilityJobCreateInput) => CapabilityJobSummary;
  readCapabilityJob: (id: string) => CapabilityJobSummary | null;
  listCapabilityJobs: (input?: { sessionId?: string; statuses?: CapabilityJobSummary["status"][]; limit?: number }) => CapabilityJobSummary[];
  updateCapabilityJob: (input: CapabilityJobUpdateInput) => CapabilityJobSummary;
  appendCapabilityJobEvent: (input: CapabilityJobEventInput) => void;
  createCapabilityResource: (input: CapabilityResourceCreateInput) => CapabilityResourceSummary;
  listCapabilityResources: (jobId: string) => CapabilityResourceSummary[];
  acquireCapabilityLock: (input: CapabilityLockAcquireInput) => CapabilityLockSummary | null;
  releaseCapabilityLock: (input: { jobId?: string; lockKey?: string }) => number;
  listCapabilityLocks: (input?: { jobId?: string; lockKey?: string }) => CapabilityLockSummary[];
  cleanupEphemeralCapabilityResources: (input?: { completedBefore?: string }) => { resourcesDeleted: number; blobsDeleted: number; bytesDeleted: number };
  reconcileCapabilityJobsOnStartup: () => CapabilityJobSummary[];
  markActiveCapabilityJobsForShutdown: () => CapabilityJobSummary[];
  recordActivity: (input: {
    id: string;
    sessionId?: string | null;
    level?: "debug" | "info" | "warn" | "error";
    category: string;
    summary: string;
    detail?: unknown;
    createdAt?: string;
  }) => void;
};

export type StorageServiceOptions = StoragePathOptions;

export type SessionDefaults = {
  title?: string;
  model?: ModelId;
  reasoningEffort?: ReasoningEffort;
  mode?: WidgetMode;
};

export type BranchSessionInput = SessionDefaults & {
  parentSessionId?: string | null;
  sourceMessageId?: string;
  messages: BranchContextMessage[];
};

export type AskPersistenceInput = {
  requestId: string;
  sessionId?: string;
  text: string;
  mode: WidgetMode;
  model?: ModelId;
  reasoningEffort?: ReasoningEffort;
  replaceFromMessageId?: string;
};

export type AssistantDeltaInput = {
  sessionId: string;
  messageId: string;
  text: string;
  status?: Extract<MessageSnapshotStatus, "streaming" | "tooling" | "thinking">;
};

export type AssistantUpdateInput = {
  sessionId: string;
  messageId: string;
  text?: string;
  status: MessageSnapshotStatus;
};

export type TextArtifactInput = {
  sessionId: string;
  messageId?: string;
  title: string;
  text: string;
  logicalPath?: string;
  displayName?: string;
  mime?: string;
  fileKind?: string;
  createdAt?: string;
};

export type FileChangeArtifactInput = {
  sessionId: string;
  messageId?: string;
  changeId: string;
  phase: "before" | "after";
  title: string;
  operation: "create" | "modify" | "delete";
  paths: string[];
  workspaceRoot: string;
  detail?: unknown;
  createdAt?: string;
};

export type VisionStreamInput = {
  id: string;
  sessionId?: string | null;
  mode: VisionStreamMode;
  fps?: number;
  frameIntervalMs?: number;
  maxDurationMs?: number;
  detail?: unknown;
  startedAt?: string;
};

export type StopVisionStreamInput = {
  id: string;
  status?: Extract<VisionStreamStatus, "stopped" | "error">;
  reason?: string;
  stoppedAt?: string;
};

export type CompleteVisionRecordingInput = {
  id: string;
  mime: string;
  dataUrl: string;
  durationMs?: number;
  size?: number;
  stoppedAt?: string;
};

export type RuntimeThreadProvider = "codex-app-server" | "codex-exec" | "oauth-proxy" | "mock";

export type RuntimeThreadState = "closed" | "starting" | "connected" | "active" | "error";

export type RuntimeThreadSummary = {
  id: string;
  sessionId: string;
  provider: RuntimeThreadProvider;
  threadId?: string;
  turnId?: string;
  state: RuntimeThreadState;
  startedAt?: string;
  closedAt?: string;
  lastError?: string;
};

export type RuntimeThreadInput = {
  sessionId: string;
  provider: RuntimeThreadProvider;
  threadId?: string;
  turnId?: string;
  state?: RuntimeThreadState;
  startedAt?: string;
  closedAt?: string;
  lastError?: string;
};

export type ProviderSnapshotInput = {
  sessionId?: string | null;
  messageId?: string | null;
  provider: ProviderSnapshotProvider;
  title: string;
  summary: string;
  data?: unknown;
  capturedAt?: string;
};

export type {
  ActivityLogEntry,
  ArtifactFilePreview,
  ArtifactKind,
  ArtifactSummary,
  ExecutionPermissionDecision,
  ExecutionPermissionSummary,
  LedgerSnapshot,
  MessageSnapshotStatus,
  ModelId,
  ProviderSnapshotProvider,
  ProviderSnapshotSummary,
  ReasoningEffort,
  SessionMessage,
  SessionSnapshot,
  SessionSummary,
  VisionStreamMode,
  VisionStreamStatus,
  VisionStreamSummary,
  WidgetMode,
  BrowserActionPolicy,
  CapabilityJobSummary,
  CapabilityLockSummary,
  CapabilityResourceSummary
};
