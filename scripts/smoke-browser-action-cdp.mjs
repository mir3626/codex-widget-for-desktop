import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { chromium } from "@playwright/test";
import { buildElementGraph, cdpAdapter, resolveTarget } from "../dist/daemon/browser-action/index.js";
import { removeSmokeDir } from "./smoke-isolation.mjs";

const pageServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <title>Browser Action CDP Smoke</title>
    <main>
      <input id="query" aria-label="Search docs" value="">
      <button id="open-details" onclick="document.querySelector('#status').textContent='opened'">Open details</button>
      <p id="status">closed</p>
    </main>`);
});

await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${pageServer.address().port}/`;
const cdpPort = await getFreePort();
const userDataDir = await mkdtemp(join(tmpdir(), "codex-widget-cdp-smoke-"));
const chrome = spawn(chromium.executablePath(), [
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${userDataDir}`,
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  pageUrl
], { stdio: "ignore", windowsHide: true });

try {
  await waitForCdp(`http://127.0.0.1:${cdpPort}`);
  process.env.CODEX_WIDGET_BROWSER_ACTION_CDP_URL = await resolvePageDebuggerUrl(`http://127.0.0.1:${cdpPort}`, pageUrl);

  const session = {
    id: "cdp-smoke",
    startedAt: new Date().toISOString(),
    source: { kind: "debug_target", browser: "chromium", url: pageUrl },
    mode: "auto_safe_actions",
    status: "active",
    timeline: [],
    approvals: []
  };
  const status = await cdpAdapter.getStatus({ session });
  assertEqual(status.state, "ready", "cdp adapter status");

  const observation = await cdpAdapter.observe({ session });
  if (!observation.elements.some((element) => element.id === "query")) {
    throw new Error(`CDP observation did not include structured input element: ${JSON.stringify(observation.elements.slice(0, 5))}`);
  }
  const graph = buildElementGraph({ observationId: observation.id, elements: observation.elements });
  const query = resolveTarget({ graph, target: { kind: "element_id", id: "query" } }).primary;
  if (!query) {
    throw new Error("CDP target resolver did not find #query.");
  }
  const typed = await cdpAdapter.execute({
    session,
    observation,
    action: { type: "type", target: { kind: "element_id", id: "query" }, text: "cdp smoke", clearFirst: true },
    target: query
  });
  if (!typed.ok) {
    throw new Error(`CDP type failed: ${typed.error}`);
  }
  const afterValue = typed.after?.elements?.find((element) => element.id === "query")?.value;
  assertEqual(afterValue, "cdp smoke", "cdp typed value");

  const clicked = await cdpAdapter.execute({
    session,
    observation,
    action: { type: "click", target: { kind: "element_id", id: "open-details" } },
    target: observation.elements.find((element) => element.id === "open-details")
  });
  if (!clicked.ok) {
    throw new Error(`CDP click failed: ${clicked.error}`);
  }
  if (!String(clicked.after?.text ?? "").includes("opened")) {
    throw new Error(`CDP click did not update page text: ${clicked.after?.text}`);
  }

  console.log(`browser action cdp smoke ok on ${pageUrl}`);
} finally {
  await stopChrome(chrome);
  pageServer.close();
  removeSmokeDir(userDataDir);
  delete process.env.CODEX_WIDGET_BROWSER_ACTION_CDP_URL;
}

async function waitForCdp(baseUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until Chromium finishes starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for Chromium CDP endpoint.");
}

async function resolvePageDebuggerUrl(baseUrl, expectedUrl) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/json/list`);
    if (response.ok) {
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.url === expectedUrl && target.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out resolving page CDP debugger URL.");
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port);
        } else {
          reject(new Error("Unable to allocate a free TCP port."));
        }
      });
    });
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function stopChrome(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 2_000).unref();
  });
}
