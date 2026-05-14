import type { StorageMigration } from "../schema.js";

export const scopedAutonomyToolsmithMigration: StorageMigration = {
  version: 5,
  name: "scoped_autonomy_toolsmith",
  sql: `
CREATE TABLE IF NOT EXISTS autonomy_permission_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('off', 'ask', 'scoped_yolo')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'expired')),
  grants_json TEXT NOT NULL DEFAULT '{}',
  safety_boundaries_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autonomy_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'blocked', 'implementing', 'smoke_testing', 'ready', 'running', 'completed', 'failed', 'cancelled')),
  permission_profile_id TEXT REFERENCES autonomy_permission_profiles(id) ON DELETE SET NULL,
  eval_run_id TEXT REFERENCES computer_use_eval_runs(id) ON DELETE SET NULL,
  dag_run_id TEXT REFERENCES capability_dag_runs(id) ON DELETE SET NULL,
  gap_ids_json TEXT NOT NULL DEFAULT '[]',
  tool_spec_ids_json TEXT NOT NULL DEFAULT '[]',
  output_json TEXT NOT NULL DEFAULT '{}',
  failure_class TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS autonomy_capability_gaps (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES autonomy_runs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  requested_capability TEXT NOT NULL,
  reason TEXT NOT NULL,
  required_grants_json TEXT NOT NULL DEFAULT '[]',
  suggested_tool_id TEXT,
  blockers_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autonomy_tool_specs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capability TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'materialized', 'smoke_passed', 'blocked', 'retired')),
  template_id TEXT NOT NULL,
  entrypoint_kind TEXT NOT NULL CHECK (entrypoint_kind IN ('node_script', 'internal_template')),
  description TEXT NOT NULL,
  required_grants_json TEXT NOT NULL DEFAULT '[]',
  smoke_tests_json TEXT NOT NULL DEFAULT '[]',
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autonomy_tool_runs (
  id TEXT PRIMARY KEY,
  tool_spec_id TEXT NOT NULL REFERENCES autonomy_tool_specs(id) ON DELETE CASCADE,
  autonomy_run_id TEXT REFERENCES autonomy_runs(id) ON DELETE SET NULL,
  eval_run_id TEXT REFERENCES computer_use_eval_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'blocked', 'running', 'completed', 'failed', 'cancelled')),
  mode TEXT NOT NULL CHECK (mode IN ('smoke', 'execute')),
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  elapsed_ms INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_autonomy_permission_profiles_status ON autonomy_permission_profiles(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_autonomy_runs_status ON autonomy_runs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_autonomy_runs_session ON autonomy_runs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_autonomy_runs_eval ON autonomy_runs(eval_run_id);
CREATE INDEX IF NOT EXISTS idx_autonomy_gaps_run ON autonomy_capability_gaps(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_autonomy_tool_specs_capability ON autonomy_tool_specs(capability, updated_at);
CREATE INDEX IF NOT EXISTS idx_autonomy_tool_runs_spec ON autonomy_tool_runs(tool_spec_id, created_at);
CREATE INDEX IF NOT EXISTS idx_autonomy_tool_runs_eval ON autonomy_tool_runs(eval_run_id);
`
};

