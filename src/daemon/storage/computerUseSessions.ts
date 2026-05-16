import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type { ComputerSessionSummary } from "../../shared/protocol.js";
import type {
  ComputerUseSessionSnapshot,
  ComputerUseSessionSnapshotInput
} from "./types.js";

type ComputerUseSessionRow = {
  id: string;
  user_request: string;
  profile_id?: string | null;
  selected_surface_kind?: string | null;
  risk_class: string;
  state: string;
  eval_run_id?: string | null;
  dag_run_id?: string | null;
  latest_observation_id?: string | null;
  latest_action_batch_id?: string | null;
  latest_verifier_result_id?: string | null;
  blocked_reason?: string | null;
  requires_user_action?: string | null;
  summary_json: string;
  observations_json: string;
  action_feedbacks_json: string;
  action_batches_json: string;
  prompt_runs_json: string;
  rollback_actions_json: string;
  safety_decisions_json: string;
  verifier_results_json: string;
  recovery_attempts: number;
  screen_tile_cache_json?: string | null;
  created_at: string;
  updated_at: string;
};

export function upsertComputerUseSessionSnapshot(
  database: NodeDatabaseSync,
  input: ComputerUseSessionSnapshotInput
): ComputerUseSessionSnapshot {
  const snapshot = normalizeSnapshot(input);
  const selectedSurfaceKind = snapshot.summary.selectedSurface?.kind ?? null;
  database.prepare(
    `INSERT INTO computer_use_sessions (
      id, user_request, profile_id, selected_surface_kind, risk_class, state,
      eval_run_id, dag_run_id, latest_observation_id, latest_action_batch_id,
      latest_verifier_result_id, blocked_reason, requires_user_action,
      summary_json, observations_json, action_feedbacks_json, action_batches_json,
      prompt_runs_json, rollback_actions_json, safety_decisions_json,
      verifier_results_json, recovery_attempts, screen_tile_cache_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_request = excluded.user_request,
      profile_id = excluded.profile_id,
      selected_surface_kind = excluded.selected_surface_kind,
      risk_class = excluded.risk_class,
      state = excluded.state,
      eval_run_id = excluded.eval_run_id,
      dag_run_id = excluded.dag_run_id,
      latest_observation_id = excluded.latest_observation_id,
      latest_action_batch_id = excluded.latest_action_batch_id,
      latest_verifier_result_id = excluded.latest_verifier_result_id,
      blocked_reason = excluded.blocked_reason,
      requires_user_action = excluded.requires_user_action,
      summary_json = excluded.summary_json,
      observations_json = excluded.observations_json,
      action_feedbacks_json = excluded.action_feedbacks_json,
      action_batches_json = excluded.action_batches_json,
      prompt_runs_json = excluded.prompt_runs_json,
      rollback_actions_json = excluded.rollback_actions_json,
      safety_decisions_json = excluded.safety_decisions_json,
      verifier_results_json = excluded.verifier_results_json,
      recovery_attempts = excluded.recovery_attempts,
      screen_tile_cache_json = excluded.screen_tile_cache_json,
      updated_at = excluded.updated_at`
  ).run(
    snapshot.summary.sessionId,
    snapshot.summary.userRequest,
    snapshot.summary.profileId ?? null,
    selectedSurfaceKind,
    snapshot.summary.riskClass,
    snapshot.summary.state,
    snapshot.summary.evalRunId ?? null,
    snapshot.summary.dagRunId ?? null,
    snapshot.summary.latestObservationId ?? null,
    snapshot.summary.latestActionBatchId ?? null,
    snapshot.summary.latestVerifierResultId ?? null,
    snapshot.summary.blockedReason ?? null,
    snapshot.summary.requiresUserAction ?? null,
    stringifyJson(snapshot.summary),
    stringifyJson(snapshot.observations),
    stringifyJson(snapshot.actionFeedbacks),
    stringifyJson(snapshot.actionBatches),
    stringifyJson(snapshot.promptRuns),
    stringifyJson(snapshot.rollbackActions),
    stringifyJson(snapshot.safetyDecisions),
    stringifyJson(snapshot.verifierResults),
    snapshot.recoveryAttempts,
    snapshot.screenTileCache === undefined ? null : stringifyJson(snapshot.screenTileCache),
    snapshot.createdAt,
    snapshot.updatedAt
  );
  return readComputerUseSessionSnapshot(database, snapshot.summary.sessionId) ?? snapshot;
}

