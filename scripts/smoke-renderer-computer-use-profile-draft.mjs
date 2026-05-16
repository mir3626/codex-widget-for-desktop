import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { chromium } from "@playwright/test";
import { WebSocketServer } from "ws";

const now = "2026-05-16T04:00:00.000Z";
const session = {
  sessionId: "computer-profile-draft-session",
  userRequest: "Inspect browser history with a one-time profile.",
  state: "blocked",
  blockedReason: "browser_history_one_time_profile_required",
  riskClass: "profile_private_data",
  selectedSurface: {
    kind: "regular_browser_extension",
    displayName: "Current browser profile",
    riskClass: "profile_private_data",
    available: true,
    grantsRequired: ["browser.profile", "browser.chrome"],
    capabilities: ["browser_chrome"]
  },
  evalRunId: "eval-profile-draft",
  createdAt: now,
  updatedAt: now
};
const existingProfile = {
  id: "profile-existing",
  name: "Persistent browser smoke",
  mode: "scoped_yolo",
  scope: "persistent",
  status: "active",
  grants: {
    network: false,
    networkDomains: [],
    browserAutomation: true,
    browserDomains: ["example.com"],
    filesystem: { readRoots: [], writeRoots: ["C:\\Users\\Tony\\Documents\\Codex Outputs"] },
    commands: { allowPrefixes: ["node scripts/report.mjs"], denyPatterns: [] },
    packageInstall: false,
    osMutation: false,
    generatedToolMaterialization: false,
    generatedToolExecution: false,
    generatedCode: false,
    credentialAccess: "never",
    riskClasses: ["high_risk"],
    maxRuntimeMs: 30000,
    maxOutputBytes: 2097152,
    maxIterations: 1
  },
  safetyBoundaries: ["history_debugger_file_upload_are_one_time"],
  usedCount: 0,
  maxUses: 5,
  expiresAt: "2026-05-16T05:00:00.000Z",
  createdAt: now,
  updatedAt: now
};
const disabledProfile = {
  ...existingProfile,
  id: "profile-disabled",
  name: "Expired smoke grant",
  status: "expired",
  usedCount: 1,
  maxUses: 1,
  updatedAt: "2026-05-16T04:30:00.000Z"
};
let createdProfileBody = null;
let managedCreatedProfileBody = null;
let attachedProfileBody = null;
let updatedProfileBody = null;

