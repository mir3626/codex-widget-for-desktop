import type { StorageMigration } from "../schema.js";

export const computerUseSessionSnapshotsMigration: StorageMigration = {
  version: 7,
  name: "computer_use_session_snapshots",
  sql: `
CREATE TABLE IF NOT EXISTS computer_use_sessions (
  id TEXT PRIMARY KEY,
  user_request TEXT NOT NULL,
  profile_id TEXT,
  selected_surface_kind TEXT,
  risk_class TEXT NOT NULL,
  state TEXT NOT NULL,
  eval_run_id TEXT REFERENCES computer_use_eval_runs(id) ON DELETE SET NULL,
  dag_run_id TEXT REFERENCES capability_dag_runs(id) ON DELETE SET NULL,
  latest_observation_id TEXT,
  latest_action_batch_id TEXT,
  latest_verifier_result_id TEXT,
  blocked_reason TEXT,
  requires_user_action TEXT,
  summary_json TEXT NOT NULL,
  observations_json TEXT NOT NULL DEFAULT '[]',
  action_feedbacks_json TEXT NOT NULL DEFAULT '[]',
  action_batches_json TEXT NOT NULL DEFAULT '[]',
  prompt_runs_json TEXT NOT NULL DEFAULT '[]',
  rollback_actions_json TEXT NOT NULL DEFAULT '[]',
  safety_decisions_json TEXT NOT NULL DEFAULT '[]',
  verifier_results_json TEXT NOT NULL DEFAULT '[]',
  recovery_attempts INTEGER NOT NULL DEFAULT 0,
  screen_tile_cache_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_computer_use_sessions_state ON computer_use_sessions(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_computer_use_sessions_eval ON computer_use_sessions(eval_run_id);
CREATE INDEX IF NOT EXISTS idx_computer_use_sessions_dag ON computer_use_sessions(dag_run_id);
CREATE INDEX IF NOT EXISTS idx_computer_use_sessions_profile ON computer_use_sessions(profile_id, updated_at);
`
};
