import type { StorageMigration } from "../schema.js";

export const scopedAutonomySelfImplementationMigration: StorageMigration = {
  version: 6,
  name: "scoped_autonomy_self_implementation",
  sql: `
ALTER TABLE autonomy_permission_profiles ADD COLUMN scope TEXT NOT NULL DEFAULT 'persistent';
ALTER TABLE autonomy_permission_profiles ADD COLUMN max_uses INTEGER;
ALTER TABLE autonomy_permission_profiles ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE autonomy_capability_gaps ADD COLUMN operations_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE autonomy_capability_gaps ADD COLUMN risk_class TEXT NOT NULL DEFAULT 'side_effect';
ALTER TABLE autonomy_capability_gaps ADD COLUMN evidence_needs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE autonomy_capability_gaps ADD COLUMN fallback_plan_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE autonomy_capability_gaps ADD COLUMN blocker_classification TEXT NOT NULL DEFAULT 'none';
ALTER TABLE autonomy_capability_gaps ADD COLUMN proposed_tool_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE autonomy_tool_specs ADD COLUMN manifest_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE autonomy_tool_specs ADD COLUMN source_hash TEXT;
ALTER TABLE autonomy_tool_specs ADD COLUMN activated_at TEXT;
ALTER TABLE autonomy_tool_specs ADD COLUMN stability_rating TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE autonomy_tool_runs ADD COLUMN rollback_json TEXT NOT NULL DEFAULT '{}';

CREATE TEMP TABLE autonomy_tool_runs_v6_backup AS
  SELECT id, tool_spec_id, autonomy_run_id, eval_run_id, status, mode, input_json,
         output_json, rollback_json, started_at, completed_at, elapsed_ms, last_error,
         created_at, updated_at
  FROM autonomy_tool_runs;
DROP TABLE autonomy_tool_runs;

CREATE TABLE autonomy_tool_specs_v6 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capability TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'generating', 'materialized', 'smoke_passed', 'active', 'smoke_failed', 'blocked', 'retired')),
  template_id TEXT NOT NULL,
  entrypoint_kind TEXT NOT NULL CHECK (entrypoint_kind IN ('node_script', 'internal_template')),
  description TEXT NOT NULL,
  required_grants_json TEXT NOT NULL DEFAULT '[]',
  smoke_tests_json TEXT NOT NULL DEFAULT '[]',
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  manifest_json TEXT NOT NULL DEFAULT '{}',
  source_hash TEXT,
  activated_at TEXT,
  stability_rating TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO autonomy_tool_specs_v6 (
  id, name, capability, version, status, template_id, entrypoint_kind, description,
  required_grants_json, smoke_tests_json, artifacts_json, manifest_json, source_hash,
  activated_at, stability_rating, created_at, updated_at
)
SELECT id, name, capability, version, status, template_id, entrypoint_kind, description,
       required_grants_json, smoke_tests_json, artifacts_json, manifest_json, source_hash,
       activated_at, stability_rating, created_at, updated_at
FROM autonomy_tool_specs;
DROP TABLE autonomy_tool_specs;
ALTER TABLE autonomy_tool_specs_v6 RENAME TO autonomy_tool_specs;

CREATE TABLE autonomy_tool_runs (
  id TEXT PRIMARY KEY,
  tool_spec_id TEXT NOT NULL REFERENCES autonomy_tool_specs(id) ON DELETE CASCADE,
  autonomy_run_id TEXT REFERENCES autonomy_runs(id) ON DELETE SET NULL,
  eval_run_id TEXT REFERENCES computer_use_eval_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'blocked', 'running', 'completed', 'failed', 'cancelled')),
  mode TEXT NOT NULL CHECK (mode IN ('dependency_prepare', 'smoke', 'execute', 'rerun', 'rollback')),
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  rollback_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  elapsed_ms INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO autonomy_tool_runs (
  id, tool_spec_id, autonomy_run_id, eval_run_id, status, mode, input_json,
  output_json, rollback_json, started_at, completed_at, elapsed_ms, last_error,
  created_at, updated_at
)
SELECT id, tool_spec_id, autonomy_run_id, eval_run_id, status, mode, input_json,
       output_json, rollback_json, started_at, completed_at, elapsed_ms, last_error,
       created_at, updated_at
FROM autonomy_tool_runs_v6_backup;
DROP TABLE autonomy_tool_runs_v6_backup;

CREATE TABLE IF NOT EXISTS autonomy_capability_inventory (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'generated', 'blocked', 'external_unavailable')),
  source TEXT NOT NULL CHECK (source IN ('builtin', 'generated', 'external', 'blocked')),
  operations_json TEXT NOT NULL DEFAULT '[]',
  risk_class TEXT NOT NULL,
  required_grants_json TEXT NOT NULL DEFAULT '[]',
  tool_spec_id TEXT REFERENCES autonomy_tool_specs(id) ON DELETE SET NULL,
  blockers_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_autonomy_permission_profiles_scope ON autonomy_permission_profiles(scope, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_autonomy_capability_inventory_capability ON autonomy_capability_inventory(capability, status);
CREATE INDEX IF NOT EXISTS idx_autonomy_tool_specs_capability ON autonomy_tool_specs(capability, updated_at);
CREATE INDEX IF NOT EXISTS idx_autonomy_tool_specs_status ON autonomy_tool_specs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_autonomy_tool_runs_spec ON autonomy_tool_runs(tool_spec_id, created_at);
CREATE INDEX IF NOT EXISTS idx_autonomy_tool_runs_eval ON autonomy_tool_runs(eval_run_id);
`
};
