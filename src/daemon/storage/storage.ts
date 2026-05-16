import { existsSync, mkdirSync, unlinkSync } from "node:fs";
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
  insertBlob,
  readBlob,
  writeBlob
} from "./blobs.js";
import {
  completeVisionRecording,
  createVisionStream,
  stopVisionStream
} from "./visionStreams.js";
import {
  appendCapabilityJobEvent,
  acquireCapabilityLock,
  createCapabilityJob,
  createCapabilityResource,
  listCapabilityJobs,
  listCapabilityLocks,
  listCapabilityResources,
  markActiveCapabilityJobsForShutdown,
  readCapabilityJob,
  reconcileCapabilityJobsOnStartup,
  releaseCapabilityLock,
  updateCapabilityJob
} from "./capabilityJobs.js";
import {
  appendComputerUseEvalStep,
  createCapabilityDagRun,
  createComputerUseEvalResource,
  createComputerUseEvalRun,
  listCapabilityDagNodes,
  listComputerUseEvalResources,
  listComputerUseEvalRuns,
  listComputerUseEvalSteps,
  listPerceptionGraphs,
  listStructuredFailureMemory,
  readCapabilityDagNode,
  readCapabilityDagRun,
  readComputerUseEvalRun,
  readPerceptionGraph,
  recordPerceptionGraph,
  recordStructuredFailureMemory,
  updateCapabilityDagRun,
  updateComputerUseEvalRun,
  upsertCapabilityDagNode
} from "./researchArchitecture.js";
import {
  listComputerUseSessionSnapshots,
  readComputerUseSessionSnapshot,
  upsertComputerUseSessionSnapshot
} from "./computerUseSessions.js";
import {
  createAutonomyPermissionProfile,
  createAutonomyRun,
  createAutonomyToolRun,
  listAutonomyCapabilityInventory,
  listAutonomyCapabilityGaps,
  listAutonomyPermissionProfiles,
  listAutonomyRuns,
  listAutonomyToolRuns,
  listAutonomyToolSpecs,
  readAutonomyPermissionProfile,
  readAutonomyCapabilityInventoryItem,
  readAutonomyRun,
  readAutonomyToolRun,
  readAutonomyToolSpec,
  recordAutonomyCapabilityGap,
  updateAutonomyPermissionProfile,
  updateAutonomyRun,
  updateAutonomyToolRun,
  upsertAutonomyCapabilityInventory,
  upsertAutonomyToolSpec
} from "./scopedAutonomy.js";
import type {
  LedgerSnapshot,
  StorageService,
  StorageServiceOptions,
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
    writeBlob: (input) => {
      const blob = writeBlob(paths, input.bytes, input.mime, input.displayName);
      insertBlob(database, blob);
      return blob;
    },
    readBlob: (id) => readBlob(database, id),
    createCapabilityJob: (input) => createCapabilityJob(database, input),
    readCapabilityJob: (id) => readCapabilityJob(database, id),
    listCapabilityJobs: (input = {}) => listCapabilityJobs(database, input),
    updateCapabilityJob: (input) => updateCapabilityJob(database, input),
    appendCapabilityJobEvent: (input) => appendCapabilityJobEvent(database, input),
    createCapabilityResource: (input) => createCapabilityResource(database, input),
    listCapabilityResources: (jobId) => listCapabilityResources(database, jobId),
    acquireCapabilityLock: (input) => acquireCapabilityLock(database, input),
    releaseCapabilityLock: (input) => releaseCapabilityLock(database, input),
    listCapabilityLocks: (input = {}) => listCapabilityLocks(database, input),
    cleanupEphemeralCapabilityResources: (input = {}) => cleanupEphemeralCapabilityResources(database, input.completedBefore),
    reconcileCapabilityJobsOnStartup: () => reconcileCapabilityJobsOnStartup(database),
    markActiveCapabilityJobsForShutdown: () => markActiveCapabilityJobsForShutdown(database),
    createComputerUseEvalRun: (input) => createComputerUseEvalRun(database, input),
    readComputerUseEvalRun: (id) => readComputerUseEvalRun(database, id),
    listComputerUseEvalRuns: (input = {}) => listComputerUseEvalRuns(database, input),
    updateComputerUseEvalRun: (input) => updateComputerUseEvalRun(database, input),
    appendComputerUseEvalStep: (input) => appendComputerUseEvalStep(database, input),
    listComputerUseEvalSteps: (runId) => listComputerUseEvalSteps(database, runId),
    createComputerUseEvalResource: (input) => createComputerUseEvalResource(database, input),
    listComputerUseEvalResources: (runId) => listComputerUseEvalResources(database, runId),
    recordPerceptionGraph: (input) => recordPerceptionGraph(database, input),
    readPerceptionGraph: (id) => readPerceptionGraph(database, id),
    listPerceptionGraphs: (input = {}) => listPerceptionGraphs(database, input),
    recordStructuredFailureMemory: (input) => recordStructuredFailureMemory(database, input),
    listStructuredFailureMemory: (input = {}) => listStructuredFailureMemory(database, input),
    createCapabilityDagRun: (input) => createCapabilityDagRun(database, input),
    updateCapabilityDagRun: (input) => updateCapabilityDagRun(database, input),
    readCapabilityDagRun: (id) => readCapabilityDagRun(database, id),
    upsertCapabilityDagNode: (input) => upsertCapabilityDagNode(database, input),
    readCapabilityDagNode: (id) => readCapabilityDagNode(database, id),
    listCapabilityDagNodes: (dagRunId) => listCapabilityDagNodes(database, dagRunId),
    upsertComputerUseSessionSnapshot: (input) => upsertComputerUseSessionSnapshot(database, input),
    readComputerUseSessionSnapshot: (sessionId) => readComputerUseSessionSnapshot(database, sessionId),
    listComputerUseSessionSnapshots: (input = {}) => listComputerUseSessionSnapshots(database, input),
    createAutonomyPermissionProfile: (input) => createAutonomyPermissionProfile(database, input),
    readAutonomyPermissionProfile: (id) => readAutonomyPermissionProfile(database, id),
    listAutonomyPermissionProfiles: (input = {}) => listAutonomyPermissionProfiles(database, input),
    updateAutonomyPermissionProfile: (input) => updateAutonomyPermissionProfile(database, input),
    createAutonomyRun: (input) => createAutonomyRun(database, input),
    readAutonomyRun: (id) => readAutonomyRun(database, id),
    listAutonomyRuns: (input = {}) => listAutonomyRuns(database, input),
    updateAutonomyRun: (input) => updateAutonomyRun(database, input),
    recordAutonomyCapabilityGap: (input) => recordAutonomyCapabilityGap(database, input),
    listAutonomyCapabilityGaps: (runId) => listAutonomyCapabilityGaps(database, runId),
    upsertAutonomyToolSpec: (input) => upsertAutonomyToolSpec(database, input),
    readAutonomyToolSpec: (id) => readAutonomyToolSpec(database, id),
    listAutonomyToolSpecs: (input = {}) => listAutonomyToolSpecs(database, input),
    createAutonomyToolRun: (input) => createAutonomyToolRun(database, input),
    updateAutonomyToolRun: (input) => updateAutonomyToolRun(database, input),
    readAutonomyToolRun: (id) => readAutonomyToolRun(database, id),
    listAutonomyToolRuns: (input = {}) => listAutonomyToolRuns(database, input),
    upsertAutonomyCapabilityInventory: (input) => upsertAutonomyCapabilityInventory(database, input),
    readAutonomyCapabilityInventoryItem: (id) => readAutonomyCapabilityInventoryItem(database, id),
    listAutonomyCapabilityInventory: (input = {}) => listAutonomyCapabilityInventory(database, input),
    recordActivity: (input) => recordActivity(database, input)
  };
}

