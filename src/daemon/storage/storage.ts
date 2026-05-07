import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire as createNodeRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import { resolveStoragePaths, type StoragePathOptions, type StoragePaths } from "./paths.js";
import { LATEST_STORAGE_SCHEMA_VERSION, STORAGE_MIGRATIONS } from "./schema.js";
import type {
  BranchContextMessage,
  ActivityLogEntry,
  ArtifactFilePreview,
  ArtifactKind,
  ArtifactSummary,
  ExecutionPermissionDecision,
  ExecutionPermissionSummary,
  LedgerSnapshot,
  MessageSnapshotStatus,
  ModelId,
  ProviderSnapshotProvider,
  ProviderSnapshotSummary,
  ReasoningEffort,
  SessionMessage,
  SessionSnapshot,
  SessionSummary,
  VisionStreamMode,
  VisionStreamStatus,
  VisionStreamSummary,
  WidgetMode
} from "../../shared/protocol.js";

export type StorageHealth = {
  state: "ready";
  appDataDir: string;
  databasePath: string;
  blobDir: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  migrationsApplied: number;
  tableCount: number;
  journalMode: string;
  foreignKeys: boolean;
  integrity: string;
};

export type StorageService = {
  paths: StoragePaths;
  close: () => void;
  health: (options?: { integrityCheck?: boolean }) => StorageHealth;
  getAppSetting: <T = unknown>(key: string) => T | null;
  setAppSetting: (key: string, value: unknown) => void;
  readExecutionPermissions: () => ExecutionPermissionSummary[];
  readExecutionPermissionDecision: (action: string) => ExecutionPermissionDecision;
  setExecutionPermission: (input: { action: string; decision: ExecutionPermissionDecision }) => ExecutionPermissionSummary[];
  ensureSessionSnapshot: (defaults?: SessionDefaults) => SessionSnapshot;
  createSession: (input?: SessionDefaults) => SessionSnapshot;
  openSession: (sessionId: string) => SessionSnapshot;
  discardSession: (sessionId: string) => SessionSnapshot;
  deleteSession: (sessionId: string) => SessionSnapshot;
  trashSession: (sessionId: string) => SessionSnapshot;
  restoreSession: (sessionId: string) => SessionSnapshot;
  branchSession: (input: BranchSessionInput) => SessionSnapshot;
  prepareAsk: (input: AskPersistenceInput) => { sessionId: string; snapshot: SessionSnapshot };
  appendAssistantDelta: (input: AssistantDeltaInput) => void;
  updateAssistantMessage: (input: AssistantUpdateInput) => void;
  readLedgerSnapshot: (sessionId?: string | null) => LedgerSnapshot;
  readRuntimeThread: (sessionId: string, provider: RuntimeThreadProvider) => RuntimeThreadSummary | null;
  writeRuntimeThread: (input: RuntimeThreadInput) => RuntimeThreadSummary;
  clearRuntimeThread: (sessionId: string, provider: RuntimeThreadProvider, error?: string) => void;
  recordProviderSnapshot: (input: ProviderSnapshotInput) => void;
  recordTextArtifact: (input: TextArtifactInput) => void;
  recordFileChangeArtifact: (input: FileChangeArtifactInput) => void;
  resolveArtifactOpenPath: (artifactFileId: string, versionId?: string) => string | null;
  createVisionStream: (input: VisionStreamInput) => VisionStreamSummary;
  stopVisionStream: (input: StopVisionStreamInput) => VisionStreamSummary;
  completeVisionRecording: (input: CompleteVisionRecordingInput) => VisionStreamSummary;
  recordActivity: (input: {
    id: string;
    sessionId?: string | null;
    level?: "debug" | "info" | "warn" | "error";
    category: string;
    summary: string;
    detail?: unknown;
    createdAt?: string;
  }) => void;
};

export type StorageServiceOptions = StoragePathOptions;

export type SessionDefaults = {
  title?: string;
  model?: ModelId;
  reasoningEffort?: ReasoningEffort;
  mode?: WidgetMode;
};

export type BranchSessionInput = SessionDefaults & {
  parentSessionId?: string | null;
  sourceMessageId?: string;
  messages: BranchContextMessage[];
};

export type AskPersistenceInput = {
  requestId: string;
  sessionId?: string;
  text: string;
  mode: WidgetMode;
  model?: ModelId;
  reasoningEffort?: ReasoningEffort;
  replaceFromMessageId?: string;
};

export type AssistantDeltaInput = {
  sessionId: string;
  messageId: string;
  text: string;
  status?: Extract<MessageSnapshotStatus, "streaming" | "tooling" | "thinking">;
};

export type AssistantUpdateInput = {
  sessionId: string;
  messageId: string;
  text?: string;
  status: MessageSnapshotStatus;
};

export type TextArtifactInput = {
  sessionId: string;
  messageId?: string;
  title: string;
  text: string;
  logicalPath?: string;
  displayName?: string;
  mime?: string;
  fileKind?: string;
  createdAt?: string;
};

export type FileChangeArtifactInput = {
  sessionId: string;
  messageId?: string;
  changeId: string;
  phase: "before" | "after";
  title: string;
  operation: "create" | "modify" | "delete";
  paths: string[];
  workspaceRoot: string;
  detail?: unknown;
  createdAt?: string;
};

export type VisionStreamInput = {
  id: string;
  sessionId?: string | null;
  mode: VisionStreamMode;
  fps?: number;
  frameIntervalMs?: number;
  maxDurationMs?: number;
  detail?: unknown;
  startedAt?: string;
};

export type StopVisionStreamInput = {
  id: string;
  status?: Extract<VisionStreamStatus, "stopped" | "error">;
  reason?: string;
  stoppedAt?: string;
};

export type CompleteVisionRecordingInput = {
  id: string;
  mime: string;
  dataUrl: string;
  durationMs?: number;
  size?: number;
  stoppedAt?: string;
};

export type RuntimeThreadProvider = "codex-app-server" | "codex-exec" | "oauth-proxy" | "mock";

export type RuntimeThreadState = "closed" | "starting" | "connected" | "active" | "error";

export type RuntimeThreadSummary = {
  id: string;
  sessionId: string;
  provider: RuntimeThreadProvider;
  threadId?: string;
  turnId?: string;
  state: RuntimeThreadState;
  startedAt?: string;
  closedAt?: string;
  lastError?: string;
};

export type RuntimeThreadInput = {
  sessionId: string;
  provider: RuntimeThreadProvider;
  threadId?: string;
  turnId?: string;
  state?: RuntimeThreadState;
  startedAt?: string;
  closedAt?: string;
  lastError?: string;
};

export type ProviderSnapshotInput = {
  sessionId?: string | null;
  messageId?: string | null;
  provider: ProviderSnapshotProvider;
  title: string;
  summary: string;
  data?: unknown;
  capturedAt?: string;
};

const SECRET_SETTING_PATTERN = /(?:access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|credential)/i;
const ACTIVE_SESSION_SETTING_KEY = "session.active";
const EXECUTION_PERMISSIONS_SETTING_KEY = "execution.permissions.v1";
const MAX_ARTIFACT_TEXT_PREVIEW_BYTES = 24 * 1024;
const MAX_ARTIFACT_IMAGE_PREVIEW_BYTES = 512 * 1024;
const DatabaseSync = loadDatabaseSync();

