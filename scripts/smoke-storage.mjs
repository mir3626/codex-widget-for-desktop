import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createStorageService } from "../dist/daemon/storage/storage.js";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-storage-"));

try {
  const storage = createStorageService({ appDataDir: tempRoot });
  const health = storage.health();

  assertEqual(health.state, "ready", "storage state");
  assertEqual(health.schemaVersion, health.latestSchemaVersion, "schema version");
  assertEqual(health.integrity, "ok", "integrity");
  assertEqual(health.foreignKeys, true, "foreign keys");
  assert(health.tableCount >= 20, `expected core tables, saw ${health.tableCount}`);
  assert(existsSync(health.databasePath), `database file missing: ${health.databasePath}`);
  assert(existsSync(health.blobDir), `blob dir missing: ${health.blobDir}`);

  storage.setAppSetting("ui.opacity", { value: 0.72 });
  assertEqual(storage.getAppSetting("ui.opacity")?.value, 0.72, "persisted setting");

  const initialSnapshot = storage.ensureSessionSnapshot({ model: "gpt-5.5", reasoningEffort: "medium", mode: "agent" });
  assert(initialSnapshot.activeSessionId, "active session should be created");
  assertEqual(initialSnapshot.sessions.length, 1, "initial session count");

  const prepared = storage.prepareAsk({
    requestId: "smoke-turn-1",
    sessionId: initialSnapshot.activeSessionId,
    text: "smoke durable prompt",
    mode: "agent",
    model: "gpt-5.5",
    reasoningEffort: "medium"
  });
  assertEqual(prepared.snapshot.messages.length, 2, "prepared ask message count");
  storage.appendAssistantDelta({
    sessionId: prepared.sessionId,
    messageId: "smoke-turn-1",
    text: "partial ",
    status: "streaming"
  });
  storage.updateAssistantMessage({
    sessionId: prepared.sessionId,
    messageId: "smoke-turn-1",
    text: "partial answer",
    status: "done"
  });
  const completed = storage.openSession(prepared.sessionId);
  assert(
    completed.messages.some((message) => message.role === "assistant" && message.status === "done" && message.text === "partial answer"),
    "completed assistant message should be durable"
  );

  const runtimeThread = storage.writeRuntimeThread({
    sessionId: prepared.sessionId,
    provider: "codex-app-server",
    threadId: "thread-storage-smoke-1",
    state: "connected"
  });
  assertEqual(runtimeThread.threadId, "thread-storage-smoke-1", "runtime thread id");
  assertEqual(runtimeThread.state, "connected", "runtime thread state");
  const readRuntimeThread = storage.readRuntimeThread(prepared.sessionId, "codex-app-server");
  assertEqual(readRuntimeThread?.threadId, "thread-storage-smoke-1", "read runtime thread id");
  storage.clearRuntimeThread(prepared.sessionId, "codex-app-server");
  const clearedRuntimeThread = storage.readRuntimeThread(prepared.sessionId, "codex-app-server");
  assertEqual(clearedRuntimeThread?.state, "closed", "cleared runtime thread state");
  assertEqual(clearedRuntimeThread?.threadId, undefined, "cleared runtime thread id");

  const branch = storage.branchSession({
    parentSessionId: prepared.sessionId,
    sourceMessageId: "smoke-turn-1",
    title: "smoke branch",
    messages: [
      { role: "user", text: "smoke durable prompt" },
      { role: "assistant", text: "partial answer" }
    ],
    model: "gpt-5.5",
    reasoningEffort: "medium",
    mode: "agent"
  });
  assertEqual(branch.messages.length, 2, "branch context message count");
  assert(branch.sessions.length >= 2, "branch should add a session");

  const trashed = storage.trashSession(branch.activeSessionId);
  assert(trashed.trashedSessions.some((session) => session.title === "smoke branch"), "trashed branch should appear in trash");
  const restored = storage.restoreSession(branch.activeSessionId);
  assertEqual(restored.activeSessionId, branch.activeSessionId, "restored active session");

  storage.recordProviderSnapshot({
    sessionId: restored.activeSessionId,
    provider: "dom",
    title: "Smoke DOM snapshot",
    summary: "example.test · 12 selected chars",
    data: {
      url: "https://example.test/",
      selectionLength: 12,
      textLength: 48
    }
  });

  storage.recordTextArtifact({
    sessionId: restored.activeSessionId,
    messageId: "smoke-turn-1",
    title: "Smoke tool output",
    text: "tool output artifact",
    logicalPath: "tool-output.txt",
    displayName: "tool-output.txt"
  });
  const workspace = join(tempRoot, "workspace");
  mkdirSync(workspace, { recursive: true });
  const changedFile = join(workspace, "generated.txt");
  writeFileSync(changedFile, "before\n", "utf8");
  storage.recordFileChangeArtifact({
    sessionId: restored.activeSessionId,
    messageId: "smoke-turn-1",
    changeId: "change-smoke-1",
    phase: "before",
    title: "generated.txt change",
    operation: "modify",
    paths: ["generated.txt"],
    workspaceRoot: workspace
  });
  writeFileSync(changedFile, "after\n", "utf8");
  storage.recordFileChangeArtifact({
    sessionId: restored.activeSessionId,
    messageId: "smoke-turn-1",
    changeId: "change-smoke-1",
    phase: "after",
    title: "generated.txt change",
    operation: "modify",
    paths: ["generated.txt"],
    workspaceRoot: workspace
  });
  const ledger = storage.readLedgerSnapshot(restored.activeSessionId);
  assert(ledger.providerSnapshots.some((snapshot) => snapshot.provider === "dom" && snapshot.title === "Smoke DOM snapshot"), "ledger should include provider snapshot history");
  assert(ledger.artifacts.length >= 2, "ledger should include text and file-change artifacts");
  const fileArtifact = ledger.artifacts.find((artifact) => artifact.title === "generated.txt change");
  const fileEntry = fileArtifact?.files[0];
  assert(fileEntry?.id, "file-change artifact should include a file entry");
  assert(fileEntry.preview?.kind === "text", "file-change artifact should expose a text preview");
  assert(fileEntry.preview.data.includes("after"), "file-change preview should prefer after snapshot content");
  assert(fileEntry.versions?.length >= 1, "file-change artifact should include version metadata");
  const currentVersion = fileEntry.versions.find((version) => version.id === fileEntry.currentVersionId);
  assert(currentVersion?.hasBefore && currentVersion.hasAfter && currentVersion.hasDiff, "modify artifact should expose before/after/diff availability");
  const openPath = storage.resolveArtifactOpenPath(fileEntry.id);
  assert(openPath && existsSync(openPath), "artifact open path should resolve");
  assert(readFileSync(openPath, "utf8").includes("after"), "artifact open path should prefer after snapshot");
  const versionOpenPath = storage.resolveArtifactOpenPath(fileEntry.id, currentVersion.id);
  assertEqual(versionOpenPath, openPath, "artifact version open path");

  const recording = storage.createVisionStream({
    id: "vision-recording-smoke-1",
    sessionId: restored.activeSessionId,
    mode: "recording",
    fps: 4,
    frameIntervalMs: 250,
    maxDurationMs: 120000
  });
  assertEqual(recording.status, "recording", "vision recording status");
  const recordingDataUrl = `data:video/webm;base64,${Buffer.from("webm-smoke").toString("base64")}`;
  const completedRecording = storage.completeVisionRecording({
    id: recording.id,
    mime: "video/webm",
    dataUrl: recordingDataUrl,
    durationMs: 1234,
    size: 9
  });
  assertEqual(completedRecording.status, "stopped", "completed recording status");
  assert(completedRecording.recordingBlobId, "completed recording should reference a blob");

  const stream = storage.createVisionStream({
    id: "vision-stream-smoke-1",
    sessionId: restored.activeSessionId,
    mode: "agent_stream",
    fps: 1,
    frameIntervalMs: 1000
  });
  assertEqual(stream.status, "streaming", "agent stream status");
  const stoppedStream = storage.stopVisionStream({ id: stream.id, reason: "smoke complete" });
  assertEqual(stoppedStream.status, "stopped", "stopped stream status");

  let secretRejected = false;
  try {
    storage.setAppSetting("oauth_access_token", "do-not-store");
  } catch {
    secretRejected = true;
  }
  assert(secretRejected, "secret-like setting key should be rejected");

  storage.recordActivity({
    id: "activity-smoke-1",
    category: "storage",
    summary: "storage smoke activity"
  });
  storage.close();

  const reopened = createStorageService({ appDataDir: tempRoot });
  const reopenedHealth = reopened.health();
  assertEqual(reopenedHealth.schemaVersion, health.schemaVersion, "reopened schema version");
  assertEqual(reopened.getAppSetting("ui.opacity")?.value, 0.72, "reopened setting");
  reopened.close();

  console.log(`storage smoke ok: schema ${health.schemaVersion}, tables ${health.tableCount}`);
} finally {
  cleanupTempDir(tempRoot);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function cleanupTempDir(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    return;
  } catch {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "setTimeout(() => { require('node:fs').rmSync(process.argv[1], { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }, 500);",
        path
      ],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
  }
}
