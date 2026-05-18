import type {
  CapabilityEventPhase,
  CapabilityJobKind,
  CapabilityJobStatus,
  CapabilityJobSummary,
  CapabilityStartInput,
  AutonomyPermissionDecision
} from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";

export type CapabilityRuntimeEvent =
  | {
      type: "job";
      job: CapabilityJobSummary;
      phase: CapabilityEventPhase;
      summary: string;
      detail?: unknown;
    }
  | {
      type: "resource";
      job: CapabilityJobSummary;
      resourceId: string;
      role: string;
      mime: string;
      preview?: unknown;
    };

export type CapabilityRuntimeEmitter = (event: CapabilityRuntimeEvent) => void;

export type CapabilityHandlerInput = {
  job: CapabilityJobSummary;
  signal: AbortSignal;
  storage: StorageService;
  resources: CapabilityResourceManagerLike;
  helpers: CapabilityHelperSupervisorLike;
};

export type CapabilityHandlerOutput = {
  status?: Extract<CapabilityJobStatus, "completed" | "failed" | "cancelled">;
  output?: unknown;
  outputBlobIds?: string[];
  summary?: string;
  phase?: CapabilityEventPhase;
  error?: string;
};

export type CapabilityHandler = (input: CapabilityHandlerInput) => Promise<CapabilityHandlerOutput>;

export type CapabilityRuntimeOptions = {
  storage: StorageService;
  emit?: CapabilityRuntimeEmitter;
  maxActiveJobs?: number;
  perKindLimits?: Partial<Record<CapabilityJobKind, number>>;
};

export type CapabilityRuntimeEnqueueInput = CapabilityStartInput & {
  requireApproval?: boolean;
  lockKey?: string;
  trustedPermissionDecision?: AutonomyPermissionDecision;
  trustedPermissionProfileId?: string;
};

export type CapabilityCancellationToken = {
  jobId: string;
  reason: string;
  requestedAt: string;
  sourceEventId?: string;
};

export type CapabilityResourceManagerLike = {
  storeBuffer(input: {
    job: CapabilityJobSummary;
    role: string;
    bytes: Buffer;
    mime: string;
    displayName: string;
    retention?: "ephemeral" | "session" | "evidence" | "user_saved";
    preview?: unknown;
    redaction?: unknown;
  }): { resourceId: string; blobId: string; size: number };
};

export type CapabilityHelperSupervisorLike = {
  runJson(input: {
    command: string;
    args?: string[];
    request: unknown;
    timeoutMs: number;
    signal?: AbortSignal;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    env?: Record<string, string | undefined>;
  }): Promise<{
    ok: boolean;
    output?: unknown;
    stdout: string;
    stderr: string;
    exitCode?: number | null;
    signal?: string | null;
    error?: string;
    metadata: Record<string, unknown>;
  }>;
};
