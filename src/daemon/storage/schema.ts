export type StorageMigration = {
  version: number;
  name: string;
  sql: string;
};

export const STORAGE_MIGRATIONS: StorageMigration[] = [
  {
    version: 1,
    name: "initial_product_state",
    sql: `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'trashed')),
  parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  branch_from_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT,
  trashed_at TEXT,
  mascot_preset_id TEXT,
  active_model TEXT,
  active_reasoning TEXT,
  active_mode TEXT,
  summary TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS session_tabs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  window_id TEXT NOT NULL DEFAULT 'main',
  tab_index INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('pending', 'thinking', 'tooling', 'streaming', 'complete', 'cancelled', 'error')),
  content_text TEXT NOT NULL DEFAULT '',
  content_json TEXT,
  model TEXT,
  reasoning_effort TEXT,
  parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS runtime_threads (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('codex-app-server', 'codex-exec', 'oauth-proxy', 'mock')),
  thread_id TEXT,
  turn_id TEXT,
  state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'starting', 'connected', 'active', 'error')),
  started_at TEXT,
  closed_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('dom', 'vision', 'terminal')),
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vision_streams (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'recording', 'streaming', 'stopped', 'error')),
  mode TEXT NOT NULL CHECK (mode IN ('recording', 'agent_stream')),
  fps INTEGER,
  frame_interval_ms INTEGER,
  recording_blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS terminal_sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  cwd TEXT NOT NULL DEFAULT '',
  backend TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('running', 'stopped', 'error')),
  started_at TEXT NOT NULL,
  stopped_at TEXT
);

CREATE TABLE IF NOT EXISTS terminal_events (
  id TEXT PRIMARY KEY,
  terminal_session_id TEXT NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('input', 'output', 'system', 'error')),
  text TEXT NOT NULL DEFAULT '',
  blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('generated', 'modified', 'deleted', 'external')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trashed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_files (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  logical_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  file_kind TEXT NOT NULL DEFAULT 'unknown',
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  current_version_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_file_id TEXT NOT NULL REFERENCES artifact_files(id) ON DELETE CASCADE,
  version_label TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'modify', 'delete')),
  source_path TEXT NOT NULL DEFAULT '',
  before_blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
  after_blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
  diff_blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
  before_hash TEXT,
  after_hash TEXT,
  size INTEGER,
  created_by_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trash_entries (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('session', 'artifact')),
  entity_id TEXT NOT NULL,
  trashed_at TEXT NOT NULL,
  restore_payload_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS theme_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '0.0.0',
  source TEXT NOT NULL DEFAULT 'built-in',
  status TEXT NOT NULL DEFAULT 'installed' CHECK (status IN ('installed', 'disabled', 'removed')),
  manifest_json TEXT NOT NULL DEFAULT '{}',
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mascot_presets (
  id TEXT PRIMARY KEY,
  theme_pack_id TEXT REFERENCES theme_packs(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  species TEXT NOT NULL DEFAULT '',
  asset_blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
  animation_map_json TEXT NOT NULL DEFAULT '{}',
  tone_profile_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_presets (
  id TEXT PRIMARY KEY,
  mascot_preset_id TEXT REFERENCES mascot_presets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  style_rules_json TEXT NOT NULL DEFAULT '{}',
  voice_profile_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '0.0.0',
  source TEXT NOT NULL DEFAULT '',
  permissions_json TEXT NOT NULL DEFAULT '{}',
  manifest_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_status_updated ON sessions(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_session_tabs_window_order ON session_tabs(window_id, tab_index);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_runtime_threads_session_provider ON runtime_threads(session_id, provider);
CREATE INDEX IF NOT EXISTS idx_provider_snapshots_session_provider ON provider_snapshots(session_id, provider, captured_at);
CREATE INDEX IF NOT EXISTS idx_vision_streams_session ON vision_streams(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_terminal_events_session_seq ON terminal_events(terminal_session_id, seq);
CREATE INDEX IF NOT EXISTS idx_artifacts_session_status ON artifacts(session_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_artifact_files_artifact ON artifact_files(artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_file_created ON artifact_versions(artifact_file_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trash_entries_entity ON trash_entries(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_session_created ON activity_log(session_id, created_at);

INSERT OR IGNORE INTO theme_packs (id, name, version, source, status, manifest_json, installed_at, updated_at)
VALUES ('built-in-default', 'Built-in Default', '1.0.0', 'built-in', 'installed', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO mascot_presets (id, theme_pack_id, name, species, animation_map_json, tone_profile_json, is_default, created_at)
VALUES (
  'default-dog',
  'built-in-default',
  'Default Dog',
  'dog',
  '{"idle":"idle","streaming":"attentive","offline":"sleep"}',
  '{"tone":"friendly concise desktop assistant"}',
  1,
  CURRENT_TIMESTAMP
);
`
  }
];

export const LATEST_STORAGE_SCHEMA_VERSION = STORAGE_MIGRATIONS[STORAGE_MIGRATIONS.length - 1]?.version ?? 0;
