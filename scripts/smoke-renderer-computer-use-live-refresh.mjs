import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { chromium } from "@playwright/test";
import { WebSocketServer } from "ws";

const now = "2026-05-16T03:00:00.000Z";
const session = {
  sessionId: "computer-live-refresh-session",
  userRequest: "Renderer live refresh smoke",
  state: "running",
  riskClass: "read_only",
  selectedSurface: {
    kind: "isolated_browser",
    displayName: "Isolated browser",
    riskClass: "read_only",
    available: true,
    grantsRequired: [],
    capabilities: ["browser_action"]
  },
  evalRunId: "eval-live-refresh",
  createdAt: now,
  updatedAt: now
};
const surface = session.selectedSurface;
let sessions = [];
let sessionFetchCount = 0;
let bundleFetchCount = 0;
const clients = new Set();

const httpServer = createHttpServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "OPTIONS") {
    writeJson(response, 204, {});
    return;
  }
  if (url.pathname === "/computer-use/surfaces") {
    writeJson(response, 200, { ok: true, surfaces: [surface] });
    return;
  }
  if (url.pathname === "/computer-use/sessions") {
    sessionFetchCount += 1;
    writeJson(response, 200, { ok: true, sessions });
    return;
  }
  if (url.pathname === "/computer-use/autonomy/profiles") {
    writeJson(response, 200, { ok: true, profiles: [] });
    return;
  }
  if (url.pathname === "/computer-use/eval/promotion-gate") {
    writeJson(response, 200, {
      ok: true,
      promotionGate: {
        schemaVersion: "computer-use-promotion-gate.v1",
        summary: {
          overallStatus: "smoke",
          promotableSlices: [],
          blockedSlices: [],
          passedNonPromotableSlices: []
        },
        gates: []
      }
    });
    return;
  }
  if (url.pathname === `/computer-use/sessions/${encodeURIComponent(session.sessionId)}/debug-bundle`) {
    bundleFetchCount += 1;
    writeJson(response, 200, {
      ok: true,
      bundle: {
        schemaVersion: "computer-session-debug-bundle.v1",
        session,
        evalRun: {
          id: session.evalRunId,
          status: "running",
          taskSuccess: null,
          createdAt: now,
          updatedAt: now
        },
        dagNodes: [
          {
            id: "dag-live-refresh-marker",
            kind: "live_refresh_marker",
            status: "running",
            input: {},
            output: {},
            createdAt: now,
            updatedAt: now
          }
        ],
        promptRuns: [],
        capabilityJobs: [],
        observations: [],
        perceptionGraphs: [],
        evalResources: [],
        actionFeedbacks: [],
        failureMemory: [],
        rollbackActions: [],
        safetyDecisions: [],
        freshnessSummary: {
          total: 0,
          fresh: 0,
          stale: 0,
          missingTimestamp: 0
        }
      }
    });
    return;
  }
  writeJson(response, 404, { ok: false, error: `Unhandled smoke route ${url.pathname}` });
});

const wsServer = new WebSocketServer({ server: httpServer });
wsServer.on("connection", (socket) => {
  clients.add(socket);
  socket.on("close", () => clients.delete(socket));
  socket.send(JSON.stringify({
    type: "connected",
    daemon: {
      port: daemonPort,
      model: "mock",
      liveModel: true,
      auth: {
        mode: "mock",
        configured: true,
        authenticated: true,
        signInAvailable: false,
        signInMethod: null
      }
    }
  }));
  socket.send(JSON.stringify({
    type: "session.snapshot",
    snapshot: {
      activeSessionId: "renderer-live-refresh-chat",
      sessions: [
        {
          id: "renderer-live-refresh-chat",
          title: "Renderer live refresh",
          status: "active",
          createdAt: now,
          updatedAt: now,
          activeModel: "gpt-5.5",
          activeReasoning: "xhigh",
          activeMode: "agent",
          messageCount: 0
        }
      ],
      trashedSessions: [],
      messages: []
    }
  }));
  socket.send(JSON.stringify({
    type: "ledger.snapshot",
    snapshot: {
      sessionId: "renderer-live-refresh-chat",
      artifacts: [],
      activities: [],
      providerSnapshots: []
    }
  }));
});

await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
const daemonAddress = httpServer.address();
if (!daemonAddress || typeof daemonAddress === "string") {
  throw new Error("Fake daemon did not bind to a TCP port.");
}
const daemonPort = daemonAddress.port;

const vite = await createViteServer({
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false
  }
});
await vite.listen();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 820 } });
page.setDefaultNavigationTimeout(90000);

try {
  const baseUrl = vite.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Vite did not expose a local URL.");
  }

  await page.goto(`${baseUrl}?daemonPort=${daemonPort}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Activity details" }).click();
  await page.getByText("Computer Use", { exact: true }).waitFor();
  await waitUntil(() => sessionFetchCount >= 1, "Timed out waiting for initial Computer Use session fetch.");
  if (await page.getByText("live_refresh_marker").count()) {
    throw new Error("Live refresh marker should not render before the daemon event.");
  }

  sessions = [session];
  for (const client of clients) {
    client.send(JSON.stringify({
      type: "computer.session.state",
      sessionId: session.sessionId,
      state: session.state,
      updatedAt: session.updatedAt
    }));
  }

  await waitUntil(() => sessionFetchCount >= 2, "Timed out waiting for daemon-event Computer Use session refresh.");
  await waitUntil(() => bundleFetchCount >= 1, "Timed out waiting for daemon-event debug bundle refresh.");
  await page.getByText("live_refresh_marker").waitFor();
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="Computer Use session"]');
    return select instanceof HTMLSelectElement && select.value === "computer-live-refresh-session";
  });

  console.log(`renderer Computer Use live refresh smoke ok on vite ${baseUrl} daemon ${daemonPort}`);
} finally {
  await browser.close();
  await vite.close();
  for (const client of clients) {
    client.close();
  }
  await new Promise((resolve) => wsServer.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json"
  });
  if (status === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(body));
}

async function waitUntil(predicate, message, timeoutMs = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}