const httpServer = createHttpServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "OPTIONS") {
    writeJson(response, 204, {});
    return;
  }
  if (url.pathname === "/computer-use/surfaces") {
    writeJson(response, 200, { ok: true, surfaces: [session.selectedSurface] });
    return;
  }
  if (url.pathname === "/computer-use/sessions" && request.method === "GET") {
    writeJson(response, 200, { ok: true, sessions: [session] });
    return;
  }
  if (url.pathname === "/computer-use/autonomy/profiles" && request.method === "GET") {
    writeJson(response, 200, { ok: true, profiles: [existingProfile, disabledProfile] });
    return;
  }
  if (url.pathname === "/computer-use/autonomy/profiles" && request.method === "POST") {
    const body = JSON.parse(await readBody(request));
    assert.equal(body.scope, "one_time");
    assert.equal(body.maxUses, 1);
    assert.equal(body.grants.credentialAccess, "never");
    assert.equal(body.grants.riskClasses.includes("credential"), false);
    const createdId = body.name === "Computer Use one-time profile"
      ? "profile-managed-renderer"
      : "profile-one-time-renderer";
    if (createdId === "profile-managed-renderer") {
      managedCreatedProfileBody = body;
      assert.equal(body.grants.browserAutomation, false);
      assert.equal(body.grants.riskClasses.includes("read_only"), true);
    } else {
      createdProfileBody = body;
      assert.equal(body.grants.browserAutomation, true);
      assert.equal(body.grants.riskClasses.includes("high_risk"), true);
    }
    writeJson(response, 200, {
      ok: true,
      profile: {
        id: createdId,
        name: body.name,
        mode: body.mode,
        scope: body.scope,
        status: "active",
        grants: body.grants,
        safetyBoundaries: body.safetyBoundaries,
        usedCount: 0,
        maxUses: body.maxUses,
        createdAt: now,
        updatedAt: now
      }
    });
    return;
  }
  if (url.pathname === `/computer-use/autonomy/profiles/${encodeURIComponent(existingProfile.id)}` && request.method === "POST") {
    updatedProfileBody = JSON.parse(await readBody(request));
    assert.equal(updatedProfileBody.status, "disabled");
    writeJson(response, 200, {
      ok: true,
      profile: {
        ...existingProfile,
        status: updatedProfileBody.status,
        updatedAt: now
      }
    });
    return;
  }
  if (url.pathname === `/computer-use/sessions/${encodeURIComponent(session.sessionId)}/profile` && request.method === "POST") {
    attachedProfileBody = JSON.parse(await readBody(request));
    writeJson(response, 200, {
      ok: true,
      session: {
        ...session,
        profileId: attachedProfileBody.profileId
      },
      profile: {
        id: attachedProfileBody.profileId
      }
    });
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
    writeJson(response, 200, {
      ok: true,
      bundle: {
        schemaVersion: "computer-session-debug-bundle.v1",
        session,
        evalRun: {
          id: session.evalRunId,
          status: "blocked",
          taskSuccess: false,
          createdAt: now,
          updatedAt: now
        },
        dagNodes: [
          {
            id: "permission-check-profile-draft",
            kind: "permission_check",
            status: "failed",
            input: {},
            output: {
              missingRequirements: [
                { type: "browser_automation", value: "browser_chrome", reason: "History search requires browser chrome permission." },
                { type: "risk_class", value: "high_risk", reason: "History access is high-risk and one-time only." },
                { type: "credential_access", value: "browser_passwords", reason: "Credential access must stay denied." }
              ]
            },
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
        safetyDecisions: [
          {
            decision: "blocked",
            phase: "browser_chrome_permission_profile",
            reason: "history_requires_one_time_profile",
            missingRequirements: [
              { type: "browser_automation", value: "browser_chrome", reason: "History search requires browser chrome permission." },
              { type: "risk_class", value: "high_risk", reason: "History access is high-risk and one-time only." },
              { type: "credential_access", value: "browser_passwords", reason: "Credential access must stay denied." }
            ]
          }
        ],
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
      activeSessionId: "renderer-profile-draft-chat",
      sessions: [
        {
          id: "renderer-profile-draft-chat",
          title: "Renderer profile draft",
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
      sessionId: "renderer-profile-draft-chat",
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
const page = await browser.newPage({ viewport: { width: 560, height: 860 } });

try {
  const baseUrl = vite.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Vite did not expose a local URL.");
  }

  await page.goto(`${baseUrl}?daemonPort=${daemonPort}`);
  await page.getByRole("button", { name: "Activity details" }).click();
  await page.getByText("Computer Use", { exact: true }).waitFor();
  await page.selectOption('select[aria-label="Computer Use permission profile"]', existingProfile.id);
  await page.getByLabel("Selected permission profile details").getByText("Persistent browser smoke").waitFor();
  await page.getByLabel("Selected permission profile details").getByText(/persistent · scoped_yolo · active/).waitFor();
  await page.getByLabel("Selected permission profile details").getByText("high_risk").waitFor();
  await page.getByLabel("Selected permission profile details").getByText("never").waitFor();
  await page.getByLabel("Selected permission profile grant details").getByText("example.com").waitFor();
  await page.getByLabel("Selected permission profile grant details").getByText("node scripts/report.mjs").waitFor();
  await page.getByLabel("Selected permission profile grant details").getByText("C:\\Users\\Tony\\Documents\\Codex Outputs").waitFor();
  await page.getByLabel("Permission profile manager").getByText("2 total").waitFor();
  await page.getByLabel("Managed permission profile", { exact: true }).selectOption(disabledProfile.id);
  await page.getByLabel("Computer Use permission profile validation").getByText("Draft blocked").waitFor();
  await page.getByLabel("Computer Use permission profile JSON editor").fill(JSON.stringify({
    name: "Unsafe persistent profile",
    mode: "scoped_yolo",
    scope: "persistent",
    status: "active",
    maxUses: null,
    grants: {
      ...existingProfile.grants,
      credentialAccess: "ask",
      riskClasses: ["credential", "high_risk"]
    },
    safetyBoundaries: existingProfile.safetyBoundaries
  }, null, 2));
  await page.getByRole("button", { name: "Save managed permission profile" }).click();
  await page.getByText("Profile draft blocked").waitFor();
  await page.getByRole("button", { name: "New managed permission profile" }).click();
  await page.getByLabel("Computer Use permission profile validation").getByText("Draft allowed").waitFor();
  await page.getByRole("button", { name: "Save managed permission profile" }).click();
  await page.getByText("Profile created: Computer Use one-time profile").waitFor();
  assert.equal(managedCreatedProfileBody?.grants?.credentialAccess, "never");
  assert.equal(managedCreatedProfileBody?.grants?.riskClasses?.includes("read_only"), true);
  assert.equal(managedCreatedProfileBody?.grants?.browserAutomation, false);
  await page.getByRole("button", { name: "Disable selected permission profile" }).click();
  await page.getByText("Profile disabled: Persistent browser smoke").waitFor();
  assert.equal(updatedProfileBody?.status, "disabled");

  await page.getByText("Draft one-time profile").waitFor();
  await page.getByLabel("One-time permission profile draft").getByText("credentials never").waitFor();
  await page.getByLabel("One-time permission profile draft").getByText("risk high_risk").waitFor();
  await page.getByLabel("One-time permission profile draft").getByText("browser browser_chrome").waitFor();
  await page.getByRole("button", { name: /One-time/i }).click();
  await page.getByText("One-time profile attached").waitFor();

  assert.equal(createdProfileBody?.grants?.credentialAccess, "never");
  assert.equal(createdProfileBody?.grants?.browserAutomation, true);
  assert.equal(createdProfileBody?.grants?.riskClasses?.includes("high_risk"), true);
  assert.equal(attachedProfileBody?.profileId, "profile-one-time-renderer");

  console.log(`renderer Computer Use profile draft smoke ok on vite ${baseUrl} daemon ${daemonPort}`);
} finally {
  await browser.close();
  await vite.close();
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

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