export function createStorageService(options: StorageServiceOptions = {}): StorageService {
  const paths = resolveStoragePaths(options);
  mkdirSync(dirname(paths.databasePath), { recursive: true });

  const database = new DatabaseSync(paths.databasePath);
  configureDatabase(database);
  migrate(database);

  return {
    paths,
    close: () => {
      database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      database.close();
    },
    health: (healthOptions) => readStorageHealth(database, paths, healthOptions),
    getAppSetting: <T = unknown>(key: string): T | null => readAppSetting<T>(database, key),
    setAppSetting: (key: string, value: unknown) => writeAppSetting(database, key, value),
    readExecutionPermissions: () => readExecutionPermissions(database),
    readExecutionPermissionDecision: (action) => readExecutionPermissionDecision(database, action),
    setExecutionPermission: (input) => setExecutionPermission(database, input),
    ensureSessionSnapshot: (defaults = {}) => ensureSessionSnapshot(database, defaults),
    createSession: (input = {}) => createSession(database, input),
    openSession: (sessionId) => openSession(database, sessionId),
    discardSession: (sessionId) => discardSession(database, sessionId),
    deleteSession: (sessionId) => deleteSession(database, sessionId),
    trashSession: (sessionId) => trashSession(database, sessionId),
    restoreSession: (sessionId) => restoreSession(database, sessionId),
    branchSession: (input) => branchSession(database, input),
    prepareAsk: (input) => prepareAsk(database, input),
    appendAssistantDelta: (input) => appendAssistantDelta(database, input),
    updateAssistantMessage: (input) => updateAssistantMessage(database, input),
    readLedgerSnapshot: (sessionId) => readLedgerSnapshot(database, sessionId),
    readRuntimeThread: (sessionId, provider) => readRuntimeThread(database, sessionId, provider),
    writeRuntimeThread: (input) => writeRuntimeThread(database, input),
    clearRuntimeThread: (sessionId, provider, error) => clearRuntimeThread(database, sessionId, provider, error),
    recordProviderSnapshot: (input) => recordProviderSnapshot(database, input),
    recordTextArtifact: (input) => recordTextArtifact(database, paths, input),
    recordFileChangeArtifact: (input) => recordFileChangeArtifact(database, paths, input),
    resolveArtifactOpenPath: (artifactFileId, versionId) => resolveArtifactOpenPath(database, artifactFileId, versionId),
    createVisionStream: (input) => createVisionStream(database, input),
    stopVisionStream: (input) => stopVisionStream(database, input),
    completeVisionRecording: (input) => completeVisionRecording(database, paths, input),
    recordActivity: (input) => recordActivity(database, input)
  };
}

export function assertPersistableSettingKey(key: string): void {
  const normalized = key.trim();
  if (!normalized) {
    throw new Error("Setting key is required.");
  }
  if (SECRET_SETTING_PATTERN.test(normalized)) {
    throw new Error(`Refusing to persist secret-like setting key: ${normalized}`);
  }
}

function configureDatabase(database: NodeDatabaseSync): void {
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
}

function migrate(database: NodeDatabaseSync): void {
  database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);

  for (const migration of STORAGE_MIGRATIONS) {
    const row = database.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(migration.version);
    if (row) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
        .run(migration.version, migration.name);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function readStorageHealth(
  database: NodeDatabaseSync,
  paths: StoragePaths,
  options: { integrityCheck?: boolean } = {}
): StorageHealth {
  const journalMode = readSingleValue(database, "PRAGMA journal_mode", "journal_mode");
  const foreignKeys = Number(readSingleValue(database, "PRAGMA foreign_keys", "foreign_keys")) === 1;
  const integrity = options.integrityCheck === false
    ? "not_checked"
    : String(readSingleValue(database, "PRAGMA integrity_check", "integrity_check"));
  const schemaVersion = Number(readSingleValue(database, "SELECT COALESCE(MAX(version), 0) AS value FROM schema_migrations", "value"));
  const migrationsApplied = Number(readSingleValue(database, "SELECT COUNT(*) AS value FROM schema_migrations", "value"));
  const tableCount = Number(
    readSingleValue(
      database,
      "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      "value"
    )
  );

  return {
    state: "ready",
    appDataDir: paths.appDataDir,
    databasePath: paths.databasePath,
    blobDir: paths.blobDir,
    schemaVersion,
    latestSchemaVersion: LATEST_STORAGE_SCHEMA_VERSION,
    migrationsApplied,
    tableCount,
    journalMode: String(journalMode),
    foreignKeys,
    integrity
  };
}

type SqlValue = string | number | bigint | null | Uint8Array;

function readSingleValue(database: NodeDatabaseSync, sql: string, key: string, ...values: SqlValue[]): unknown {
  const row = database.prepare(sql).get(...values);
  return row?.[key];
}

function readAppSetting<T>(database: NodeDatabaseSync, key: string): T | null {
  const row = database.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key.trim());
  if (typeof row?.value_json !== "string") {
    return null;
  }
  return JSON.parse(row.value_json) as T;
}

function writeAppSetting(database: NodeDatabaseSync, key: string, value: unknown): void {
  assertPersistableSettingKey(key);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO app_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(key.trim(), JSON.stringify(value), now);
}

type StoredExecutionPermission = {
  decision: ExecutionPermissionDecision;
  updatedAt: string;
};

