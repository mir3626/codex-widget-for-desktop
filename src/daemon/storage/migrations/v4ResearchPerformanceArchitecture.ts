import type { StorageMigration } from "../schema.js";

export const researchPerformanceArchitectureMigration: StorageMigration = {
  version: 4,
  name: "research_performance_architecture",
  sql: `
CREATE TABLE IF NOT EXISTS computer_use_eval_runs (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  modalities_json TEXT NOT NULL DEFAULT '[]',
  prompt TEXT,
  scenario_json TEXT NOT NULL DEFAULT '{}',
  task_success TEXT NOT NULL DEFAULT 'unknown',
  failure_class TEXT NOT NULL DEFAULT 'unknown',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  elapsed_ms INTEGER,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS computer_use_eval_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES computer_use_eval_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  capability_job_id TEXT REFERENCES capability_jobs(id) ON DELETE SET NULL,
  capability_dag_node_id TEXT,
  perception_graph_id TEXT,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  elapsed_ms INTEGER,
  failure_class TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS computer_use_eval_resources (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES computer_use_eval_runs(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES computer_use_eval_steps(id) ON DELETE SET NULL,
  capability_resource_id TEXT REFERENCES capability_resources(id) ON DELETE SET NULL,
  blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  retention TEXT NOT NULL DEFAULT 'evidence',
  redaction_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS perception_graphs (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS structured_failure_memory (
  id TEXT PRIMARY KEY,
  failure_class TEXT NOT NULL,
  surface TEXT NOT NULL,
  scenario_id TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  calibration_json TEXT NOT NULL DEFAULT '{}',
  safety_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_dag_runs (
  id TEXT PRIMARY KEY,
  eval_run_id TEXT REFERENCES computer_use_eval_runs(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'running', 'skipped', 'completed', 'failed', 'cancelled')),
  goal TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS capability_dag_nodes (
  id TEXT PRIMARY KEY,
  dag_run_id TEXT NOT NULL REFERENCES capability_dag_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'running', 'skipped', 'completed', 'failed', 'cancelled')),
  capability_kind TEXT,
  capability_job_id TEXT REFERENCES capability_jobs(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  requested_by TEXT NOT NULL DEFAULT 'direct_ui',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  confidence_gate REAL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  resource_usage_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  elapsed_ms INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_computer_use_eval_runs_scenario ON computer_use_eval_runs(scenario_id, created_at);
CREATE INDEX IF NOT EXISTS idx_computer_use_eval_runs_status ON computer_use_eval_runs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_computer_use_eval_runs_session ON computer_use_eval_runs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_computer_use_eval_steps_run ON computer_use_eval_steps(run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_computer_use_eval_steps_job ON computer_use_eval_steps(capability_job_id);
CREATE INDEX IF NOT EXISTS idx_computer_use_eval_resources_run ON computer_use_eval_resources(run_id);
CREATE INDEX IF NOT EXISTS idx_perception_graphs_session ON perception_graphs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_structured_failure_memory_class ON structured_failure_memory(failure_class, created_at);
CREATE INDEX IF NOT EXISTS idx_structured_failure_memory_expiry ON structured_failure_memory(expires_at);
CREATE INDEX IF NOT EXISTS idx_capability_dag_runs_eval ON capability_dag_runs(eval_run_id);
CREATE INDEX IF NOT EXISTS idx_capability_dag_nodes_run ON capability_dag_nodes(dag_run_id, status);
CREATE INDEX IF NOT EXISTS idx_capability_dag_nodes_job ON capability_dag_nodes(capability_job_id);
`
};
