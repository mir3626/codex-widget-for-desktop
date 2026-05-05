import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

const loginCommand =
  process.platform === "win32"
    ? { file: "cmd.exe", args: ["/d", "/s", "/c", "codex", "login", "status"] }
    : { file: "codex", args: ["login", "status"] };
const loginStatus = spawnSync(loginCommand.file, loginCommand.args, {
  encoding: "utf8",
  timeout: 10_000,
  windowsHide: true
});
const loginOutput = `${loginStatus.stdout ?? ""}\n${loginStatus.stderr ?? ""}`;
if (loginStatus.status !== 0 || !/Logged in/i.test(loginOutput)) {
  throw new Error(`Codex CLI is not logged in; cannot run live app-server smoke. ${loginOutput.trim()}`);
}

const tempDir = mkdtempSync(join(tmpdir(), `codex-widget-app-server-live-${process.pid}-`));
const marker = `codex-widget-app-server-live-ok-${Date.now().toString(36)}`;
const startupTimeoutMs = readPositiveInt(process.env.CODEX_WIDGET_LIVE_SMOKE_STARTUP_TIMEOUT_MS, 90_000);
const turnTimeoutMs = readPositiveInt(process.env.CODEX_WIDGET_LIVE_SMOKE_TIMEOUT_MS, 120_000);
const previousEnv = {
  authMode: process.env.CODEX_WIDGET_AUTH_MODE,
  runtime: process.env.CODEX_WIDGET_CODEX_RUNTIME,
  workdir: process.env.CODEX_WIDGET_CODEX_WORKDIR,
  sandbox: process.env.CODEX_WIDGET_CODEX_SANDBOX,
  approvalPolicy: process.env.CODEX_WIDGET_CODEX_APPROVAL_POLICY,
  model: process.env.CODEX_WIDGET_MODEL,
  reasoningEffort: process.env.CODEX_WIDGET_REASONING_EFFORT
};

process.env.CODEX_WIDGET_AUTH_MODE = "codex";
process.env.CODEX_WIDGET_CODEX_RUNTIME = "app-server";
process.env.CODEX_WIDGET_CODEX_WORKDIR = tempDir;
process.env.CODEX_WIDGET_CODEX_SANDBOX = "workspace-write";
process.env.CODEX_WIDGET_CODEX_APPROVAL_POLICY = "on-request";
process.env.CODEX_WIDGET_MODEL = process.env.CODEX_WIDGET_LIVE_SMOKE_MODEL ?? "gpt-5.4-mini";
process.env.CODEX_WIDGET_REASONING_EFFORT = process.env.CODEX_WIDGET_LIVE_SMOKE_REASONING_EFFORT ?? "low";

const daemon = await startDaemon({ port: 0 });
const events = [];
let socket;
let unexpectedInteraction;

try {
  socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    events.push(event);
    if (event.type === "interaction.required") {
      unexpectedInteraction = event.interaction;
      socket.send(
        JSON.stringify({
          type: "interaction.respond",
          id: event.interaction.id,
          decision: "decline",
          answers: {}
        })
      );
    }
  });

  await waitForEvent((event) => event.type === "connected", "daemon connection", 10_000);
  const connected = events.find((event) => event.type === "connected");
  if (connected?.daemon?.auth?.mode !== "codex" || connected.daemon.auth.authenticated !== true) {
    throw new Error(`Expected authenticated Codex daemon connection: ${JSON.stringify(connected)}`);
  }

  await waitForEvent(
    (event) =>
      event.type === "runtime.status" &&
      event.status?.codexAppServer?.state === "connected" &&
      event.status.codexAppServer.startCount > 0,
    "live Codex app-server connection",
    startupTimeoutMs
  );

  socket.send(
    JSON.stringify({
      type: "ask",
      id: "live-app-server-1",
      text: `Respond with exactly this marker and nothing else: ${marker}`,
      mode: "agent",
      model: process.env.CODEX_WIDGET_MODEL,
      reasoningEffort: process.env.CODEX_WIDGET_REASONING_EFFORT
    })
  );

  const completed = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "live-app-server-1",
    "live Codex app-server completion",
    turnTimeoutMs
  );
  if (unexpectedInteraction) {
    throw new Error(`Live app-server smoke unexpectedly requested interaction: ${JSON.stringify(unexpectedInteraction)}`);
  }
  if (!String(completed.text ?? "").includes(marker)) {
    throw new Error(`Live app-server response did not include marker ${marker}: ${JSON.stringify(completed)}`);
  }

  const deltaCount = events.filter((event) => event.type === "message.delta" && event.id === "live-app-server-1").length;
  if (deltaCount < 1) {
    throw new Error("Live app-server smoke did not receive streaming deltas.");
  }

  console.log(`codex app-server live smoke ok: ${deltaCount} deltas, port ${daemon.port}`);
} finally {
  socket?.close();
  await daemon.close();
  restoreEnv();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

function waitForEvent(predicate, label, timeoutMs) {
  const existing = events.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const match = events.find(predicate);
      if (!match) {
        return;
      }
      clearTimeout(timeout);
      clearInterval(interval);
      resolve(match);
    }, 25);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`Timed out waiting for ${label}.`));
    }, timeoutMs);
  });
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function restoreEnv() {
  restoreEnvValue("CODEX_WIDGET_AUTH_MODE", previousEnv.authMode);
  restoreEnvValue("CODEX_WIDGET_CODEX_RUNTIME", previousEnv.runtime);
  restoreEnvValue("CODEX_WIDGET_CODEX_WORKDIR", previousEnv.workdir);
  restoreEnvValue("CODEX_WIDGET_CODEX_SANDBOX", previousEnv.sandbox);
  restoreEnvValue("CODEX_WIDGET_CODEX_APPROVAL_POLICY", previousEnv.approvalPolicy);
  restoreEnvValue("CODEX_WIDGET_MODEL", previousEnv.model);
  restoreEnvValue("CODEX_WIDGET_REASONING_EFFORT", previousEnv.reasoningEffort);
}

function restoreEnvValue(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