function readExecutionPermissions(database: NodeDatabaseSync): ExecutionPermissionSummary[] {
  const stored = readStoredExecutionPermissions(database);
  return Object.entries(stored)
    .map(([action, record]) => ({
      action,
      decision: record.decision,
      updatedAt: record.updatedAt
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.action.localeCompare(right.action));
}

function readExecutionPermissionDecision(database: NodeDatabaseSync, action: string): ExecutionPermissionDecision {
  const actionKey = normalizeExecutionPermissionAction(action);
  if (!actionKey) {
    return "ask";
  }
  const decision = readStoredExecutionPermissions(database)[actionKey]?.decision;
  return decision === "allow" || decision === "deny" ? decision : "ask";
}

function setExecutionPermission(
  database: NodeDatabaseSync,
  input: { action: string; decision: ExecutionPermissionDecision }
): ExecutionPermissionSummary[] {
  const action = normalizeExecutionPermissionAction(input.action);
  if (!action) {
    throw new Error("Execution permission action is required.");
  }
  const stored = readStoredExecutionPermissions(database);
  if (input.decision === "ask") {
    delete stored[action];
  } else {
    stored[action] = {
      decision: input.decision,
      updatedAt: new Date().toISOString()
    };
  }
  writeAppSetting(database, EXECUTION_PERMISSIONS_SETTING_KEY, stored);
  return readExecutionPermissions(database);
}

function readStoredExecutionPermissions(database: NodeDatabaseSync): Record<string, StoredExecutionPermission> {
  const stored = readAppSetting<Record<string, StoredExecutionPermission>>(database, EXECUTION_PERMISSIONS_SETTING_KEY);
  const normalized: Record<string, StoredExecutionPermission> = {};
  if (!stored || typeof stored !== "object") {
    return normalized;
  }
  for (const [action, record] of Object.entries(stored)) {
    const actionKey = normalizeExecutionPermissionAction(action);
    if (!actionKey || typeof record !== "object" || record === null) {
      continue;
    }
    const decision = record.decision === "allow" || record.decision === "deny" ? record.decision : undefined;
    if (!decision) {
      continue;
    }
    normalized[actionKey] = {
      decision,
      updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : new Date().toISOString()
    };
  }
  return normalized;
}

function normalizeExecutionPermissionAction(action: string): string {
  return action.replace(/\s+/g, " ").trim().slice(0, 240);
}

function ensureSessionSnapshot(database: NodeDatabaseSync, defaults: SessionDefaults = {}): SessionSnapshot {
  const activeSessionId = readActiveSessionId(database);
  if (activeSessionId && isRestorableSession(database, activeSessionId)) {
    touchSessionOpened(database, activeSessionId);
    return readSessionSnapshot(database, activeSessionId);
  }

  const latest = database
    .prepare(
      `SELECT id FROM sessions
       WHERE status = 'active'
       ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC
       LIMIT 1`
    )
    .get();
  if (typeof latest?.id === "string") {
    touchSessionOpened(database, latest.id);
    return readSessionSnapshot(database, latest.id);
  }

  return createSession(database, defaults);
}

function createSession(database: NodeDatabaseSync, input: SessionDefaults = {}): SessionSnapshot {
  const id = randomUUID();
  insertSession(database, {
    id,
    title: sanitizeSessionTitle(input.title, "New chat"),
    parentSessionId: null,
    branchFromMessageId: null,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    mode: input.mode
  });
  writeAppSetting(database, ACTIVE_SESSION_SETTING_KEY, id);
  return readSessionSnapshot(database, id);
}

function openSession(database: NodeDatabaseSync, sessionId: string): SessionSnapshot {
  if (!isRestorableSession(database, sessionId)) {
    throw new Error("Session is not available.");
  }
  touchSessionOpened(database, sessionId);
  return readSessionSnapshot(database, sessionId);
}

function discardSession(database: NodeDatabaseSync, sessionId: string): SessionSnapshot {
  const row = database.prepare("SELECT id, title FROM sessions WHERE id = ? AND status = 'active'").get(sessionId);
  if (typeof row?.id !== "string") {
    return ensureSessionSnapshot(database);
  }
  const title = typeof row.title === "string" ? row.title.trim().toLowerCase() : "";
  const messageCount = Number(readSingleValue(database, "SELECT COUNT(*) AS value FROM messages WHERE session_id = ?", "value", sessionId) ?? 0);
  const artifactCount = Number(readSingleValue(database, "SELECT COUNT(*) AS value FROM artifacts WHERE session_id = ?", "value", sessionId) ?? 0);
  if (title !== "new chat" || messageCount > 0 || artifactCount > 0) {
    return trashSession(database, sessionId);
  }

  database.prepare("DELETE FROM trash_entries WHERE entity_type = 'session' AND entity_id = ?").run(sessionId);
  database.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);

  if (readActiveSessionId(database) !== sessionId) {
    return ensureSessionSnapshot(database);
  }

  const next = database
    .prepare(
      `SELECT id FROM sessions
       WHERE status = 'active'
       ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC
       LIMIT 1`
    )
    .get();
  if (typeof next?.id === "string") {
    return openSession(database, next.id);
  }
  return createSession(database);
}

function deleteSession(database: NodeDatabaseSync, sessionId: string): SessionSnapshot {
  const row = database.prepare("SELECT id, status FROM sessions WHERE id = ?").get(sessionId);
  if (typeof row?.id !== "string") {
    return ensureSessionSnapshot(database);
  }
  if (row.status !== "trashed") {
    return ensureSessionSnapshot(database);
  }

  database.prepare("DELETE FROM trash_entries WHERE entity_type = 'session' AND entity_id = ?").run(sessionId);
  database.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  return ensureSessionSnapshot(database);
}

function trashSession(database: NodeDatabaseSync, sessionId: string): SessionSnapshot {
  const now = new Date().toISOString();
  const row = database.prepare("SELECT id, status FROM sessions WHERE id = ?").get(sessionId);
  if (typeof row?.id !== "string") {
    return ensureSessionSnapshot(database);
  }

  database
    .prepare(
      `UPDATE sessions
       SET status = 'trashed', trashed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(now, now, sessionId);
  database.prepare("DELETE FROM trash_entries WHERE entity_type = 'session' AND entity_id = ?").run(sessionId);
  database
    .prepare(
      `INSERT INTO trash_entries (id, entity_type, entity_id, trashed_at, restore_payload_json)
       VALUES (?, 'session', ?, ?, ?)`
    )
    .run(randomUUID(), sessionId, now, JSON.stringify({ previousStatus: row.status ?? "active" }));

  if (readActiveSessionId(database) !== sessionId) {
    return ensureSessionSnapshot(database);
  }

  const next = database
    .prepare(
      `SELECT id FROM sessions
       WHERE status = 'active' AND id <> ?
       ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC
       LIMIT 1`
    )
    .get(sessionId);
  if (typeof next?.id === "string") {
    return openSession(database, next.id);
  }
  return createSession(database);
}

function restoreSession(database: NodeDatabaseSync, sessionId: string): SessionSnapshot {
  const row = database.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
  if (typeof row?.id !== "string") {
    throw new Error("Session is not available.");
  }

  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE sessions
       SET status = 'active', trashed_at = NULL, updated_at = ?, last_opened_at = ?
       WHERE id = ?`
    )
    .run(now, now, sessionId);
  database.prepare("DELETE FROM trash_entries WHERE entity_type = 'session' AND entity_id = ?").run(sessionId);
  writeAppSetting(database, ACTIVE_SESSION_SETTING_KEY, sessionId);
  return readSessionSnapshot(database, sessionId);
}

function branchSession(database: NodeDatabaseSync, input: BranchSessionInput): SessionSnapshot {
  const activeParentId = input.parentSessionId ?? readActiveSessionId(database);
  const id = randomUUID();
  const userText = input.messages.find((message) => message.role === "user")?.text ?? "";
  insertSession(database, {
    id,
    title: sanitizeSessionTitle(input.title, titleFromPrompt(userText, "Branch chat")),
    parentSessionId: activeParentId && isKnownSession(database, activeParentId) ? activeParentId : null,
    branchFromMessageId: input.sourceMessageId ?? null,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    mode: input.mode
  });

  let previousMessageId: string | null = null;
  for (const message of input.messages.slice(0, 8)) {
    const messageId = `${message.role}:${randomUUID()}`;
    insertMessage(database, {
      id: messageId,
      sessionId: id,
      turnId: messageId,
      role: message.role,
      status: "complete",
      text: message.text,
      parentMessageId: previousMessageId
    });
    previousMessageId = messageId;
  }

  writeAppSetting(database, ACTIVE_SESSION_SETTING_KEY, id);
  return readSessionSnapshot(database, id);
}

function prepareAsk(database: NodeDatabaseSync, input: AskPersistenceInput): { sessionId: string; snapshot: SessionSnapshot } {
  const fallbackSnapshot = input.sessionId && isRestorableSession(database, input.sessionId)
    ? null
    : ensureSessionSnapshot(database, {
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        mode: input.mode
      });
  const sessionId = input.sessionId && isRestorableSession(database, input.sessionId)
    ? input.sessionId
    : fallbackSnapshot?.activeSessionId;
  if (!sessionId) {
    throw new Error("Unable to resolve active session.");
  }

  if (input.replaceFromMessageId) {
    deleteMessagesFrom(database, sessionId, input.replaceFromMessageId);
  }

  const now = new Date().toISOString();
  const hasUserMessage = Number(
    readSingleValue(database, "SELECT COUNT(*) AS value FROM messages WHERE session_id = ? AND role = 'user'", "value", sessionId)
  ) > 0;
  const nextTitle = hasUserMessage ? undefined : titleFromPrompt(input.text, "New chat");
  updateSessionMetadata(database, sessionId, {
    title: nextTitle,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    mode: input.mode,
    openedAt: now
  });
  writeAppSetting(database, ACTIVE_SESSION_SETTING_KEY, sessionId);

  const userMessageId = `user:${input.requestId}`;
  insertMessage(database, {
    id: userMessageId,
    sessionId,
    turnId: input.requestId,
    role: "user",
    status: "complete",
    text: input.text,
    model: input.model,
    reasoningEffort: input.reasoningEffort
  });
  insertMessage(database, {
    id: input.requestId,
    sessionId,
    turnId: input.requestId,
    role: "assistant",
    status: "pending",
    text: "",
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    parentMessageId: userMessageId
  });

  return { sessionId, snapshot: readSessionSnapshot(database, sessionId) };
}

function appendAssistantDelta(database: NodeDatabaseSync, input: AssistantDeltaInput): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE messages
       SET content_text = content_text || ?, status = ?, updated_at = ?
       WHERE id = ? AND session_id = ? AND role = 'assistant'`
    )
    .run(input.text, dbStatusFromSnapshot(input.status ?? "streaming"), now, input.messageId, input.sessionId);
  touchSessionUpdated(database, input.sessionId, now);
}

function updateAssistantMessage(database: NodeDatabaseSync, input: AssistantUpdateInput): void {
  const now = new Date().toISOString();
  const status = dbStatusFromSnapshot(input.status);
  const completedAt = input.status === "done" || input.status === "cancelled" || input.status === "error" ? now : null;
  if (typeof input.text === "string") {
    database
      .prepare(
        `UPDATE messages
         SET content_text = ?, status = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND session_id = ? AND role = 'assistant'`
      )
      .run(input.text, status, now, completedAt, input.messageId, input.sessionId);
  } else {
    database
      .prepare(
        `UPDATE messages
         SET status = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND session_id = ? AND role = 'assistant'`
      )
      .run(status, now, completedAt, input.messageId, input.sessionId);
  }
  touchSessionUpdated(database, input.sessionId, now);
}

function readRuntimeThread(
  database: NodeDatabaseSync,
  sessionId: string,
  provider: RuntimeThreadProvider
): RuntimeThreadSummary | null {
  const row = database
    .prepare(
      `SELECT id, session_id, provider, thread_id, turn_id, state, started_at, closed_at, last_error
       FROM runtime_threads
       WHERE id = ?`
    )
    .get(runtimeThreadRowId(sessionId, provider));
  return readRuntimeThreadRow(row);
}

function writeRuntimeThread(database: NodeDatabaseSync, input: RuntimeThreadInput): RuntimeThreadSummary {
  if (!isRestorableSession(database, input.sessionId)) {
    throw new Error("Runtime thread session is not available.");
  }

  const now = new Date().toISOString();
  const id = runtimeThreadRowId(input.sessionId, input.provider);
  const state = normalizeRuntimeThreadState(input.state);
  const closedAt = input.closedAt ?? (state === "closed" || state === "error" ? now : null);
  database
    .prepare(
      `INSERT INTO runtime_threads (id, session_id, provider, thread_id, turn_id, state, started_at, closed_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         thread_id = excluded.thread_id,
         turn_id = excluded.turn_id,
         state = excluded.state,
         started_at = COALESCE(runtime_threads.started_at, excluded.started_at),
         closed_at = excluded.closed_at,
         last_error = excluded.last_error`
    )
    .run(
      id,
      input.sessionId,
      input.provider,
      input.threadId ?? null,
      input.turnId ?? null,
      state,
      input.startedAt ?? now,
      closedAt,
      input.lastError ?? null
    );

  const written = readRuntimeThread(database, input.sessionId, input.provider);
  if (!written) {
    throw new Error("Unable to read persisted runtime thread.");
  }
  return written;
}

function clearRuntimeThread(
  database: NodeDatabaseSync,
  sessionId: string,
  provider: RuntimeThreadProvider,
  error?: string
): void {
  if (!isRestorableSession(database, sessionId)) {
    return;
  }
  writeRuntimeThread(database, {
    sessionId,
    provider,
    state: error ? "error" : "closed",
    lastError: error
  });
}

function readSessionSnapshot(database: NodeDatabaseSync, activeSessionId: string): SessionSnapshot {
  const activeSessions = database
    .prepare(
      `SELECT sessions.*,
              (SELECT COUNT(*) FROM artifacts WHERE artifacts.session_id = sessions.id AND artifacts.status = 'active') AS artifact_count,
              (SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id) AS message_count
       FROM sessions
       WHERE sessions.status <> 'trashed'
       ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC
       LIMIT 40`
    )
    .all();
  const trashedSessions = database
    .prepare(
      `SELECT sessions.*,
              (SELECT COUNT(*) FROM artifacts WHERE artifacts.session_id = sessions.id) AS artifact_count,
              (SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id) AS message_count
       FROM sessions
       WHERE sessions.status = 'trashed'
       ORDER BY COALESCE(trashed_at, updated_at) DESC
       LIMIT 30`
    )
    .all();
  const messages = database
    .prepare(
      `SELECT id, role, status, content_text
       FROM messages
       WHERE session_id = ? AND role IN ('user', 'assistant')
       ORDER BY created_at ASC, rowid ASC
       LIMIT 240`
    )
    .all(activeSessionId);

  return {
    activeSessionId,
    sessions: activeSessions.flatMap(readSessionSummary),
    trashedSessions: trashedSessions.flatMap(readSessionSummary),
    messages: messages.flatMap(readSessionMessage)
  };
}

function readSessionSummary(value: unknown): SessionSummary[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.status !== "string") {
    return [];
  }
  return [
    {
      id: row.id,
      title: row.title,
      status: row.status === "archived" || row.status === "trashed" ? row.status : "active",
      createdAt: stringOrNow(row.created_at),
      updatedAt: stringOrNow(row.updated_at),
      lastOpenedAt: optionalString(row.last_opened_at),
      parentSessionId: optionalString(row.parent_session_id),
      branchFromMessageId: optionalString(row.branch_from_message_id),
      activeModel: optionalString(row.active_model) as ModelId | undefined,
      activeReasoning: optionalString(row.active_reasoning) as ReasoningEffort | undefined,
      activeMode: optionalString(row.active_mode) as WidgetMode | undefined,
      artifactCount: typeof row.artifact_count === "number" ? row.artifact_count : Number(row.artifact_count ?? 0),
      messageCount: typeof row.message_count === "number" ? row.message_count : Number(row.message_count ?? 0)
    }
  ];
}

function readSessionMessage(value: unknown): SessionMessage[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.role !== "string" || typeof row.content_text !== "string") {
    return [];
  }
  if (row.role !== "user" && row.role !== "assistant") {
    return [];
  }
  return [
    {
      id: row.id,
      role: row.role,
      text: row.content_text,
      status: row.role === "assistant" ? snapshotStatusFromDb(row.status) : undefined
    }
  ];
}

function insertSession(
  database: NodeDatabaseSync,
  input: {
    id: string;
    title: string;
    parentSessionId?: string | null;
    branchFromMessageId?: string | null;
    model?: ModelId;
    reasoningEffort?: ReasoningEffort;
    mode?: WidgetMode;
  }
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO sessions (
        id, title, status, parent_session_id, branch_from_message_id, created_at, updated_at, last_opened_at,
        active_model, active_reasoning, active_mode
      )
      VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.title,
      input.parentSessionId ?? null,
      input.branchFromMessageId ?? null,
      now,
      now,
      now,
      input.model ?? null,
      input.reasoningEffort ?? null,
      input.mode ?? null
    );
  database
    .prepare(
      `INSERT INTO session_tabs (id, session_id, window_id, tab_index, active, created_at, updated_at)
       VALUES (?, ?, 'main', 0, 1, ?, ?)`
    )
    .run(randomUUID(), input.id, now, now);
}

function insertMessage(
  database: NodeDatabaseSync,
  input: {
    id: string;
    sessionId: string;
    turnId?: string;
    role: "user" | "assistant";
    status: "pending" | "thinking" | "tooling" | "streaming" | "complete" | "cancelled" | "error";
    text: string;
    model?: ModelId;
    reasoningEffort?: ReasoningEffort;
    parentMessageId?: string | null;
  }
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT OR IGNORE INTO messages (
        id, session_id, turn_id, role, status, content_text, model, reasoning_effort, parent_message_id,
        created_at, updated_at, completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.sessionId,
      input.turnId ?? null,
      input.role,
      input.status,
      input.text,
      input.model ?? null,
      input.reasoningEffort ?? null,
      input.parentMessageId ?? null,
      now,
      now,
      input.status === "complete" || input.status === "cancelled" || input.status === "error" ? now : null
    );
}

function deleteMessagesFrom(database: NodeDatabaseSync, sessionId: string, messageId: string): void {
  const row = database.prepare("SELECT created_at, rowid FROM messages WHERE session_id = ? AND id = ?").get(sessionId, messageId);
  if (typeof row?.created_at !== "string" || typeof row?.rowid !== "number") {
    return;
  }
  database
    .prepare(
      `DELETE FROM messages
       WHERE session_id = ?
         AND (created_at > ? OR (created_at = ? AND rowid >= ?))`
    )
    .run(sessionId, row.created_at, row.created_at, row.rowid);
  touchSessionUpdated(database, sessionId);
}

function updateSessionMetadata(
  database: NodeDatabaseSync,
  sessionId: string,
  input: {
    title?: string;
    model?: ModelId;
    reasoningEffort?: ReasoningEffort;
    mode?: WidgetMode;
    openedAt?: string;
  }
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE sessions
       SET title = COALESCE(?, title),
           active_model = COALESCE(?, active_model),
           active_reasoning = COALESCE(?, active_reasoning),
           active_mode = COALESCE(?, active_mode),
           updated_at = ?,
           last_opened_at = COALESCE(?, last_opened_at)
       WHERE id = ?`
    )
    .run(input.title ?? null, input.model ?? null, input.reasoningEffort ?? null, input.mode ?? null, now, input.openedAt ?? null, sessionId);
}

