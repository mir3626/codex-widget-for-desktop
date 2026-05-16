#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-terminal-parity-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const outputRoot = join(smokeAppData.dir, "terminal-output");
mkdirSync(outputRoot, { recursive: true });
const artifactPath = join(outputRoot, "terminal-artifact.txt");
const modifiedPath = join(outputRoot, "terminal-diff.txt");
const deletedPath = join(outputRoot, "terminal-delete.txt");
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
const waiters = [];

try {
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    events.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(event)) {
        clearTimeout(waiter.timeout);
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }
  });

  const started = await postJson("/computer-use/sessions", {
    userRequest: "로컬 터미널에서 안전한 상태 확인 명령을 실행해줘",
    requestedSurface: "pty_workspace",
    profileId: "profile:terminal-parity-smoke",
    metadata: {
      requiresTerminal: true
    }
  });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.selectedSurface.kind, "pty_workspace");
  const sessionId = started.result.session.sessionId;

  const command = "echo computer-use-terminal-ok";
  const operation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    operation: {
      kind: "terminal",
      input: {
        command,
        cwd: process.cwd(),
        expectedOutcome: "stdout contains computer-use-terminal-ok"
      }
    },
    waitMs: 8000
  });
  assert.equal(operation.ok, true);
  assert.equal(operation.result.job.kind, "terminal");
  assert.equal(operation.result.job.status, "awaiting_approval");
  send({ type: "capability.approve", requestId: `approve-${operation.result.job.id}`, jobId: operation.result.job.id });
  await waitFor((event) => event.type === "capability.job" && event.jobId === operation.result.job.id && event.status === "completed", "terminal job completed");
  const completedJob = await getJson(`/capabilities/jobs/${encodeURIComponent(operation.result.job.id)}`);
  assert.equal(completedJob.job.status, "completed");
  const stdout = completedJob.job.outputJson?.stdout ?? completedJob.job.outputJson?.output?.stdout ?? "";
  assert.equal(stdout.includes("computer-use-terminal-ok"), true, JSON.stringify(completedJob.job.outputJson));

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  assertFollowupDagNodes(bundle, operation.result.dagNode.id, operation.result.job.id);
  const bundledTerminalJob = bundle.bundle.capabilityJobs.find((job) => job.id === operation.result.job.id);
  assert.equal(bundledTerminalJob?.outputJson?.stdout, undefined);
  assert.equal(bundledTerminalJob?.outputJson?.terminalOutput?.stdoutPreview.includes("computer-use-terminal-ok"), true);
  assert.equal(typeof bundledTerminalJob?.outputJson?.terminalOutput?.stdoutSha256, "string");
  assert.equal(bundledTerminalJob?.outputJson?.terminalOutput?.redaction, "terminal_stdout_stderr_preview_only");
  assert.equal(bundle.bundle.observations.some((observation) =>
    observation.kind === "terminal" &&
    observation.capabilityJobId === operation.result.job.id &&
    observation.metadata?.jobStatus === "completed"
  ), true);

  const truncatedStarted = await postJson("/computer-use/sessions", {
    userRequest: "긴 터미널 출력을 제한하고 redacted preview만 보여줘",
    requestedSurface: "pty_workspace",
    profileId: "profile:terminal-truncation-smoke",
    metadata: {
      requiresTerminal: true
    }
  });
  assert.equal(truncatedStarted.ok, true);
  const truncatedSessionId = truncatedStarted.result.session.sessionId;
  const truncatedCommand = "node -e process.stdout.write('x'.repeat(600000))";
  const truncatedOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(truncatedSessionId)}/operations`, {
    operation: {
      kind: "terminal",
      input: {
        command: truncatedCommand,
        cwd: process.cwd(),
        expectedOutcome: "stdout is truncated to the terminal helper limit"
      }
    },
    waitMs: 8000
  });
  assert.equal(truncatedOperation.ok, true);
  assert.equal(truncatedOperation.result.job.status, "awaiting_approval");
  send({ type: "capability.approve", requestId: `approve-${truncatedOperation.result.job.id}`, jobId: truncatedOperation.result.job.id });
  await waitFor((event) => event.type === "capability.job" && event.jobId === truncatedOperation.result.job.id && event.status === "completed", "truncated terminal job completed");
  const truncatedBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(truncatedSessionId)}/debug-bundle`);
  const bundledTruncatedJob = truncatedBundle.bundle.capabilityJobs.find((job) => job.id === truncatedOperation.result.job.id);
  assert.equal(bundledTruncatedJob?.outputJson?.stdout, undefined);
  assert.equal(bundledTruncatedJob?.outputJson?.truncated, undefined);
  assert.equal(bundledTruncatedJob?.outputJson?.terminalOutput?.stdoutTruncated, true);
  assert.equal(bundledTruncatedJob?.outputJson?.terminalOutput?.stderrTruncated, false);
  assert.equal(bundledTruncatedJob?.outputJson?.terminalOutput?.stdoutLength, 512 * 1024);
  assert.equal(bundledTruncatedJob?.outputJson?.terminalOutput?.stdoutByteLimit, 512 * 1024);
  assert.equal(bundledTruncatedJob?.outputJson?.terminalOutput?.stderrByteLimit, 128 * 1024);
  assert.equal(bundledTruncatedJob?.outputJson?.terminalOutput?.resourceLimits, "terminal_helper_bounded_output");
  assert.equal(String(bundledTruncatedJob?.outputJson?.terminalOutput?.stdoutPreview ?? "").length <= 240, true);

  const profile = await postJson("/computer-use/autonomy/profiles", {
    name: "Computer Use terminal allowlist smoke",
    mode: "scoped_yolo",
    scope: "one_time",
    maxUses: 1,
    grants: {
      network: false,
      networkDomains: [],
      browserAutomation: false,
      browserDomains: [],
      filesystem: { readRoots: [smokeAppData.dir], writeRoots: [smokeAppData.dir] },
      commands: {
        allowPrefixes: ["echo", "node -e"],
        denyPatterns: ["password", "token", "secret", "cookie", "rm -rf", "format"]
      },
      packageInstall: false,
      osMutation: false,
      generatedToolMaterialization: false,
      generatedToolExecution: false,
      generatedCode: false,
      credentialAccess: "never",
      riskClasses: ["reversible"],
      maxRuntimeMs: 30000,
      maxOutputBytes: 2097152,
      maxIterations: 1
    }
  });
  assert.equal(profile.ok, true);

  const allowedStarted = await postJson("/computer-use/sessions", {
    userRequest: "허용된 터미널 명령을 실행해줘",
    requestedSurface: "pty_workspace",
    profileId: profile.profile.id,
    metadata: {
      requiresTerminal: true
    }
  });
  assert.equal(allowedStarted.ok, true);
  const allowedSessionId = allowedStarted.result.session.sessionId;
  writeFileSync(modifiedPath, "before-terminal-run\n", "utf8");
  writeFileSync(deletedPath, "delete-me\n", "utf8");
  const deltaCommand = "node -e fs=require('node:fs'),fs.writeFileSync('terminal-artifact.txt','terminal-artifact-ok'),fs.writeFileSync('terminal-diff.txt','terminal-diff-ok'),fs.unlinkSync('terminal-delete.txt'),console.log('terminal-delta-ok')";
  const allowedOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(allowedSessionId)}/operations`, {
    operation: {
      kind: "terminal",
      input: {
        command: deltaCommand,
        cwd: outputRoot,
        trackOutputRoots: [outputRoot],
        expectedArtifacts: [
          { path: artifactPath, role: "terminal_artifact", mime: "text/plain" }
        ]
      }
    },
    waitMs: 8000
  });
  assert.equal(allowedOperation.ok, true);
  assert.equal(allowedOperation.result.job.kind, "terminal");
  assert.equal(allowedOperation.result.job.status, "completed");
  const allowedBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(allowedSessionId)}/debug-bundle`);
  assert.equal(allowedBundle.bundle.safetyDecisions.some((decision) =>
    decision?.phase === "terminal_permission_profile" &&
    decision.decision === "allow" &&
    decision.profileId === profile.profile.id
  ), true);
  assert.equal(allowedBundle.bundle.observations.some((observation) =>
    observation.kind === "file" &&
    observation.source === "terminal_expected_artifact" &&
    observation.resourceIds?.some((resource) => resource.role === "terminal_artifact")
  ), true);
  assert.equal(allowedBundle.bundle.evalResources.some((resource) => resource.role === "terminal_artifact"), true);
  assert.equal(allowedBundle.bundle.evalResources.some((resource) => resource.role === "terminal_diff_artifact"), true);
  assert.equal(allowedBundle.bundle.evalResources.some((resource) => resource.role === "terminal_output_root_delta_manifest"), true);
  assert.equal(allowedBundle.bundle.observations.some((observation) =>
    observation.kind === "file" &&
    observation.source === "terminal_output_root_diff" &&
    observation.resourceIds?.some((resource) => resource.role === "terminal_diff_artifact")
  ), true);
  const terminalDeltaObservation = allowedBundle.bundle.observations.find((observation) =>
    observation.kind === "file" &&
    observation.source === "terminal_output_root_diff" &&
    observation.resourceIds?.some((resource) => resource.role === "terminal_output_root_delta_manifest")
  );
  assert.equal(terminalDeltaObservation?.metadata?.createdCount, 1);
  assert.equal(terminalDeltaObservation?.metadata?.modifiedCount, 1);
  assert.equal(terminalDeltaObservation?.metadata?.deletedCount, 1);
  const terminalRollback = allowedBundle.bundle.rollbackActions.find((action) =>
    action.kind === "delete_artifact" &&
    action.metadata?.source === "terminal_output_root_diff"
  );
  assert.equal(terminalRollback?.status, "blocked");
  assert.equal(terminalRollback?.metadata?.terminalArtifactTargetCount, 1);
  assert.equal(terminalRollback?.metadata?.terminalArtifactTargets?.some((target) => typeof target.path === "string"), false);
  const rollbackResult = await postJson(`/computer-use/sessions/${encodeURIComponent(allowedSessionId)}/rollback-actions/${encodeURIComponent(terminalRollback.id)}`, {
    includeUserArtifacts: true,
    confirmUserArtifacts: true
  });
  assert.equal(rollbackResult.ok, true);
  assert.equal(rollbackResult.rollbackAction.status, "completed");
  assert.equal(existsSync(artifactPath), false);
  assert.equal(existsSync(modifiedPath), true);
  assert.equal(existsSync(deletedPath), false);

  const chainedStarted = await postJson("/computer-use/sessions", {
    userRequest: "허용 prefix 뒤에 다른 터미널 명령을 이어붙이는 시도를 막아줘",
    requestedSurface: "pty_workspace",
    profileId: profile.profile.id,
    metadata: {
      requiresTerminal: true
    }
  });
  assert.equal(chainedStarted.ok, true);
  const chainedOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(chainedStarted.result.session.sessionId)}/operations`, {
    operation: {
      kind: "terminal",
      input: {
        command: "echo terminal-prefix-bypass & node -v",
        cwd: outputRoot
      }
    },
    waitMs: 8000
  });
  assert.equal(chainedOperation.ok, true);
  assert.equal(chainedOperation.result.job, undefined);
  assert.equal(chainedOperation.result.dagNode.status, "failed");
  assert.equal(chainedOperation.result.dagNode.output.reason, "terminal_command_shell_chaining_boundary");

  const blockedStarted = await postJson("/computer-use/sessions", {
    userRequest: "허용되지 않은 터미널 명령을 실행해줘",
    requestedSurface: "pty_workspace",
    profileId: profile.profile.id,
    metadata: {
      requiresTerminal: true
    }
  });
  assert.equal(blockedStarted.ok, true);
  const blockedSessionId = blockedStarted.result.session.sessionId;
  const blockedOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(blockedSessionId)}/operations`, {
    operation: {
      kind: "terminal",
      input: {
        command: "node -v",
        cwd: process.cwd()
      }
    },
    waitMs: 8000
  });
  assert.equal(blockedOperation.ok, true);
  assert.equal(blockedOperation.result.job, undefined);
  assert.equal(blockedOperation.result.dagNode.status, "failed");
  assert.equal(blockedOperation.result.dagNode.output.missingRequirements.some((requirement) =>
    requirement.type === "command" && requirement.value === "node -v"
  ), true);

  console.log(`computer use terminal parity smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

function assertFollowupDagNodes(bundle, actionNodeId, jobId) {
  const verification = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:verification`);
  const ledger = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:eval_ledger`);
  assert.equal(verification?.kind, "verification");
  assert.equal(verification?.status, "completed");
  assert.equal(verification?.capabilityJobId, jobId);
  assert.equal(ledger?.kind, "eval_ledger");
  assert.equal(ledger?.status, "completed");
  assert.equal(ledger?.capabilityJobId, jobId);
}

function send(message) {
  socket.send(JSON.stringify(message));
}

function waitFor(predicate, label, timeoutMs = 12_000) {
  const existing = events.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timeout: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        reject(new Error(`Timed out waiting for ${label}. Events: ${events.map((event) => `${event.type}:${event.status ?? ""}`).join(", ")}`));
      }, timeoutMs)
    };
    waiters.push(waiter);
  });
}
