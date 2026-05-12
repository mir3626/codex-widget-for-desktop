import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-agent-tool-capability-smoke");
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
    requestId: "agent-tool-capability-start",
    job: {
      id: "agent-tool-capability-job",
      kind: "agent_tool",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: {
        toolId: "browser_action",
        capability: "browser_action",
        runtime: "simulated_daemon",
        request: {
          action: "status",
          password: "should-not-persist"
        }
      },
      timeoutMs: 10_000
    }
  });

  await waitFor((event) => event.type === "capability.job" && event.jobId === "agent-tool-capability-job" && event.status === "awaiting_approval", "agent tool awaiting approval");
  send({ type: "capability.approve", requestId: "agent-tool-capability-approve", jobId: "agent-tool-capability-job" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "agent-tool-capability-job" && event.status === "completed", "agent tool completed");

  const stored = await fetchCapabilityJob("agent-tool-capability-job");
  assertEqual(stored.job.kind, "agent_tool", "stored agent tool kind");
  assertEqual(stored.job.status, "completed", "stored agent tool status");
  assertEqual(stored.job.outputJson?.status, "available", "stored agent tool status output");
  assertEqual(stored.job.outputJson?.request?.password, "[redacted]", "stored agent tool redaction");
  assertEqual(stored.job.outputJson?.capabilityVerification?.status, "passed", "stored agent tool verification status");

  send({
    type: "capability.start",
    requestId: "agent-tool-blocked-start",
    job: {
      id: "agent-tool-blocked-job",
      kind: "agent_tool",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: {
        toolId: "browser_action",
        capability: "browser_action",
        runtime: "app_server_client_tool"
      },
      timeoutMs: 10_000
    }
  });

  await waitFor((event) => event.type === "capability.job" && event.jobId === "agent-tool-blocked-job" && event.status === "awaiting_approval", "blocked agent tool awaiting approval");
  send({ type: "capability.approve", requestId: "agent-tool-blocked-approve", jobId: "agent-tool-blocked-job" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "agent-tool-blocked-job" && event.status === "failed", "blocked agent tool failed");
  const blocked = await fetchCapabilityJob("agent-tool-blocked-job");
  assertEqual(blocked.job.outputJson?.contract?.status, "blocked", "blocked contract status");

  console.log(`agent tool capability smoke ok on port ${daemon.port}`);
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

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