function touchSessionOpened(database: NodeDatabaseSync, sessionId: string): void {
  const now = new Date().toISOString();
  database.prepare("UPDATE sessions SET last_opened_at = ?, updated_at = ? WHERE id = ?").run(now, now, sessionId);
  writeAppSetting(database, ACTIVE_SESSION_SETTING_KEY, sessionId);
}

function touchSessionUpdated(database: NodeDatabaseSync, sessionId: string, at = new Date().toISOString()): void {
  database.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(at, sessionId);
}

function readActiveSessionId(database: NodeDatabaseSync): string | null {
  const id = readAppSetting<string>(database, ACTIVE_SESSION_SETTING_KEY);
  return typeof id === "string" && id.trim() ? id : null;
}

function isKnownSession(database: NodeDatabaseSync, sessionId: string): boolean {
  const row = database.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
  return typeof row?.id === "string";
}

function isRestorableSession(database: NodeDatabaseSync, sessionId: string): boolean {
  const row = database.prepare("SELECT id FROM sessions WHERE id = ? AND status <> 'trashed'").get(sessionId);
  return typeof row?.id === "string";
}

function dbStatusFromSnapshot(status: MessageSnapshotStatus): "pending" | "thinking" | "tooling" | "streaming" | "complete" | "cancelled" | "error" {
  return status === "done" ? "complete" : status;
}

