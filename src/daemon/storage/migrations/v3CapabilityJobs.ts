import type { StorageMigration } from "../schema.js";

export const capabilityJobsMigration: StorageMigration = {
  version: 3,
  name: "capability_jobs",
  sql: `
CREATE TABLE IF NOT EXISTS capability_jobs (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('browser_action', 'browser_chrome', 'desktop_action', 'screen_observe', 'ocr', 'terminal', 'agent_tool')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'scheduled', 'awaiting_approval', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'expired')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('background', 'normal', 'interactive')),
  requested_by TEXT NOT NULL CHECK (requested_by IN ('prompt', 'direct_ui', 'background', 'approval_resume')),
  input_json TEXT NOT NULL DEFAULT '{}',
  input_blob_ids_json TEXT NOT NULL DEFAULT '[]',
  output_json TEXT,
  output_blob_ids_json TEXT NOT NULL DEFAULT '[]',
  lease_id TEXT,
  approval_id TEXT,
  timeout_ms INTEGER NOT NULL,
  deadline_at TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS capability_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES capability_jobs(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_locks (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES capability_jobs(id) ON DELETE SET NULL,
  lock_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_resources (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES capability_jobs(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  retention TEXT NOT NULL DEFAULT 'ephemeral' CHECK (retention IN ('ephemeral', 'session', 'evidence', 'user_saved')),
  preview_json TEXT,
  redaction_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_capability_jobs_status_deadline ON capability_jobs(status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_capability_jobs_kind_status ON capability_jobs(kind, status);
CREATE INDEX IF NOT EXISTS idx_capability_jobs_session_created ON capability_jobs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_capability_jobs_transaction ON capability_jobs(transaction_id);
CREATE INDEX IF NOT EXISTS idx_capability_job_events_job_created ON capability_job_events(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_capability_job_events_transaction_created ON capability_job_events(transaction_id, created_at);
CREATE INDEX IF NOT EXISTS idx_capability_locks_expires ON capability_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_capability_resources_job ON capability_resources(job_id);
CREATE INDEX IF NOT EXISTS idx_capability_resources_blob ON capability_resources(blob_id);
`
};
