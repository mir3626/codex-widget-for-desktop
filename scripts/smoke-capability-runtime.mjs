import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { CapabilityRuntime } from "../dist/daemon/capability-runtime/index.js";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-capability-runtime-"));

try {
  const storage = createStorageService({ appDataDir: tempRoot });
  const session = storage.ensureSessionSnapshot();
  const events = [];
  const runtime = new CapabilityRuntime({
    storage,
    maxActiveJobs: 1,
    emit: (event) => events.push(event)
  });

  runtime.register("screen_observe", async ({ job, resources }) => {
    const bytes = Buffer.from(`screen:${job.id}`, "utf8");
    const resource = resources.storeBuffer({
      job,
      role: "screen_text",
      bytes,
      mime: "text/plain",
      displayName: "screen.txt",
      retention: "evidence"
    });
    return {
      output: {
        observed: true,
        resourceId: resource.resourceId,
        blobId: resource.blobId
      },
      outputBlobIds: [resource.blobId],
      summary: "mock screen observe completed"
    };
  });

  runtime.register("ocr", async ({ helpers, job, signal }) => {
    const helper = await helpers.runJson({
      command: process.execPath,
      args: ["-e", "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({ ok: true, text: 'ocr smoke' })))"],
      request: { requestId: job.id },
      timeoutMs: 5000,
      signal
    });
    return helper.ok
      ? { output: helper.output, summary: "mock OCR helper completed" }
      : { status: "failed", output: helper, error: helper.error };
  });

  runtime.register("terminal", async ({ helpers, job, signal }) => {
    const helper = await helpers.runJson({
      command: process.execPath,
      args: ["-e", "setTimeout(()=>{}, 30000)"],
      request: { requestId: job.id },
      timeoutMs: Number(job.inputJson?.timeoutMs ?? 5000),
      signal
    });
    return helper.ok
      ? { output: helper.output, summary: "unexpected terminal helper completion" }
      : { status: "cancelled", output: helper, error: helper.error ?? "cancelled" };
  });

  runtime.register("desktop_action", async () => ({
    output: { ok: true, metadata: { helper: "mock_desktop" } },
    summary: "mock desktop action completed"
  }));

  runtime.register("agent_tool", async ({ helpers, job, resources, signal }) => {
    const input = job.inputJson && typeof job.inputJson === "object" ? job.inputJson : {};
    if (input.mode === "timeout") {
      const helper = await helpers.runJson({
        command: process.execPath,
        args: ["-e", "setTimeout(()=>{}, 30000)"],
        request: { requestId: job.id },
        timeoutMs: 50,
        signal
      });
      return helper.ok
        ? { status: "failed", output: helper.output, error: "timeout helper unexpectedly completed" }
        : { status: "failed", output: helper, error: helper.error ?? "helper failed" };
    }
    resources.storeBuffer({
      job,
      role: "ephemeral_debug",
      bytes: Buffer.from(`debug:${job.id}`, "utf8"),
      mime: "text/plain",
      displayName: "debug.txt",
      retention: "ephemeral"
    });
    await delayWithAbort(Number(input.delayMs ?? 10), signal);
    return {
      output: { ok: true, mode: input.mode ?? "delay" },
      summary: "mock agent tool completed"
    };
  });

  const screen = await runtime.enqueue({
    kind: "screen_observe",
    sessionId: session.activeSessionId,
    priority: "interactive",
    requestedBy: "direct_ui",
    input: { purpose: "smoke" },
    timeoutMs: 5000
  });
  await waitForJob(storage, screen.id, "completed");
  const completedScreen = mustJob(storage, screen.id);
  assertEqual(completedScreen.status, "completed", "screen job status");
  assertEqual(completedScreen.outputJson?.capabilityVerification?.status, "passed", "screen verification status");
  assert(completedScreen.outputBlobIds.length === 1, "screen job should reference output blob");
  assert(storage.listCapabilityResources(screen.id).length === 1, "screen job should record resource");
  assert(storage.readLedgerSnapshot(session.activeSessionId).activities.some((activity) => activity.category === "capability" && activity.detail?.jobId === screen.id), "completed capability job should record ledger activity");

  const approval = await runtime.enqueue({
    kind: "desktop_action",
    priority: "interactive",
    requestedBy: "direct_ui",
    input: { command: "execute", action: { type: "click", target: { kind: "focused" } } },
    timeoutMs: 5000
  });
  assertEqual(approval.status, "awaiting_approval", "side-effect approval job status");
  const denied = await runtime.cancel(approval.id, "approval_denied");
  assertEqual(denied.status, "cancelled", "denied approval status");

  const unverifiedDesktop = await runtime.enqueue({
    kind: "desktop_action",
    priority: "interactive",
    requestedBy: "direct_ui",
    input: { command: "execute", action: { type: "click" }, expectedEffect: { setting: "enabled" } },
    timeoutMs: 5000
  });
  await runtime.approve(unverifiedDesktop.id);
  await waitForJob(storage, unverifiedDesktop.id, "failed");
  assertEqual(mustJob(storage, unverifiedDesktop.id).outputJson?.capabilityVerification?.failureClass, "effect_mismatch", "desktop expected effect should require explicit verification");

  const timeout = await runtime.enqueue({
    kind: "ocr",
    priority: "normal",
    requestedBy: "direct_ui",
    input: { text: "image" },
    timeoutMs: 5000
  });
  await waitForJob(storage, timeout.id, "completed");
  assertEqual(mustJob(storage, timeout.id).status, "completed", "ocr helper job status");

  const cancellable = await runtime.enqueue({
    kind: "terminal",
    priority: "interactive",
    requestedBy: "direct_ui",
    input: { timeoutMs: 30000 },
    timeoutMs: 30000
  });
  assertEqual(cancellable.status, "awaiting_approval", "terminal job should wait for approval");
  await runtime.approve(cancellable.id);
  await waitForJob(storage, cancellable.id, "running");
  await runtime.cancel(cancellable.id, "user_stop");
  await waitForJob(storage, cancellable.id, "cancelled");
  assertEqual(mustJob(storage, cancellable.id).status, "cancelled", "cancelled helper job status");

  const helperTimeout = await runtime.enqueue({
    kind: "agent_tool",
    priority: "interactive",
    requestedBy: "direct_ui",
    input: { mode: "timeout" },
    timeoutMs: 5000
  });
  await runtime.approve(helperTimeout.id);
  await waitForJob(storage, helperTimeout.id, "failed");
  assert(mustJob(storage, helperTimeout.id).lastError?.includes("timed out"), "helper timeout should fail the job");

  await assertRejects(
    () => runtime.enqueue({
      kind: "terminal",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { command: "echo token=abc123" },
      timeoutMs: 5000
    }),
    "credential-like terminal command should be rejected before persistence"
  );

  const lockedA = await runtime.enqueue({
    kind: "agent_tool",
    priority: "interactive",
    requestedBy: "direct_ui",
    leaseId: "surface:same",
    input: { mode: "delay", delayMs: 200 },
    timeoutMs: 5000
  });
  const lockedB = await runtime.enqueue({
    kind: "agent_tool",
    priority: "interactive",
    requestedBy: "direct_ui",
    leaseId: "surface:same",
    input: { mode: "delay", delayMs: 10 },
    timeoutMs: 5000
  });
  await runtime.approve(lockedA.id);
  await runtime.approve(lockedB.id);
  await waitForJob(storage, lockedA.id, "running");
  assertEqual(storage.listCapabilityLocks({ jobId: lockedA.id }).length, 1, "running locked job should persist a lock");
  await waitForJob(storage, lockedB.id, "scheduled");
  await waitForJob(storage, lockedA.id, "completed");
  await waitForJob(storage, lockedB.id, "completed");
  assertEqual(storage.listCapabilityLocks({ jobId: lockedA.id }).length, 0, "completed locked job should release its lock");
  assertEqual(storage.listCapabilityResources(lockedA.id).length, 0, "ephemeral resources should be cleaned for first locked job");
  assert(mustJob(storage, lockedA.id).outputJson?.resourceAccounting?.cleanup?.resourcesDeleted >= 1, "resource cleanup should be recorded");

  const priorityHolder = await runtime.enqueue({
    kind: "agent_tool",
    priority: "interactive",
    requestedBy: "direct_ui",
    input: { mode: "delay", delayMs: 200 },
    timeoutMs: 5000
  });
  await runtime.approve(priorityHolder.id);
  await waitForJob(storage, priorityHolder.id, "running");
  const backgroundQueued = await runtime.enqueue({
    kind: "agent_tool",
    priority: "background",
    requestedBy: "background",
    input: { mode: "delay", delayMs: 10 },
    timeoutMs: 5000
  });
  const interactiveQueued = await runtime.enqueue({
    kind: "agent_tool",
    priority: "interactive",
    requestedBy: "direct_ui",
    input: { mode: "delay", delayMs: 10 },
    timeoutMs: 5000
  });
  await runtime.approve(backgroundQueued.id);
  await runtime.approve(interactiveQueued.id);
  await waitForJob(storage, backgroundQueued.id, "scheduled");
  await waitForJob(storage, interactiveQueued.id, "scheduled");
  await waitForJob(storage, priorityHolder.id, "completed");
  await waitForJob(storage, interactiveQueued.id, "completed");
  await waitForJob(storage, backgroundQueued.id, "completed");
  const completedInteractive = mustJob(storage, interactiveQueued.id);
  const completedBackground = mustJob(storage, backgroundQueued.id);
  assert(Date.parse(completedInteractive.startedAt) <= Date.parse(completedBackground.startedAt), "interactive queued work should start before lower-priority background work");

  const staleLease = await runtime.enqueue({
    kind: "screen_observe",
    priority: "interactive",
    requestedBy: "direct_ui",
    leaseId: "surface:expired",
    input: {
      contextLease: {
        leaseId: "surface:expired",
        expiresAt: new Date(Date.now() - 1000).toISOString()
      }
    },
    timeoutMs: 5000
  });
  await waitForJob(storage, staleLease.id, "expired");
  assertEqual(mustJob(storage, staleLease.id).lastError, "context_lease_expired", "expired context lease should block execution");

  const expiredApproval = storage.createCapabilityJob({
    kind: "terminal",
    status: "awaiting_approval",
    requestedBy: "direct_ui",
    timeoutMs: 5000,
    deadlineAt: new Date(Date.now() - 1000).toISOString(),
    approvalId: "approval:expired"
  });
  const approvalAfterDeadline = await runtime.approve(expiredApproval.id);
  assertEqual(approvalAfterDeadline.status, "expired", "approval after deadline should expire");

  const resumable = storage.createCapabilityJob({
    kind: "screen_observe",
    status: "queued",
    requestedBy: "background",
    timeoutMs: 5000,
    inputJson: { purpose: "startup-resume" }
  });
  runtime.reconcileStartup();
  await waitForJob(storage, resumable.id, "completed");
  assert(events.some((event) => event.type === "job" && event.job.id === resumable.id && event.summary.includes("resumed")), "startup recovery should emit resume event");

  const interrupted = storage.createCapabilityJob({
    kind: "desktop_action",
    status: "running",
    requestedBy: "direct_ui",
    timeoutMs: 5000,
    inputJson: { action: "click" }
  });
  const reconciled = runtime.reconcileStartup();
  assert(reconciled.some((job) => job.id === interrupted.id && job.status === "failed"), "running job should fail closed on startup reconciliation");

  const active = storage.createCapabilityJob({
    kind: "screen_observe",
    status: "queued",
    requestedBy: "background",
    timeoutMs: 5000,
    inputJson: { purpose: "shutdown" }
  });
  const shutdown = runtime.markShutdown();
  assert(shutdown.some((job) => job.id === active.id && job.status === "cancelled"), "queued job should cancel on shutdown");

  assert(events.some((event) => event.type === "job" && event.job.status === "completed"), "runtime should emit completed job event");
  assert(events.some((event) => event.type === "job" && event.job.status === "cancelled"), "runtime should emit cancelled job event");
  assert(storage.health().schemaVersion >= 3, "storage schema should include capability migration");

  storage.close();
  console.log("capability runtime smoke ok");
} finally {
  cleanupTempDir(tempRoot);
}

async function waitForJob(storage, jobId, status, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = mustJob(storage, jobId);
    if (job.status === status) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for job ${jobId} to become ${status}. Current=${mustJob(storage, jobId).status}`);
}

function mustJob(storage, jobId) {
  const job = storage.readCapabilityJob(jobId);
  if (!job) {
    throw new Error(`Missing capability job: ${jobId}`);
  }
  return job;
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

async function assertRejects(fn, message) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}

function delayWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("delay cancelled"));
    }, { once: true });
  });
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
