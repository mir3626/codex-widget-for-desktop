import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-terminal-capability-smoke");
const daemon = await startDaemon({ port: 0 });
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

  send({
    type: "capability.start",
    requestId: "terminal-capability-start",
    job: {
      id: "terminal-capability-job",
      kind: "terminal",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { command: "echo terminal-capability-smoke" },
      timeoutMs: 10_000
    }
  });

  await waitFor((event) => event.type === "capability.job" && event.jobId === "terminal-capability-job" && event.status === "awaiting_approval", "terminal awaiting approval");
  send({ type: "capability.approve", requestId: "terminal-capability-approve", jobId: "terminal-capability-job" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "terminal-capability-job" && event.status === "running", "terminal running");
  await waitFor((event) => event.type === "capability.job" && event.jobId === "terminal-capability-job" && event.status === "completed", "terminal completed");

  const stored = await fetchCapabilityJob("terminal-capability-job");
  assertEqual(stored.job.kind, "terminal", "stored terminal kind");
  assertEqual(stored.job.status, "completed", "stored terminal status");
  assertEqual(stored.job.outputJson?.exitCode, 0, "stored terminal exit code");
  assert(String(stored.job.outputJson?.stdout ?? "").includes("terminal-capability-smoke"), "stored terminal stdout should include smoke marker");
  assertEqual(stored.job.outputJson?.capabilityVerification?.status, "passed", "stored terminal verification status");
  assertEqual(stored.diagnostics?.kind, "terminal", "stored terminal diagnostics kind");

  console.log(`terminal capability smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function fetchCapabilityJob(jobId) {
  const response = await fetch(`http://127.0.0.1:${daemon.port}/capabilities/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    throw new Error(`Capability job GET failed (${response.status}).`);
  }
  return await response.json();
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