function snapshotStatusFromDb(value: unknown): MessageSnapshotStatus {
  if (
    value === "pending" ||
    value === "thinking" ||
    value === "tooling" ||
    value === "streaming" ||
    value === "cancelled" ||
    value === "error"
  ) {
    return value;
  }
  return "done";
}

function sanitizeSessionTitle(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 54 ? `${normalized.slice(0, 53)}...` : normalized;
}

function titleFromPrompt(text: string, fallback: string): string {
  return sanitizeSessionTitle(text, fallback);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringOrNow(value: unknown): string {
  return typeof value === "string" && value ? value : new Date().toISOString();
}

function createVisionStream(database: NodeDatabaseSync, input: VisionStreamInput): VisionStreamSummary {
  const now = input.startedAt ?? new Date().toISOString();
  const status: VisionStreamStatus = input.mode === "recording" ? "recording" : "streaming";
  const detail = {
    ...(readRecord(input.detail) ?? {}),
    maxDurationMs: normalizeOptionalNumber(input.maxDurationMs)
  };
  database
    .prepare(
      `INSERT OR REPLACE INTO vision_streams (
         id, session_id, status, mode, fps, frame_interval_ms, recording_blob_id, started_at, stopped_at, detail_json
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`
    )
    .run(
      input.id,
      input.sessionId ?? null,
      status,
      input.mode,
      normalizeOptionalNumber(input.fps) ?? null,
      normalizeOptionalNumber(input.frameIntervalMs) ?? null,
      now,
      JSON.stringify(detail)
    );
  return readVisionStream(database, input.id);
}

function stopVisionStream(database: NodeDatabaseSync, input: StopVisionStreamInput): VisionStreamSummary {
  const now = input.stoppedAt ?? new Date().toISOString();
  const current = readVisionStream(database, input.id);
  const nextDetail = {
    ...(readRecord(current.detail) ?? {}),
    reason: input.reason || undefined
  };
  database
    .prepare(
      `UPDATE vision_streams
       SET status = ?, stopped_at = ?, detail_json = ?
       WHERE id = ?`
    )
    .run(input.status ?? "stopped", now, JSON.stringify(nextDetail), input.id);
  return readVisionStream(database, input.id);
}

function completeVisionRecording(database: NodeDatabaseSync, paths: StoragePaths, input: CompleteVisionRecordingInput): VisionStreamSummary {
  const now = input.stoppedAt ?? new Date().toISOString();
  const current = readVisionStream(database, input.id);
  const bytes = readDataUrlBytes(input.dataUrl);
  const mime = normalizeRecordingMime(input.mime);
  const blob = writeBlob(paths, bytes, mime, `${input.id}.webm`);
  insertBlob(database, blob);
  const nextDetail = {
    ...(readRecord(current.detail) ?? {}),
    durationMs: normalizeOptionalNumber(input.durationMs),
    size: normalizeOptionalNumber(input.size) ?? bytes.byteLength,
    mime
  };
  database
    .prepare(
      `UPDATE vision_streams
       SET status = 'stopped', stopped_at = ?, recording_blob_id = ?, detail_json = ?
       WHERE id = ?`
    )
    .run(now, blob.id, JSON.stringify(nextDetail), input.id);
  return readVisionStream(database, input.id);
}

function readVisionStream(database: NodeDatabaseSync, id: string): VisionStreamSummary {
  const row = database
    .prepare(
      `SELECT id, session_id, status, mode, fps, frame_interval_ms, recording_blob_id, started_at, stopped_at, detail_json
       FROM vision_streams
       WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row || typeof row.id !== "string") {
    throw new Error(`Vision stream not found: ${id}`);
  }
  return {
    id: row.id,
    sessionId: optionalString(row.session_id),
    mode: normalizeVisionStreamMode(row.mode),
    status: normalizeVisionStreamStatus(row.status),
    fps: normalizeOptionalNumber(row.fps),
    frameIntervalMs: normalizeOptionalNumber(row.frame_interval_ms),
    recordingBlobId: optionalString(row.recording_blob_id),
    startedAt: stringOrNow(row.started_at),
    stoppedAt: optionalString(row.stopped_at),
    detail: parseJsonField(row.detail_json)
  };
}

function readLedgerSnapshot(database: NodeDatabaseSync, sessionId: string | null | undefined): LedgerSnapshot {
  const activeSessionId = sessionId && isKnownSession(database, sessionId)
    ? sessionId
    : ensureSessionSnapshot(database).activeSessionId;
  const artifacts = readArtifacts(database, activeSessionId);
  const activities = readActivities(database, activeSessionId);
  const providerSnapshots = readProviderSnapshots(database, activeSessionId);
  return {
    sessionId: activeSessionId,
    artifacts,
    activities,
    providerSnapshots
  };
}

function recordProviderSnapshot(database: NodeDatabaseSync, input: ProviderSnapshotInput): void {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const dataJson = stringifyBoundedJson(input.data ?? {}, 32 * 1024);
  database
    .prepare(
      `INSERT INTO provider_snapshots (id, session_id, message_id, provider, title, summary, data_json, blob_id, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      randomUUID(),
      input.sessionId ?? null,
      input.messageId ?? null,
      input.provider,
      sanitizeSessionTitle(input.title, "Provider snapshot"),
      sanitizeProviderSummary(input.summary),
      dataJson,
      capturedAt
    );
}

function recordTextArtifact(database: NodeDatabaseSync, paths: StoragePaths, input: TextArtifactInput): void {
  const text = input.text.trimEnd();
  if (!text) {
    return;
  }

  const now = input.createdAt ?? new Date().toISOString();
  const artifactId = randomUUID();
  const fileId = randomUUID();
  const versionId = randomUUID();
  const logicalPath = input.logicalPath ?? `${slugify(input.title)}.txt`;
  const displayName = input.displayName ?? basename(logicalPath);
  const blob = writeBlob(paths, Buffer.from(text, "utf8"), input.mime ?? "text/plain", displayName);

  database.exec("BEGIN IMMEDIATE");
  try {
    insertBlob(database, blob);
    database
      .prepare(
        `INSERT INTO artifacts (id, session_id, message_id, title, kind, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'generated', 'active', ?, ?)`
      )
      .run(artifactId, input.sessionId, input.messageId ?? null, sanitizeSessionTitle(input.title, "Generated artifact"), now, now);
    database
      .prepare(
        `INSERT INTO artifact_files (id, artifact_id, logical_path, display_name, file_kind, mime, current_version_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(fileId, artifactId, logicalPath, displayName, input.fileKind ?? "text", input.mime ?? "text/plain", versionId, now);
    database
      .prepare(
        `INSERT INTO artifact_versions (
          id, artifact_file_id, version_label, operation, source_path, after_blob_id, after_hash, size, created_by_message_id, created_at
        )
        VALUES (?, ?, ?, 'create', ?, ?, ?, ?, ?, ?)`
      )
      .run(versionId, fileId, "v1", "", blob.id, blob.hash, blob.size, input.messageId ?? null, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function recordFileChangeArtifact(database: NodeDatabaseSync, paths: StoragePaths, input: FileChangeArtifactInput): void {
  const normalizedFiles = input.paths
    .map((filePath) => resolveWorkspacePath(input.workspaceRoot, filePath))
    .filter((filePath): filePath is string => Boolean(filePath))
    .slice(0, 20);
  if (normalizedFiles.length === 0) {
    return;
  }

  const now = input.createdAt ?? new Date().toISOString();
  const artifactId = stableId("artifact", input.sessionId, input.changeId);
  const kind = artifactKindFromOperation(input.operation);

  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `INSERT INTO artifacts (id, session_id, message_id, title, kind, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           kind = excluded.kind,
           updated_at = excluded.updated_at`
      )
      .run(artifactId, input.sessionId, input.messageId ?? null, input.title, kind, now, now);

    for (const sourcePath of normalizedFiles) {
      const relativePath = safeRelativePath(input.workspaceRoot, sourcePath);
      const fileId = stableId("artifact-file", artifactId, relativePath);
      const existingFile = database.prepare("SELECT current_version_id FROM artifact_files WHERE id = ?").get(fileId);
      const versionId = typeof existingFile?.current_version_id === "string" ? existingFile.current_version_id : stableId("artifact-version", fileId, "v1");
      const snapshot = readFileSnapshot(paths, sourcePath);
      const beforeColumn = input.phase === "before" ? "before_blob_id" : "after_blob_id";
      const beforeHashColumn = input.phase === "before" ? "before_hash" : "after_hash";
      const blobId = snapshot.blob?.id ?? null;
      if (snapshot.blob) {
        insertBlob(database, snapshot.blob);
      }

      database
        .prepare(
          `INSERT INTO artifact_files (id, artifact_id, logical_path, display_name, file_kind, mime, current_version_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             logical_path = excluded.logical_path,
             display_name = excluded.display_name,
             file_kind = excluded.file_kind,
             mime = excluded.mime,
             current_version_id = excluded.current_version_id`
        )
        .run(fileId, artifactId, relativePath, basename(sourcePath), snapshot.fileKind, snapshot.mime, versionId, now);

      database
        .prepare(
          `INSERT INTO artifact_versions (
            id, artifact_file_id, version_label, operation, source_path, ${beforeColumn}, ${beforeHashColumn},
            size, created_by_message_id, created_at
          )
          VALUES (?, ?, 'v1', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            operation = excluded.operation,
            source_path = excluded.source_path,
            ${beforeColumn} = excluded.${beforeColumn},
            ${beforeHashColumn} = excluded.${beforeHashColumn},
            size = COALESCE(excluded.size, size),
            created_by_message_id = COALESCE(excluded.created_by_message_id, created_by_message_id)`
        )
        .run(versionId, fileId, input.operation, sourcePath, blobId, snapshot.blob?.hash ?? null, snapshot.blob?.size ?? null, input.messageId ?? null, now);

      if (input.phase === "after") {
        persistDiffForVersion(database, paths, versionId);
      }
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function resolveArtifactOpenPath(database: NodeDatabaseSync, artifactFileId: string, versionId?: string): string | null {
  const row = database
    .prepare(
      `SELECT artifact_versions.source_path AS source_path,
              after_blob.path AS after_blob_path,
              before_blob.path AS before_blob_path
       FROM artifact_files
       LEFT JOIN artifact_versions ON artifact_versions.id = COALESCE(?, artifact_files.current_version_id)
       LEFT JOIN blobs AS after_blob ON after_blob.id = artifact_versions.after_blob_id
       LEFT JOIN blobs AS before_blob ON before_blob.id = artifact_versions.before_blob_id
       WHERE artifact_files.id = ?
         AND artifact_versions.artifact_file_id = artifact_files.id`
    )
    .get(versionId ?? null, artifactFileId);

  for (const value of [row?.after_blob_path, row?.source_path, row?.before_blob_path]) {
    if (typeof value === "string" && value && existsSync(value)) {
      return value;
    }
  }
  return null;
}

function readArtifacts(database: NodeDatabaseSync, sessionId: string): ArtifactSummary[] {
  const artifacts = database
    .prepare(
      `SELECT id, session_id, message_id, title, kind, status, created_at, updated_at
       FROM artifacts
       WHERE session_id = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 40`
    )
    .all(sessionId);

  return artifacts.flatMap((artifact) => {
    const record = artifact as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.title !== "string") {
      return [];
    }
    return [
      {
        id: record.id,
        sessionId: optionalString(record.session_id),
        messageId: optionalString(record.message_id),
        title: record.title,
        kind: normalizeArtifactKind(record.kind),
        status: record.status === "trashed" ? "trashed" : "active",
        createdAt: stringOrNow(record.created_at),
        updatedAt: stringOrNow(record.updated_at),
        files: readArtifactFiles(database, record.id)
      }
    ];
  });
}

function readArtifactFiles(database: NodeDatabaseSync, artifactId: string): ArtifactSummary["files"] {
  return database
    .prepare(
      `SELECT artifact_files.id,
              artifact_files.artifact_id,
              artifact_files.logical_path,
              artifact_files.display_name,
              artifact_files.file_kind,
              artifact_files.mime,
              artifact_files.current_version_id,
              artifact_files.created_at,
              artifact_versions.version_label,
              artifact_versions.operation,
              artifact_versions.source_path,
              artifact_versions.size,
              after_blob.path AS after_blob_path,
              before_blob.path AS before_blob_path
       FROM artifact_files
       LEFT JOIN artifact_versions ON artifact_versions.id = artifact_files.current_version_id
       LEFT JOIN blobs AS after_blob ON after_blob.id = artifact_versions.after_blob_id
       LEFT JOIN blobs AS before_blob ON before_blob.id = artifact_versions.before_blob_id
       WHERE artifact_files.artifact_id = ?
       ORDER BY artifact_files.created_at ASC, artifact_files.display_name ASC`
    )
    .all(artifactId)
    .flatMap((file) => {
      const record = file as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.display_name !== "string") {
        return [];
      }
      const mime = optionalString(record.mime) ?? "application/octet-stream";
      const sourcePath = optionalString(record.source_path);
      const previewPath =
        optionalString(record.after_blob_path) ??
        sourcePath ??
        optionalString(record.before_blob_path);
      const size = typeof record.size === "number" ? record.size : Number(record.size ?? 0);
      return [
        {
          id: record.id,
          artifactId,
          logicalPath: optionalString(record.logical_path) ?? record.display_name,
          displayName: record.display_name,
          fileKind: optionalString(record.file_kind) ?? "unknown",
          mime,
          currentVersionId: optionalString(record.current_version_id),
          currentVersionLabel: optionalString(record.version_label),
          operation: normalizeArtifactOperation(record.operation),
          sourcePath,
          size,
          createdAt: stringOrNow(record.created_at),
          versions: readArtifactFileVersions(database, record.id),
          preview: readArtifactFilePreview({
            path: previewPath,
            mime,
            displayName: record.display_name,
            size
          })
        }
      ];
    });
}

function readArtifactFileVersions(database: NodeDatabaseSync, artifactFileId: string): ArtifactSummary["files"][number]["versions"] {
  return database
    .prepare(
      `SELECT artifact_versions.id,
              artifact_versions.version_label,
              artifact_versions.operation,
              artifact_versions.source_path,
              artifact_versions.size,
              artifact_versions.before_blob_id,
              artifact_versions.after_blob_id,
              artifact_versions.diff_blob_id,
              artifact_versions.created_at
       FROM artifact_versions
       WHERE artifact_file_id = ?
       ORDER BY created_at DESC, version_label DESC`
    )
    .all(artifactFileId)
    .flatMap((version) => {
      const record = version as Record<string, unknown>;
      if (typeof record.id !== "string") {
        return [];
      }
      return [
        {
          id: record.id,
          label: optionalString(record.version_label),
          operation: normalizeArtifactOperation(record.operation),
          sourcePath: optionalString(record.source_path),
          size: typeof record.size === "number" ? record.size : Number(record.size ?? 0),
          createdAt: stringOrNow(record.created_at),
          hasBefore: typeof record.before_blob_id === "string" && record.before_blob_id.length > 0,
          hasAfter: typeof record.after_blob_id === "string" && record.after_blob_id.length > 0,
          hasDiff: typeof record.diff_blob_id === "string" && record.diff_blob_id.length > 0
        }
      ];
    });
}

function readActivities(database: NodeDatabaseSync, sessionId: string): ActivityLogEntry[] {
  return database
    .prepare(
      `SELECT id, session_id, level, category, summary, detail_json, created_at
       FROM activity_log
       WHERE session_id = ? OR session_id IS NULL
       ORDER BY created_at DESC
       LIMIT 80`
    )
    .all(sessionId)
    .flatMap((activity) => {
      const record = activity as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.summary !== "string") {
        return [];
      }
      return [
        {
          id: record.id,
          sessionId: optionalString(record.session_id),
          level: normalizeActivityLevel(record.level),
          category: optionalString(record.category) ?? "general",
          summary: record.summary,
          detail: parseJsonField(record.detail_json),
          createdAt: stringOrNow(record.created_at)
        }
      ];
    });
}

function readProviderSnapshots(database: NodeDatabaseSync, sessionId: string): ProviderSnapshotSummary[] {
  return database
    .prepare(
      `SELECT id, session_id, message_id, provider, title, summary, data_json, captured_at
       FROM provider_snapshots
       WHERE session_id = ? OR session_id IS NULL
       ORDER BY captured_at DESC
       LIMIT 40`
    )
    .all(sessionId)
    .flatMap((snapshot) => {
      const record = snapshot as Record<string, unknown>;
      if (typeof record.id !== "string") {
        return [];
      }
      return [
        {
          id: record.id,
          sessionId: optionalString(record.session_id),
          messageId: optionalString(record.message_id),
          provider: normalizeProviderSnapshotProvider(record.provider),
          title: optionalString(record.title) ?? "Provider snapshot",
          summary: optionalString(record.summary) ?? "",
          data: parseJsonField(record.data_json),
          capturedAt: stringOrNow(record.captured_at)
        }
      ];
    });
}

function recordActivity(
  database: NodeDatabaseSync,
  input: {
    id: string;
    sessionId?: string | null;
    level?: "debug" | "info" | "warn" | "error";
    category: string;
    summary: string;
    detail?: unknown;
    createdAt?: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO activity_log (id, session_id, level, category, summary, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.sessionId ?? null,
      input.level ?? "info",
      input.category,
      input.summary,
      JSON.stringify(input.detail ?? {}),
      input.createdAt ?? new Date().toISOString()
    );
}

function writeBlob(paths: StoragePaths, bytes: Buffer, mime: string, displayName: string): {
  id: string;
  path: string;
  size: number;
  mime: string;
  hash: string;
} {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const extension = sanitizeBlobExtension(extname(displayName));
  const dir = join(paths.blobDir, hash.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${hash}${extension}`);
  if (!existsSync(path)) {
    writeFileSync(path, bytes);
  }
  return {
    id: `blob:${hash}`,
    path,
    size: bytes.byteLength,
    mime,
    hash
  };
}

function insertBlob(
  database: NodeDatabaseSync,
  blob: { id: string; path: string; size: number; mime: string }
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO blobs (id, path, size, mime, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(blob.id, blob.path, blob.size, blob.mime, new Date().toISOString());
}

function readFileSnapshot(paths: StoragePaths, sourcePath: string): {
  blob: ReturnType<typeof writeBlob> | null;
  mime: string;
  fileKind: string;
} {
  if (!existsSync(sourcePath)) {
    return {
      blob: null,
      mime: "application/octet-stream",
      fileKind: "missing"
    };
  }
  const stats = statSync(sourcePath);
  if (!stats.isFile()) {
    return {
      blob: null,
      mime: "application/octet-stream",
      fileKind: "directory"
    };
  }
  const bytes = readFileSync(sourcePath);
  const mime = inferMime(sourcePath, bytes);
  const fileKind = mime.startsWith("text/") || mime === "application/json" ? "text" : "binary";
  return {
    blob: writeBlob(paths, bytes, mime, basename(sourcePath)),
    mime,
    fileKind
  };
}

function persistDiffForVersion(database: NodeDatabaseSync, paths: StoragePaths, versionId: string): void {
  const row = database
    .prepare(
      `SELECT before_blob.path AS before_path, after_blob.path AS after_path
       FROM artifact_versions
       LEFT JOIN blobs AS before_blob ON before_blob.id = artifact_versions.before_blob_id
       LEFT JOIN blobs AS after_blob ON after_blob.id = artifact_versions.after_blob_id
       WHERE artifact_versions.id = ?`
    )
    .get(versionId);
  if (typeof row?.before_path !== "string" || typeof row?.after_path !== "string") {
    return;
  }
  const beforeText = readUtf8IfText(row.before_path);
  const afterText = readUtf8IfText(row.after_path);
  if (beforeText === null || afterText === null || beforeText === afterText) {
    return;
  }
  const diff = renderSimpleDiff(beforeText, afterText);
  const blob = writeBlob(paths, Buffer.from(diff, "utf8"), "text/x-diff", `${versionId}.diff`);
  insertBlob(database, blob);
  database.prepare("UPDATE artifact_versions SET diff_blob_id = ? WHERE id = ?").run(blob.id, versionId);
}

function readUtf8IfText(path: string): string | null {
  try {
    const bytes = readFileSync(path);
    if (bytes.includes(0)) {
      return null;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function readArtifactFilePreview(input: {
  path?: string;
  mime: string;
  displayName: string;
  size?: number;
}): ArtifactFilePreview | undefined {
  if (!input.path || !existsSync(input.path)) {
    return undefined;
  }
  if (input.mime.startsWith("image/")) {
    return readImageArtifactPreview(input.path, input.mime, input.size);
  }
  if (!isPreviewTextFile(input.mime, input.displayName)) {
    return undefined;
  }
  return readTextArtifactPreview(input.path, input.mime);
}

function readTextArtifactPreview(path: string, mime: string): ArtifactFilePreview | undefined {
  try {
    const bytes = readFileSync(path);
    const truncated = bytes.byteLength > MAX_ARTIFACT_TEXT_PREVIEW_BYTES;
    const previewBytes = truncated ? bytes.subarray(0, MAX_ARTIFACT_TEXT_PREVIEW_BYTES) : bytes;
    if (previewBytes.includes(0)) {
      return undefined;
    }
    return {
      kind: "text",
      mime,
      data: new TextDecoder("utf-8", { fatal: true }).decode(previewBytes),
      truncated,
      size: bytes.byteLength
    };
  } catch {
    return undefined;
  }
}

function readImageArtifactPreview(path: string, mime: string, knownSize?: number): ArtifactFilePreview | undefined {
  try {
    const size = knownSize && knownSize > 0 ? knownSize : statSync(path).size;
    if (size > MAX_ARTIFACT_IMAGE_PREVIEW_BYTES) {
      return undefined;
    }
    const bytes = readFileSync(path);
    return {
      kind: "image",
      mime,
      data: `data:${mime};base64,${bytes.toString("base64")}`,
      size: bytes.byteLength
    };
  } catch {
    return undefined;
  }
}

function isPreviewTextFile(mime: string, displayName: string): boolean {
  const normalizedMime = mime.toLowerCase();
  const extension = extname(displayName).toLowerCase();
  return (
    normalizedMime.startsWith("text/") ||
    [
      "application/json",
      "application/javascript",
      "application/typescript",
      "application/xml",
      "application/yaml",
      "text/x-python",
      "text/x-shellscript",
      "text/x-powershell"
    ].includes(normalizedMime) ||
    [
      ".md",
      ".txt",
      ".json",
      ".jsonl",
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".py",
      ".ps1",
      ".sh",
      ".css",
      ".html",
      ".xml",
      ".yml",
      ".yaml",
      ".csv",
      ".log",
      ".diff",
      ".patch",
      ".toml",
      ".rs"
    ].includes(extension)
  );
}

function renderSimpleDiff(beforeText: string, afterText: string): string {
  const beforeLines = beforeText.split(/\r?\n/);
  const afterLines = afterText.split(/\r?\n/);
  const output = ["--- before", "+++ after"];
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxLines; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      continue;
    }
    if (beforeLine !== undefined) {
      output.push(`-${beforeLine}`);
    }
    if (afterLine !== undefined) {
      output.push(`+${afterLine}`);
    }
    if (output.length > 500) {
      output.push("... diff truncated ...");
      break;
    }
  }
  return `${output.join("\n")}\n`;
}

function resolveWorkspacePath(workspaceRoot: string, filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return null;
  }
  const resolvedRoot = resolve(workspaceRoot);
  const resolvedPath = resolve(resolvedRoot, trimmed);
  const relativePath = relative(resolvedRoot, resolvedPath);
  if (relativePath.startsWith("..") || relativePath === "" || /^[A-Za-z]:/.test(relativePath)) {
    return null;
  }
  return resolvedPath;
}

function safeRelativePath(workspaceRoot: string, sourcePath: string): string {
  const relativePath = relative(resolve(workspaceRoot), resolve(sourcePath)).replace(/\\/g, "/");
  return relativePath && !relativePath.startsWith("..") ? relativePath : basename(sourcePath);
}

function stableId(prefix: string, ...parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
  return `${prefix}:${hash}`;
}

function runtimeThreadRowId(sessionId: string, provider: RuntimeThreadProvider): string {
  return stableId("runtime-thread", sessionId, provider);
}

function artifactKindFromOperation(operation: "create" | "modify" | "delete"): ArtifactKind {
  if (operation === "create") {
    return "generated";
  }
  if (operation === "delete") {
    return "deleted";
  }
  return "modified";
}

function normalizeArtifactKind(value: unknown): ArtifactKind {
  return value === "modified" || value === "deleted" || value === "external" ? value : "generated";
}

function normalizeArtifactOperation(value: unknown): "create" | "modify" | "delete" | undefined {
  return value === "create" || value === "modify" || value === "delete" ? value : undefined;
}

function normalizeActivityLevel(value: unknown): ActivityLogEntry["level"] {
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

function normalizeVisionStreamMode(value: unknown): VisionStreamMode {
  return value === "agent_stream" ? "agent_stream" : "recording";
}

function normalizeVisionStreamStatus(value: unknown): VisionStreamStatus {
  return value === "pending" || value === "recording" || value === "streaming" || value === "error" ? value : "stopped";
}

function normalizeRuntimeThreadState(value: unknown): RuntimeThreadState {
  return value === "starting" || value === "connected" || value === "active" || value === "error" ? value : "closed";
}

function normalizeRuntimeThreadProvider(value: unknown): RuntimeThreadProvider {
  if (value === "codex-exec" || value === "oauth-proxy" || value === "mock") {
    return value;
  }
  return "codex-app-server";
}

function normalizeProviderSnapshotProvider(value: unknown): ProviderSnapshotProvider {
  if (value === "vision" || value === "terminal") {
    return value;
  }
  return "dom";
}

function readRuntimeThreadRow(value: unknown): RuntimeThreadSummary | null {
  const row = readRecord(value);
  if (typeof row?.id !== "string" || typeof row.session_id !== "string") {
    return null;
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    provider: normalizeRuntimeThreadProvider(row.provider),
    threadId: optionalString(row.thread_id),
    turnId: optionalString(row.turn_id),
    state: normalizeRuntimeThreadState(row.state),
    startedAt: optionalString(row.started_at),
    closedAt: optionalString(row.closed_at),
    lastError: optionalString(row.last_error)
  };
}

function sanitizeProviderSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function stringifyBoundedJson(value: unknown, maxBytes: number): string {
  const json = JSON.stringify(value ?? {});
  if (Buffer.byteLength(json, "utf8") <= maxBytes) {
    return json;
  }
  return JSON.stringify({
    truncated: true,
    originalBytes: Buffer.byteLength(json, "utf8")
  });
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeRecordingMime(value: unknown): string {
  const mime = typeof value === "string" ? value.trim().toLowerCase() : "";
  return mime.startsWith("video/webm") ? mime : "video/webm";
}

function readDataUrlBytes(value: string): Buffer {
  const commaIndex = value.indexOf(",");
  const payload = commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
  if (!payload.trim()) {
    throw new Error("Recording data is empty.");
  }
  return Buffer.from(payload, "base64");
}

function inferMime(path: string, bytes: Buffer): string {
  const extension = extname(path).toLowerCase();
  if ([".txt", ".md", ".log", ".diff", ".patch", ".csv"].includes(extension)) {
    return extension === ".md" ? "text/markdown" : extension === ".csv" ? "text/csv" : "text/plain";
  }
  if ([".json", ".jsonl"].includes(extension)) {
    return "application/json";
  }
  if ([".js", ".jsx", ".ts", ".tsx", ".css", ".html", ".xml", ".svg", ".rs", ".py", ".ps1", ".sh", ".toml", ".yaml", ".yml"].includes(extension)) {
    return "text/plain";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webm") {
    return "video/webm";
  }
  return bytes.includes(0) ? "application/octet-stream" : "text/plain";
}

function sanitizeBlobExtension(extension: string): string {
  return /^[.][A-Za-z0-9]{1,12}$/.test(extension) ? extension.toLowerCase() : ".bin";
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "artifact";
}

function loadDatabaseSync(): new (path: string) => NodeDatabaseSync {
  const require = createNodeRequire(import.meta.url);
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = warning instanceof Error ? warning.message : String(warning);
    const warningType = readWarningType(args[0]);
    if (warningType === "ExperimentalWarning" && message.includes("SQLite is an experimental feature")) {
      return;
    }
    return (originalEmitWarning as (warning: string | Error, ...args: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;

  try {
    return (require("node:sqlite") as { DatabaseSync: new (path: string) => NodeDatabaseSync }).DatabaseSync;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function readWarningType(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "type" in value) {
    const type = (value as { type?: unknown }).type;
    return typeof type === "string" ? type : "";
  }
  return "";
}
