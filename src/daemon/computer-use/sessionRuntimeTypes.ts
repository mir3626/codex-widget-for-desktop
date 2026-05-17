import type {
  CapabilityDagNodeSummary,
  CapabilityJobSummary,
  ComputerSessionActionFeedbackSummary,
  ComputerSessionDebugBundle,
  ComputerSessionEvent,
  ComputerSessionObservationResourceSummary,
  ComputerSessionObservationSummary,
  ComputerSessionPromptRunSummary,
  ComputerSessionRollbackActionSummary,
  ComputerSessionStartResult,
  ComputerSessionSummary,
  ComputerStructuredOperation,
  NormalizedComputerActionBatch
} from "../../shared/protocol.js";
import type { BrowserActionPromptPlan } from "../browser-action/index.js";
import type { CapabilityDagRuntime } from "../capability-dag/index.js";
import type { CapabilityRuntime } from "../capability-runtime/index.js";
import type { StorageService } from "../storage/storage.js";
import type { ScreenTileCache } from "./screenObservationRuntime.js";
import type { ExecutionSurfaceManager } from "./surfaceManager.js";

export type ComputerSessionRuntimeOptions = {
  storage: StorageService;
  capabilityRuntime: CapabilityRuntime;
  dagRuntime?: CapabilityDagRuntime;
  surfaceManager?: ExecutionSurfaceManager;
  executors?: {
    browserAction?: ComputerSessionOperationExecutor;
  };
  emit?: (event: ComputerSessionEvent) => void;
};

export type ComputerSessionOperationExecutor = (input: {
  session: ComputerSessionSummary;
  operation: ComputerStructuredOperation;
  dagRunId: string;
  dagNodeId: string;
  evalRunId: string;
}) => Promise<{
  status: "completed" | "running" | "awaiting_approval" | "failed" | "cancelled";
  capabilityJob?: CapabilityJobSummary;
  output?: unknown;
  summary?: string;
  error?: string;
}>;

export type ComputerSessionOperationResult = {
  session: ComputerSessionSummary;
  dagNode: CapabilityDagNodeSummary;
  job?: CapabilityJobSummary;
};

export type TerminalOutputRootSnapshot = {
  root: string;
  files: Map<string, { size: number; mtimeMs: number; sha256: string }>;
};

export type TerminalOutputRootDeltaEntry = {
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

export type TerminalOutputRootDeltaResult = {
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

export type TerminalArtifactRollbackTarget = {
  path: string;
  basename: string;
  sha256: string;
  size: number;
  change: "created";
  blobId?: string;
  evalResourceId?: string;
};

export type ComputerSessionPromptPlanResult = {
  session: ComputerSessionSummary;
  plan?: BrowserActionPromptPlan;
  promptRun?: ComputerSessionPromptRunSummary;
  operation?: ComputerSessionOperationResult;
  blockedReason?: string;
};

export type RuntimeSessionState = {
  summary: ComputerSessionSummary;
  observations: ComputerSessionObservationSummary[];
  actionFeedbacks: ComputerSessionActionFeedbackSummary[];
  actionBatches: NormalizedComputerActionBatch[];
  promptRuns: ComputerSessionPromptRunSummary[];
  rollbackActions: ComputerSessionRollbackActionSummary[];
  safetyDecisions: unknown[];
  verifierResults: unknown[];
  recoveryAttempts: number;
  screenTileCache?: ScreenTileCache;
};