export function readComputerUseSessionSnapshot(
  database: NodeDatabaseSync,
  sessionId: string
): ComputerUseSessionSnapshot | null {
  const row = database.prepare("SELECT * FROM computer_use_sessions WHERE id = ?").get(sessionId) as ComputerUseSessionRow | undefined;
  return row ? mapRow(row) : null;
}

export function listComputerUseSessionSnapshots(
  database: NodeDatabaseSync,
  input: { states?: ComputerSessionSummary["state"][]; profileId?: string; limit?: number } = {}
): ComputerUseSessionSnapshot[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (input.states && input.states.length > 0) {
    clauses.push(`state IN (${input.states.map(() => '?').join(", ")})`);
    values.push(...input.states);
  }
  if (input.profileId) {
    clauses.push("profile_id = ?");
    values.push(input.profileId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)));
  const rows = database
    .prepare(`SELECT * FROM computer_use_sessions ${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...values, limit) as ComputerUseSessionRow[];
  return rows.map(mapRow);
}

function normalizeSnapshot(input: ComputerUseSessionSnapshotInput): ComputerUseSessionSnapshot {
  const createdAt = input.summary.createdAt || new Date().toISOString();
  const updatedAt = input.summary.updatedAt || createdAt;
  return {
    summary: input.summary,
    observations: input.observations ?? [],
    actionFeedbacks: input.actionFeedbacks ?? [],
    actionBatches: input.actionBatches ?? [],
    promptRuns: input.promptRuns ?? [],
    rollbackActions: input.rollbackActions ?? [],
    safetyDecisions: input.safetyDecisions ?? [],
    verifierResults: input.verifierResults ?? [],
    recoveryAttempts: input.recoveryAttempts ?? 0,
    screenTileCache: input.screenTileCache,
    createdAt,
    updatedAt
  };
}

function mapRow(row: ComputerUseSessionRow): ComputerUseSessionSnapshot {
  const summary = parseJson(row.summary_json, null) as ComputerSessionSummary | null;
  return {
    summary: summary ?? {
      sessionId: row.id,
      userRequest: row.user_request,
      profileId: row.profile_id ?? undefined,
      riskClass: row.risk_class as ComputerSessionSummary["riskClass"],
      state: row.state as ComputerSessionSummary["state"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      evalRunId: row.eval_run_id ?? undefined,
      dagRunId: row.dag_run_id ?? undefined,
      latestObservationId: row.latest_observation_id ?? undefined,
      latestActionBatchId: row.latest_action_batch_id ?? undefined,
      latestVerifierResultId: row.latest_verifier_result_id ?? undefined,
      blockedReason: row.blocked_reason ?? undefined,
      requiresUserAction: row.requires_user_action ?? undefined
    },
    observations: parseJson(row.observations_json, []),
    actionFeedbacks: parseJson(row.action_feedbacks_json, []),
    actionBatches: parseJson(row.action_batches_json, []),
    promptRuns: parseJson(row.prompt_runs_json, []),
    rollbackActions: parseJson(row.rollback_actions_json, []),
    safetyDecisions: parseJson(row.safety_decisions_json, []),
    verifierResults: parseJson(row.verifier_results_json, []),
    recoveryAttempts: Number(row.recovery_attempts ?? 0),
    screenTileCache: row.screen_tile_cache_json ? parseJson(row.screen_tile_cache_json, undefined) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
