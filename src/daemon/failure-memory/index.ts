import type {
  ComputerUseFailureClass,
  ComputerUseEvalModality,
  StructuredFailureMemoryRecord
} from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";

const DEFAULT_BOUNDARIES = [
  "approval",
  "restricted_page",
  "credentials",
  "fresh_evidence",
  "raw_media_retention"
];

export function recordStructuredFailure(input: {
  storage: StorageService;
  failureClass: ComputerUseFailureClass;
  surface: ComputerUseEvalModality | "memory";
  source: string;
  scenarioId?: string;
  evalRunId?: string;
  evalStepId?: string;
  capabilityJobId?: string;
  perceptionGraphId?: string;
  aliasUpdates?: Array<{ from: string; to: string; weight: number }>;
  badTargetPatterns?: string[];
  recoveryHints?: string[];
  abstentionTriggers?: string[];
  rankingDelta?: number;
  ttlMs?: number;
}): StructuredFailureMemoryRecord {
  const now = new Date();
  return input.storage.recordStructuredFailureMemory({
    failureClass: input.failureClass,
    surface: input.surface,
    scenarioId: input.scenarioId,
    provenance: {
      evalRunId: input.evalRunId,
      evalStepId: input.evalStepId,
      capabilityJobId: input.capabilityJobId,
      perceptionGraphId: input.perceptionGraphId,
      source: input.source
    },
    calibration: {
      aliasUpdates: input.aliasUpdates,
      badTargetPatterns: input.badTargetPatterns,
      recoveryHints: input.recoveryHints,
      abstentionTriggers: input.abstentionTriggers,
      rankingDelta: input.rankingDelta
    },
    safety: {
      mayAffectRanking: true,
      mayCompleteTask: false,
      mayBypassApproval: false,
      proofSource: false,
      boundaries: DEFAULT_BOUNDARIES
    },
    expiresAt: input.ttlMs ? new Date(now.getTime() + input.ttlMs).toISOString() : undefined,
    createdAt: now.toISOString()
  });
}

export function readFailureCalibration(input: {
  storage: StorageService;
  surface?: ComputerUseEvalModality | "memory";
  failureClass?: ComputerUseFailureClass;
}): {
  aliases: Array<{ from: string; to: string; weight: number }>;
  badTargetPatterns: string[];
  recoveryHints: string[];
  abstentionTriggers: string[];
  rankingDelta: number;
  records: StructuredFailureMemoryRecord[];
} {
  const records = input.storage.listStructuredFailureMemory({
    surface: input.surface,
    failureClass: input.failureClass,
    includeExpired: false,
    limit: 200
  });
  return {
    aliases: records.flatMap((record) => record.calibration.aliasUpdates ?? []),
    badTargetPatterns: [...new Set(records.flatMap((record) => record.calibration.badTargetPatterns ?? []))],
    recoveryHints: [...new Set(records.flatMap((record) => record.calibration.recoveryHints ?? []))],
    abstentionTriggers: [...new Set(records.flatMap((record) => record.calibration.abstentionTriggers ?? []))],
    rankingDelta: records.reduce((sum, record) => sum + Number(record.calibration.rankingDelta ?? 0), 0),
    records
  };
}
