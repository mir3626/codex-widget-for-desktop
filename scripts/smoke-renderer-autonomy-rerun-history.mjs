import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { chromium } from "@playwright/test";
import { WebSocketServer } from "ws";

const now = "2026-05-16T04:00:00.000Z";
const autonomyRun = {
  id: "autonomy-rerun-history-run",
  goal: "Compare Toolsmith reruns",
  status: "completed",
  permissionProfileId: "profile-rerun-history",
  evalRunId: "eval-rerun-history",
  dagRunId: "dag-rerun-history",
  gapIds: [],
  toolSpecIds: ["tool-rerun-history"],
  output: {},
  createdAt: now,
  updatedAt: now,
  completedAt: now
};
const tool = {
  id: "tool-rerun-history",
  name: "Rerun History Tool",
  capability: "web_research_to_pdf",
  version: "1.0.0",
  status: "active",
  templateId: "reviewed.web_research_to_pdf",
  entrypointKind: "internal_template",
  description: "Renderer smoke tool",
  requiredGrants: [],
  smokeTests: [],
  artifacts: [],
  stabilityRating: "high",
  manifest: {
    schemaVersion: "autonomy-tool-manifest.v1",
    toolId: "tool-rerun-history",
    capability: "web_research_to_pdf",
    entrypoint: "template:web_research_to_pdf",
    commandAllowlist: ["node"],
    dependencies: [
      { name: "node", source: "builtin", installed: true },
      { name: "codex-widget-local-npm-probe", version: "file:<redacted>/probe", source: "npm", installed: false }
    ],
    smokeCommands: [],
    artifactContract: [
      { role: "markdown", mime: "text/markdown", required: true },
      { role: "pdf", mime: "application/pdf", required: true }
    ],
    rollback: [
      { type: "delete_artifact", target: "<redacted>/report.pdf" }
    ],
    provenance: {
      generatedBy: "reviewed_template",
      templateId: "reviewed.web_research_to_pdf",
      sourceHashes: {},
      iterations: 1,
      generatedAt: now
    },
    stability: {
      rating: "high",
      rerunCount: 2,
      lastRerunStatus: "changed",
      externalDependencyWarnings: []
    }
  },
  sourceHash: "hash-rerun-history",
  activatedAt: now,
  createdAt: now,
  updatedAt: now
};
const toolRuns = [
  {
    id: "tool-run-dependency-policy",
    toolSpecId: tool.id,
    autonomyRunId: autonomyRun.id,
    evalRunId: autonomyRun.evalRunId,
    status: "completed",
    mode: "dependency_prepare",
    input: { command: "dependency_prepare" },
    output: {
      ok: true,
      policyReview: {
        schemaVersion: "toolsmith-dependency-policy-review.v1",
        localFilePackageCount: 1,
        externalRegistryPackageCount: 0,
        lockfileRequired: true,
        lockfileProvenancePresent: true,
        installedPackageProvenancePresent: true,
        reviewOutcome: "passed_local_or_allowlisted_dependency_policy",
        installIsolation: {
          ignoreScripts: true,
          noAudit: true,
          noFund: true,
          shell: false
        }
      }
    },
    elapsedMs: 73,
    createdAt: "2026-05-16T04:00:00.500Z",
    updatedAt: "2026-05-16T04:00:00.500Z",
    completedAt: "2026-05-16T04:00:00.500Z"
  },
  makeRerun("tool-run-rerun-changed", false, 1, 0, 1, 2, 3, "2026-05-16T04:00:03.000Z"),
  makeRerun("tool-run-rerun-matched", true, 0, 0, 0, 2, 2, "2026-05-16T04:00:02.000Z"),
  {
    id: "tool-run-execute-original",
    toolSpecId: tool.id,
    autonomyRunId: autonomyRun.id,
    evalRunId: autonomyRun.evalRunId,
    status: "completed",
    mode: "execute",
    input: { command: "execute" },
    output: { ok: true },
    elapsedMs: 91,
    createdAt: "2026-05-16T04:00:01.000Z",
    updatedAt: "2026-05-16T04:00:01.000Z",
    completedAt: "2026-05-16T04:00:01.000Z"
  }
];

