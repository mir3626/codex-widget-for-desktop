import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ComputerSessionRollbackActionSummary,
  ComputerSessionSummary
} from "../../shared/protocol.js";
import type { CapabilityRuntime } from "../capability-runtime/index.js";
import { ScopedAutonomyRuntime } from "../scoped-autonomy/index.js";
import type { StorageService } from "../storage/storage.js";
import {
  isPathWithinAnyRoot,
  readTerminalArtifactRollbackTargets
} from "./terminalArtifactDelta.js";
import { readUnknownRecord } from "./sessionRecordUtils.js";
import type { RuntimeSessionState } from "./sessionRuntimeTypes.js";

export type ComputerSessionRollbackRuntimeHost = {
  storage: StorageService;
  capabilityRuntime: CapabilityRuntime;
  requireSession: (sessionId: string) => RuntimeSessionState;
  persistSessionState: (state: RuntimeSessionState) => void;
};

export function recordRollbackAction(
  host: ComputerSessionRollbackRuntimeHost,
  sessionId: string,
  input: Omit<ComputerSessionRollbackActionSummary, "id" | "createdAt">
): ComputerSessionRollbackActionSummary {
  const state = host.requireSession(sessionId);
  const action: ComputerSessionRollbackActionSummary = {
    id: `rollback:${randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...input
  };
  state.rollbackActions.push(action);
  state.summary.updatedAt = action.createdAt;
  host.persistSessionState(state);
  return action;
}

export function completeRollbackAction(
  host: ComputerSessionRollbackRuntimeHost,
  sessionId: string,
  rollbackActionId: string,
  status: ComputerSessionRollbackActionSummary["status"],
  reason?: string
): ComputerSessionRollbackActionSummary | null {
  const state = host.requireSession(sessionId);
  const action = state.rollbackActions.find((candidate) => candidate.id === rollbackActionId);
  if (!action) {
    return null;
  }
  action.status = status;
  action.reason = reason ?? action.reason;
  action.completedAt = new Date().toISOString();
  state.summary.updatedAt = action.completedAt;
  host.persistSessionState(state);
  return action;
}

export async function executeRollbackAction(
  host: ComputerSessionRollbackRuntimeHost,
  input: {
    sessionId: string;
    rollbackActionId: string;
    includeUserArtifacts?: boolean;
    confirmUserArtifacts?: boolean;
  }
): Promise<{ session: ComputerSessionSummary; rollbackAction: ComputerSessionRollbackActionSummary; toolRun?: unknown }> {
  const state = host.requireSession(input.sessionId);
  const action = state.rollbackActions.find((candidate) => candidate.id === input.rollbackActionId);
  if (!action) {
    throw new Error(`Rollback action not found: ${input.rollbackActionId}`);
  }
  state.safetyDecisions.push({
    phase: "rollback_action",
    rollbackActionId: action.id,
    kind: action.kind,
    includeUserArtifacts: input.includeUserArtifacts === true,
    confirmUserArtifacts: input.confirmUserArtifacts === true,
    requestedAt: new Date().toISOString()
  });
  if (action.kind === "delete_artifact") {
    const metadata = readUnknownRecord(action.metadata);
    const terminalArtifactTargets = readTerminalArtifactRollbackTargets(metadata.terminalArtifactTargets);
    if (terminalArtifactTargets.length) {
      if (!input.includeUserArtifacts || !input.confirmUserArtifacts) {
        const blocked = completeRollbackAction(host, input.sessionId, action.id, "blocked", "terminal_artifact_deletion_requires_explicit_delete_confirmation") ?? action;
        recordRollbackEvalStep(host, state, blocked, "blocked", {
          reason: "terminal_artifact_deletion_requires_explicit_delete_confirmation",
          terminalArtifactTargetCount: terminalArtifactTargets.length
        });
        return { session: host.requireSession(input.sessionId).summary, rollbackAction: blocked };
      }
      const profile = state.summary.profileId
        ? host.storage.readAutonomyPermissionProfile(state.summary.profileId)
        : null;
      const writeRoots = profile?.grants.filesystem.writeRoots ?? [];
      let deletedCount = 0;
      let skippedCount = 0;
      const skippedReasons: Record<string, number> = {};
      for (const target of terminalArtifactTargets.slice(0, 25)) {
        const absolutePath = resolve(target.path);
        const skip = (reason: string) => {
          skippedCount += 1;
          skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
        };
        if (!writeRoots.length || !isPathWithinAnyRoot(absolutePath, writeRoots)) {
          skip("outside_approved_write_root");
          continue;
        }
        if (!existsSync(absolutePath)) {
          skip("already_missing");
          continue;
        }
        try {
          const stat = statSync(absolutePath);
          if (!stat.isFile()) {
            skip("not_a_file");
            continue;
          }
          const bytes = readFileSync(absolutePath);
          const currentSha256 = createHash("sha256").update(bytes).digest("hex");
          if (currentSha256 !== target.sha256) {
            skip("hash_changed_after_terminal_run");
            continue;
          }
          unlinkSync(absolutePath);
          deletedCount += 1;
        } catch {
          skip("delete_failed");
        }
      }
      const status: ComputerSessionRollbackActionSummary["status"] = deletedCount > 0
        ? "completed"
        : skippedCount > 0
          ? "skipped"
          : "completed";
      const completed = completeRollbackAction(host, input.sessionId, action.id, status, "terminal_artifact_rollback_finished") ?? action;
      completed.metadata = {
        ...metadata,
        terminalArtifactTargetCount: terminalArtifactTargets.length,
        deletedCount,
        skippedCount,
        skippedReasons
      };
      state.summary.updatedAt = new Date().toISOString();
      host.persistSessionState(state);
      recordRollbackEvalStep(host, state, completed, status, {
        source: "terminal_output_root_diff",
        terminalArtifactTargetCount: terminalArtifactTargets.length,
        deletedCount,
        skippedCount,
        skippedReasons
      });
      return { session: host.requireSession(input.sessionId).summary, rollbackAction: completed };
    }
    const autonomyRunId = typeof metadata.autonomyRunId === "string" ? metadata.autonomyRunId : "";
    if (!autonomyRunId) {
      const failed = completeRollbackAction(host, input.sessionId, action.id, "failed", "missing_autonomy_run_id") ?? action;
      recordRollbackEvalStep(host, state, failed, "failed", { reason: "missing_autonomy_run_id" });
      return { session: host.requireSession(input.sessionId).summary, rollbackAction: failed };
    }
    if (input.includeUserArtifacts && !input.confirmUserArtifacts) {
      const blocked = completeRollbackAction(host, input.sessionId, action.id, "blocked", "user_artifact_deletion_requires_explicit_confirmation") ?? action;
      recordRollbackEvalStep(host, state, blocked, "blocked", { reason: "user_artifact_deletion_requires_explicit_confirmation" });
      return { session: host.requireSession(input.sessionId).summary, rollbackAction: blocked };
    }
    const runtime = new ScopedAutonomyRuntime(host.storage);
    const toolRun = runtime.rollbackRun({
      autonomyRunId,
      includeUserArtifacts: input.includeUserArtifacts === true
    });
    const output = readUnknownRecord(toolRun.output);
    const deleted = Array.isArray(output.deleted) ? output.deleted.length : 0;
    const skipped = Array.isArray(output.skipped) ? output.skipped.length : 0;
    const status: ComputerSessionRollbackActionSummary["status"] = deleted > 0
      ? "completed"
      : skipped > 0
        ? "skipped"
        : "completed";
    const reason = input.includeUserArtifacts
      ? "toolsmith_rollback_completed_with_user_artifacts"
      : "toolsmith_rollback_completed_without_user_artifacts";
    const completed = completeRollbackAction(host, input.sessionId, action.id, status, reason) ?? action;
    completed.metadata = {
      ...readUnknownRecord(completed.metadata),
      rollbackToolRunId: toolRun.id,
      includeUserArtifacts: input.includeUserArtifacts === true,
      deletedCount: deleted,
      skippedCount: skipped
    };
    state.summary.updatedAt = new Date().toISOString();
    host.persistSessionState(state);
    recordRollbackEvalStep(host, state, completed, status, {
      autonomyRunId,
      rollbackToolRunId: toolRun.id,
      includeUserArtifacts: input.includeUserArtifacts === true,
      deletedCount: deleted,
      skippedCount: skipped
    });
    return { session: host.requireSession(input.sessionId).summary, rollbackAction: completed, toolRun };
  }
  if (action.kind === "cancel_capability_job" && action.capabilityJobId) {
    await host.capabilityRuntime.cancel(action.capabilityJobId, "computer_session_rollback_action");
    const completed = completeRollbackAction(host, input.sessionId, action.id, "completed", "capability_job_cancelled") ?? action;
    recordRollbackEvalStep(host, state, completed, "completed", { capabilityJobId: action.capabilityJobId });
    return { session: host.requireSession(input.sessionId).summary, rollbackAction: completed };
  }
  const skipped = completeRollbackAction(host, input.sessionId, action.id, "skipped", "rollback_action_has_no_executable_handler") ?? action;
  recordRollbackEvalStep(host, state, skipped, "skipped", { reason: "rollback_action_has_no_executable_handler" });
  return { session: host.requireSession(input.sessionId).summary, rollbackAction: skipped };
}

function recordRollbackEvalStep(
  host: ComputerSessionRollbackRuntimeHost,
  state: RuntimeSessionState,
  action: ComputerSessionRollbackActionSummary,
  status: ComputerSessionRollbackActionSummary["status"],
  output: Record<string, unknown>
): void {
  if (!state.summary.evalRunId) {
    return;
  }
  const now = new Date().toISOString();
  host.storage.appendComputerUseEvalStep({
    runId: state.summary.evalRunId,
    kind: "rollback_action",
    phase: "cleanup",
    status: status === "completed" || status === "skipped" ? "completed" : "failed",
    input: {
      rollbackActionId: action.id,
      kind: action.kind,
      riskClass: action.riskClass
    },
    output: {
      ...output,
      rollbackStatus: action.status,
      reason: action.reason
    },
    failureClass: status === "completed" || status === "skipped" ? "none" : "recovery_failed",
    startedAt: now,
    completedAt: now,
    elapsedMs: 0
  });
}