function cleanupEphemeralCapabilityResources(
  database: NodeDatabaseSync,
  completedBefore = new Date().toISOString()
): { resourcesDeleted: number; blobsDeleted: number; bytesDeleted: number } {
  const rows = database.prepare(
    `SELECT capability_resources.id, capability_resources.blob_id, blobs.path, blobs.size
     FROM capability_resources
     JOIN capability_jobs ON capability_jobs.id = capability_resources.job_id
     LEFT JOIN blobs ON blobs.id = capability_resources.blob_id
     WHERE capability_resources.retention = 'ephemeral'
       AND capability_jobs.status IN ('completed', 'failed', 'cancelled', 'expired')
       AND COALESCE(capability_jobs.completed_at, capability_jobs.cancelled_at, capability_jobs.updated_at) <= ?`
  ).all(completedBefore) as Array<{ id: string; blob_id?: string | null; path?: string | null; size?: number | null }>;
  let blobsDeleted = 0;
  let bytesDeleted = 0;
  for (const row of rows) {
    database.prepare("DELETE FROM capability_resources WHERE id = ?").run(row.id);
    if (!row.blob_id || isBlobReferenced(database, row.blob_id)) {
      continue;
    }
    database.prepare("DELETE FROM blobs WHERE id = ?").run(row.blob_id);
    if (row.path && existsSync(row.path)) {
      try {
        unlinkSync(row.path);
        blobsDeleted += 1;
        bytesDeleted += Math.max(0, Number(row.size ?? 0));
      } catch {
        // The blob row has been removed; a later filesystem cleanup can retry if Windows still holds the file.
      }
    }
  }
  return { resourcesDeleted: rows.length, blobsDeleted, bytesDeleted };
}

function isBlobReferenced(database: NodeDatabaseSync, blobId: string): boolean {
  const checks = [
    "SELECT 1 FROM capability_resources WHERE blob_id = ? LIMIT 1",
    "SELECT 1 FROM provider_snapshots WHERE blob_id = ? LIMIT 1",
    "SELECT 1 FROM vision_streams WHERE recording_blob_id = ? LIMIT 1",
    "SELECT 1 FROM terminal_events WHERE blob_id = ? LIMIT 1",
    "SELECT 1 FROM artifact_versions WHERE before_blob_id = ? OR after_blob_id = ? OR diff_blob_id = ? LIMIT 1",
    "SELECT 1 FROM mascot_presets WHERE asset_blob_id = ? LIMIT 1"
  ];
  for (const sql of checks) {
    const params = sql.includes(" OR ") ? [blobId, blobId, blobId] : [blobId];
    if (database.prepare(sql).get(...params)) {
      return true;
    }
  }
  return false;
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