const httpServer = createHttpServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "OPTIONS") {
    writeJson(response, 204, {});
    return;
  }
  if (url.pathname === "/computer-use/autonomy/profiles") {
    writeJson(response, 200, {
      ok: true,
      profiles: [
        {
          id: "profile-rerun-history",
          name: "Renderer Rerun Profile",
          mode: "scoped_yolo",
          scope: "one_time",
          status: "active",
          grants: {
            network: false,
            networkDomains: [],
            browserAutomation: false,
            browserDomains: [],
            filesystem: { readRoots: [], writeRoots: [] },
            commands: { allowPrefixes: [], denyPatterns: [] },
            packageInstall: false,
            osMutation: false,
            generatedToolMaterialization: true,
            generatedToolExecution: true,
            generatedCode: true,
            credentialAccess: "never",
            riskClasses: ["read_only"],
            maxRuntimeMs: 30000,
            maxOutputBytes: 2097152,
            maxIterations: 3
          },
          safetyBoundaries: [],
          createdAt: now,
          updatedAt: now
        }
      ]
    });
    return;
  }
  if (url.pathname === "/computer-use/autonomy/runs") {
    writeJson(response, 200, { ok: true, runs: [autonomyRun] });
    return;
  }
  if (url.pathname === `/computer-use/autonomy/runs/${encodeURIComponent(autonomyRun.id)}`) {
    writeJson(response, 200, {
      ok: true,
      run: autonomyRun,
      gaps: [],
      dagNodes: [
        {
          id: "dag-rerun-history",
          kind: "rerun_history",
          status: "completed",
          input: {},
          output: {},
          createdAt: now,
          updatedAt: now,
          elapsedMs: 12
        }
      ],
      toolRuns
    });
    return;
  }
  if (url.pathname === "/computer-use/autonomy/tools") {
    writeJson(response, 200, { ok: true, tools: [tool] });
    return;
  }
  if (url.pathname === "/computer-use/autonomy/inventory") {
    writeJson(response, 200, { ok: true, inventory: [] });
    return;
  }
  if (url.pathname === "/computer-use/surfaces") {
    writeJson(response, 200, { ok: true, surfaces: [] });
    return;
  }
  if (url.pathname === "/computer-use/sessions") {
    writeJson(response, 200, { ok: true, sessions: [] });
    return;
  }
  if (url.pathname === "/computer-use/eval/promotion-gate") {
    writeJson(response, 200, {
      ok: true,
      promotionGate: {
        schemaVersion: "computer-use-promotion-gate.v1",
        summary: { overallStatus: "smoke", promotableSlices: [], blockedSlices: [], passedNonPromotableSlices: [] },
        gates: []
      }
    });
    return;
  }
  writeJson(response, 404, { ok: false, error: `Unhandled smoke route ${url.pathname}` });
});

const wsServer = new WebSocketServer({ server: httpServer });
wsServer.on("connection", (socket) => {
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
      activeSessionId: "renderer-rerun-history-chat",
      sessions: [
        {
          id: "renderer-rerun-history-chat",
          title: "Renderer rerun history",
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
      sessionId: "renderer-rerun-history-chat",
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
const page = await browser.newPage({ viewport: { width: 560, height: 840 } });
page.setDefaultNavigationTimeout(90000);

try {
  const baseUrl = vite.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Vite did not expose a local URL.");
  }

  await page.goto(`${baseUrl}?daemonPort=${daemonPort}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Activity details" }).click();
  await page.getByText("Autonomy Toolsmith", { exact: true }).waitFor();
  await page.getByText("Rerun history", { exact: true }).waitFor();
  await page.getByText("scalar matched · artifacts matched").waitFor();
  await page.getByText("scalar changed · artifacts changed").waitFor();
  await page.getByText("artifact delta 2").waitFor();
  await page.getByText("1 changed · 0 missing · 1 added · 2/3 artifacts").waitFor();
  await page.getByText("Package policy", { exact: true }).waitFor();
  await page.getByText("local 1 · external 0 · scripts off · lock proven").waitFor();

  console.log(`renderer autonomy rerun history smoke ok on vite ${baseUrl} daemon ${daemonPort}`);
} finally {
  await browser.close();
  await vite.close();
  await new Promise((resolve) => wsServer.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
}

function makeRerun(id, matched, changed, missing, added, leftCount, rightCount, timestamp) {
  return {
    id,
    toolSpecId: tool.id,
    autonomyRunId: autonomyRun.id,
    evalRunId: autonomyRun.evalRunId,
    status: "completed",
    mode: "rerun",
    input: { command: "execute" },
    output: {
      ok: true,
      rerunComparison: {
        schemaVersion: "toolsmith-rerun-comparison.v1",
        matched,
        scalarMatched: matched,
        artifactComparison: {
          matched,
          leftCount,
          rightCount,
          changed: Array.from({ length: changed }, (_, index) => `changed:${index}`),
          missing: Array.from({ length: missing }, (_, index) => `missing:${index}`),
          added: Array.from({ length: added }, (_, index) => `added:${index}`)
        }
      }
    },
    elapsedMs: matched ? 84 : 127,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp
  };
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
