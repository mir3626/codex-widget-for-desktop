import { createServer } from "node:http";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { buildElementGraph, playwrightAdapter, resolveTarget } from "../dist/daemon/browser-action/index.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const pageServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <title>Browser Action Playwright Smoke</title>
    <main>
      <label>Search docs <input id="query" aria-label="Search docs" value=""></label>
      <button id="open-details" type="button" onclick="document.querySelector('#status').textContent='opened'">Open details</button>
      <p id="status">closed</p>
    </main>`);
});

await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${pageServer.address().port}/`;
const smokeAppData = useSmokeAppData("codex-widget-browser-action-playwright-smoke");
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
    type: "browserAction.start",
    actionSessionId: "browser-action-playwright-smoke",
    mode: "auto_safe_actions",
    source: { kind: "controlled_browser", browser: "chromium", url: pageUrl }
  });
  await waitFor((event) => event.type === "browserAction.started", "browser action started");

  send({ type: "browserAction.adapters", actionSessionId: "browser-action-playwright-smoke" });
  const adapters = await waitFor((event) => event.type === "browserAction.adapters", "adapter status");
  const playwright = adapters.adapters.find((adapter) => adapter.id === "playwright");
  assertEqual(playwright?.state, "ready", "playwright adapter status");

  send({ type: "browserAction.observe", actionSessionId: "browser-action-playwright-smoke", adapterId: "playwright" });
  const observed = await waitFor((event) => event.type === "browserAction.observation", "playwright observation", 20_000);
  if ((observed.observationSummary?.elements ?? 0) < 2) {
    throw new Error(`Expected structured elements from Playwright observation: ${JSON.stringify(observed)}`);
  }

  send({
    type: "browserAction.execute",
    actionSessionId: "browser-action-playwright-smoke",
    adapterId: "playwright",
    action: { type: "click", target: { kind: "element_id", id: "open-details" } }
  });
  const clickResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.action === "click", "playwright click result", 20_000);
  assertEqual(clickResult.result.status, "succeeded", "playwright protocol click");

  const session = {
    id: "direct-playwright",
    startedAt: new Date().toISOString(),
    source: { kind: "controlled_browser", browser: "chromium", url: pageUrl },
    mode: "auto_safe_actions",
    status: "active",
    timeline: [],
    approvals: []
  };
  const directObservation = await playwrightAdapter.observe({ session, providerState: { url: pageUrl } });
  const graph = buildElementGraph({ observationId: directObservation.id, elements: directObservation.elements });
  const resolution = resolveTarget({ graph, target: { kind: "element_id", id: "query" } });
  const directResult = await playwrightAdapter.execute({
    session,
    observation: directObservation,
    action: { type: "type", target: { kind: "element_id", id: "query" }, text: "browser action smoke", clearFirst: true },
    target: resolution.primary
  });
  if (!directResult.ok) {
    throw new Error(`Direct Playwright type failed: ${directResult.error}`);
  }
  const afterValue = directResult.after?.elements?.find((element) => element.id === "query")?.value;
  assertEqual(afterValue, "browser action smoke", "direct playwright typed value");

  console.log(`browser action playwright smoke ok on ${pageUrl}`);
} finally {
  socket.close();
  await daemon.close();
  pageServer.close();
  smokeAppData.cleanup();
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
        reject(new Error(`Timed out waiting for ${label}. Events: ${events.map((event) => event.type).join(", ")}`));
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
