import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-browser-chrome-capability-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
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
    requestId: "browser-chrome-list",
    job: {
      id: "browser-chrome-list-job",
      kind: "browser_chrome",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { command: "bookmark.list" },
      timeoutMs: 10_000
    }
  });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-list-job" && event.status === "running", "browser chrome list running");
  const listCommand = await pollBrowserBridgeCommand();
  assertEqual(listCommand?.kind, "browser_chrome", "list command kind");
  assertEqual(listCommand?.command, "bookmark.list", "list command");
  await postBrowserChromeResult(listCommand.requestId, {
    tree: [{ id: "0", title: "Bookmarks", children: [{ id: "1", title: "Example", url: "https://example.test/" }] }]
  }, { verification: "bookmark_tree_read" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-list-job" && event.status === "completed", "browser chrome list completed");

  send({
    type: "capability.start",
    requestId: "browser-chrome-create",
    job: {
      id: "browser-chrome-create-job",
      kind: "browser_chrome",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: {
        command: "bookmark.create",
        title: "Capability Smoke",
        url: "https://example.test/capability"
      },
      timeoutMs: 10_000
    }
  });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-create-job" && event.status === "awaiting_approval", "browser chrome create awaiting approval");
  send({ type: "capability.approve", requestId: "approve-browser-chrome-create", jobId: "browser-chrome-create-job" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-create-job" && event.status === "running", "browser chrome create running");
  const createCommand = await pollBrowserBridgeCommand();
  assertEqual(createCommand?.kind, "browser_chrome", "create command kind");
  assertEqual(createCommand?.command, "bookmark.create", "create command");
  assertEqual(createCommand?.payload?.title, "Capability Smoke", "create title");
  assertEqual(createCommand?.payload?.url, "https://example.test/capability", "create url");
  await postBrowserChromeResult(createCommand.requestId, {
    bookmark: { id: "smoke-bookmark", title: "Capability Smoke", url: "https://example.test/capability" }
  }, { verification: "bookmark_created", bookmarkId: "smoke-bookmark" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-create-job" && event.status === "completed", "browser chrome create completed");
  const stored = await fetchCapabilityJob("browser-chrome-create-job");
  assertEqual(stored.job.kind, "browser_chrome", "stored create kind");
  assertEqual(stored.job.status, "completed", "stored create status");
  assertEqual(stored.job.outputJson?.output?.bookmark?.id, "smoke-bookmark", "stored create output");
  assertEqual(stored.job.outputJson?.capabilityVerification?.status, "passed", "stored create verification status");
  assertEqual(stored.diagnostics?.kind, "browser_chrome", "stored create diagnostics kind");

  console.log(`browser chrome capability smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function pollBrowserBridgeCommand() {
  const url = new URL(`${baseUrl}/browser-action/extension/poll`);
  url.searchParams.set("permission", "allowed");
  url.searchParams.set("tabId", "1");
  url.searchParams.set("windowId", "1");
  url.searchParams.set("url", "https://example.test/");
  url.searchParams.set("title", "Example");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Browser bridge poll failed (${response.status}).`);
  }
  const payload = await response.json();
  return payload.command ?? null;
}

async function postBrowserChromeResult(requestId, output, metadata) {
  const response = await fetch(`${baseUrl}/browser-action/extension/browser-chrome-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, ok: true, output, metadata })
  });
  if (!response.ok) {
    throw new Error(`Browser Chrome result POST failed (${response.status}).`);
  }
}

async function fetchCapabilityJob(jobId) {
  const response = await fetch(`${baseUrl}/capabilities/jobs/${encodeURIComponent(jobId)}`);
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
