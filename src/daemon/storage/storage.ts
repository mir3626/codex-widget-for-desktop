import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import { resolveStoragePaths } from "./paths.js";
import {
  configureDatabase,
  createDatabaseSyncConstructor,
  migrate,
  readStorageHealth
} from "./database.js";
import {
  assertPersistableSettingKey,
  readAppSetting,
  readBrowserActionPolicies,
  readExecutionPermissionDecision,
  readExecutionPermissions,
  revokeBrowserActionPolicy,
  setBrowserActionPolicy,
  setExecutionPermission,
  writeAppSetting
} from "./settings.js";
import {
  clearRuntimeThread,
  readRuntimeThread,
  writeRuntimeThread
} from "./runtimeThreads.js";
import {
  appendAssistantDelta,
  branchSession,
  createSession,
  deleteSession,
  discardSession,
  ensureSessionSnapshot,
  isKnownSession,
  openSession,
  prepareAsk,
  restoreSession,
  trashSession,
  updateAssistantMessage
} from "./sessions.js";
import {
  readActivities,
  readArtifacts,
  readProviderSnapshots,
  recordActivity,
  recordFileChangeArtifact,
  recordProviderSnapshot,
  recordTextArtifact,
  resolveArtifactOpenPath
} from "./artifacts.js";
import {
  completeVisionRecording,
  createVisionStream,
  stopVisionStream
} from "./visionStreams.js";
import type {
  AskPersistenceInput,
  AssistantDeltaInput,
  AssistantUpdateInput,
  BranchSessionInput,
  BrowserActionPolicy,
  CompleteVisionRecordingInput,
  ExecutionPermissionDecision,
  ExecutionPermissionSummary,
  FileChangeArtifactInput,
  LedgerSnapshot,
  ProviderSnapshotInput,
  RuntimeThreadInput,
  RuntimeThreadProvider,
  RuntimeThreadState,
  RuntimeThreadSummary,
  SessionDefaults,
  SessionSnapshot,
  StopVisionStreamInput,
  StorageHealth,
  StorageService,
  StorageServiceOptions,
  TextArtifactInput,
  VisionStreamInput,
} from "./types.js";

export type {
  AskPersistenceInput,
  AssistantDeltaInput,
  AssistantUpdateInput,
  BranchSessionInput,
  CompleteVisionRecordingInput,
  FileChangeArtifactInput,
  ProviderSnapshotInput,
  RuntimeThreadInput,
  RuntimeThreadProvider,
  RuntimeThreadState,
  RuntimeThreadSummary,
  SessionDefaults,
  StorageHealth,
  StorageService,
  StorageServiceOptions,
  StopVisionStreamInput,
  TextArtifactInput,
  VisionStreamInput
} from "./types.js";

export { assertPersistableSettingKey } from "./settings.js";

const DatabaseSync = createDatabaseSyncConstructor();

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
    readBrowserActionPolicies: () => readBrowserActionPolicies(database),
    setBrowserActionPolicy: (policy) => setBrowserActionPolicy(database, policy),
    revokeBrowserActionPolicy: (policyId) => revokeBrowserActionPolicy(database, policyId),
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
