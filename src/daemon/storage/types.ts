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
  CapabilityResourceSummary,
  CapabilityDagNodeSummary,
  CapabilityDagRunSummary,
  AutonomyCapabilityGap,
  AutonomyCapabilityInventoryItem,
  AutonomyCapabilityStatus,
  AutonomyGeneratedToolSpec,
  AutonomyPermissionProfile,
  AutonomyPermissionProfileStatus,
  AutonomyRunStatus,
  AutonomyRunSummary,
  AutonomyToolRunSummary,
  ComputerUseEvalResourceSummary,
  ComputerUseEvalRunSummary,
  ComputerUseEvalStatus,
  ComputerUseEvalStepSummary,
  ComputerUseFailureClass,
  PerceptionGraphSummary,
  StructuredFailureMemoryRecord
} from "../../shared/protocol.js";
import type {
  CapabilityJobCreateInput,
  CapabilityJobEventInput,
  CapabilityJobUpdateInput,
  CapabilityLockAcquireInput,
  CapabilityResourceCreateInput
} from "./capabilityJobs.js";
import type {
  CapabilityDagNodeUpsertInput,
  CapabilityDagRunCreateInput,
  CapabilityDagRunUpdateInput,
  ComputerUseEvalResourceCreateInput,
  ComputerUseEvalRunCreateInput,
  ComputerUseEvalRunUpdateInput,
  ComputerUseEvalStepCreateInput,
  PerceptionGraphRecordInput,
  StructuredFailureRecordInput
} from "./researchArchitecture.js";
import type {
  AutonomyCapabilityGapCreateInput,
  AutonomyGeneratedToolSpecUpsertInput,
  AutonomyPermissionProfileCreateInput,
  AutonomyPermissionProfileUpdateInput,
  AutonomyRunCreateInput,
  AutonomyRunUpdateInput,
  AutonomyToolRunCreateInput,
  AutonomyToolRunUpdateInput,
  AutonomyCapabilityInventoryUpsertInput
} from "./scopedAutonomy.js";
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
  createComputerUseEvalRun: (input: ComputerUseEvalRunCreateInput) => ComputerUseEvalRunSummary;
  readComputerUseEvalRun: (id: string) => ComputerUseEvalRunSummary | null;
  listComputerUseEvalRuns: (input?: { sessionId?: string; scenarioId?: string; statuses?: ComputerUseEvalStatus[]; limit?: number }) => ComputerUseEvalRunSummary[];
  updateComputerUseEvalRun: (input: ComputerUseEvalRunUpdateInput) => ComputerUseEvalRunSummary;
  appendComputerUseEvalStep: (input: ComputerUseEvalStepCreateInput) => ComputerUseEvalStepSummary;
  listComputerUseEvalSteps: (runId: string) => ComputerUseEvalStepSummary[];
  createComputerUseEvalResource: (input: ComputerUseEvalResourceCreateInput) => ComputerUseEvalResourceSummary;
  listComputerUseEvalResources: (runId: string) => ComputerUseEvalResourceSummary[];
  recordPerceptionGraph: (input: PerceptionGraphRecordInput) => PerceptionGraphSummary;
  readPerceptionGraph: (id: string) => PerceptionGraphSummary | null;
  listPerceptionGraphs: (input?: { sessionId?: string; limit?: number }) => PerceptionGraphSummary[];
  recordStructuredFailureMemory: (input: StructuredFailureRecordInput) => StructuredFailureMemoryRecord;
  listStructuredFailureMemory: (input?: { failureClass?: ComputerUseFailureClass; surface?: string; includeExpired?: boolean; limit?: number }) => StructuredFailureMemoryRecord[];
  createCapabilityDagRun: (input: CapabilityDagRunCreateInput) => CapabilityDagRunSummary;
  updateCapabilityDagRun: (input: CapabilityDagRunUpdateInput) => CapabilityDagRunSummary;
  readCapabilityDagRun: (id: string) => CapabilityDagRunSummary | null;
  upsertCapabilityDagNode: (input: CapabilityDagNodeUpsertInput) => CapabilityDagNodeSummary;
  readCapabilityDagNode: (id: string) => CapabilityDagNodeSummary | null;
  listCapabilityDagNodes: (dagRunId: string) => CapabilityDagNodeSummary[];
  createAutonomyPermissionProfile: (input: AutonomyPermissionProfileCreateInput) => AutonomyPermissionProfile;
  readAutonomyPermissionProfile: (id: string) => AutonomyPermissionProfile | null;
  listAutonomyPermissionProfiles: (input?: { status?: AutonomyPermissionProfileStatus; limit?: number }) => AutonomyPermissionProfile[];
  updateAutonomyPermissionProfile: (input: AutonomyPermissionProfileUpdateInput) => AutonomyPermissionProfile;
  createAutonomyRun: (input: AutonomyRunCreateInput) => AutonomyRunSummary;
  readAutonomyRun: (id: string) => AutonomyRunSummary | null;
  listAutonomyRuns: (input?: { sessionId?: string; statuses?: AutonomyRunStatus[]; limit?: number }) => AutonomyRunSummary[];
  updateAutonomyRun: (input: AutonomyRunUpdateInput) => AutonomyRunSummary;
  recordAutonomyCapabilityGap: (input: AutonomyCapabilityGapCreateInput) => AutonomyCapabilityGap;
  listAutonomyCapabilityGaps: (runId: string) => AutonomyCapabilityGap[];
  upsertAutonomyToolSpec: (input: AutonomyGeneratedToolSpecUpsertInput) => AutonomyGeneratedToolSpec;
  readAutonomyToolSpec: (id: string) => AutonomyGeneratedToolSpec | null;
  listAutonomyToolSpecs: (input?: { capability?: string; limit?: number }) => AutonomyGeneratedToolSpec[];
  createAutonomyToolRun: (input: AutonomyToolRunCreateInput) => AutonomyToolRunSummary;
  updateAutonomyToolRun: (input: AutonomyToolRunUpdateInput) => AutonomyToolRunSummary;
  readAutonomyToolRun: (id: string) => AutonomyToolRunSummary | null;
  listAutonomyToolRuns: (input?: { toolSpecId?: string; autonomyRunId?: string; limit?: number }) => AutonomyToolRunSummary[];
  upsertAutonomyCapabilityInventory: (input: AutonomyCapabilityInventoryUpsertInput) => AutonomyCapabilityInventoryItem;
  readAutonomyCapabilityInventoryItem: (id: string) => AutonomyCapabilityInventoryItem | null;
  listAutonomyCapabilityInventory: (input?: { status?: AutonomyCapabilityStatus; capability?: string; limit?: number }) => AutonomyCapabilityInventoryItem[];
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
  CapabilityResourceSummary,
  CapabilityDagNodeSummary,
  CapabilityDagRunSummary,
  AutonomyCapabilityGap,
  AutonomyCapabilityInventoryItem,
  AutonomyGeneratedToolSpec,
  AutonomyPermissionProfile,
  AutonomyRunSummary,
  AutonomyToolRunSummary,
  ComputerUseEvalResourceSummary,
  ComputerUseEvalRunSummary,
  ComputerUseEvalStepSummary,
  PerceptionGraphSummary,
  StructuredFailureMemoryRecord
};
