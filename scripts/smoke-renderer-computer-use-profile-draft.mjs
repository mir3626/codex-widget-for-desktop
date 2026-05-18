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
  expiresAt: "2999-05-16T05:00:00.000Z",
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
let credentialCreatedProfileBody = null;
let yoloCreatedProfileBody = null;
let superYoloCreatedProfileBody = null;
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
    const createdId = body.name === "One-time credential consent smoke"
      ? "profile-credential-renderer"
      : body.name === "Computer Use YOLO one-time profile"
      ? "profile-yolo-renderer"
      : body.name === "Computer Use SUPER-YOLO one-time profile"
      ? "profile-super-yolo-renderer"
      : body.name === "Computer Use one-time profile"
      ? "profile-managed-renderer"
      : "profile-one-time-renderer";
    if (createdId === "profile-credential-renderer") {
      credentialCreatedProfileBody = body;
    } else if (createdId === "profile-yolo-renderer") {
      yoloCreatedProfileBody = body;
      assert.equal(body.mode, "scoped_yolo");
      assert.equal(body.scope, "one_time");
      assert.equal(body.maxUses, 1);
      assert.equal(body.grants.credentialAccess, "never");
      assert.equal(body.grants.browserAutomation, true);
      assert.equal(body.grants.browserDomains.includes("*"), true);
      assert.equal(body.grants.generatedToolMaterialization, true);
      assert.equal(body.grants.generatedToolExecution, true);
      assert.equal(body.grants.generatedCode, true);
      assert.equal(body.grants.osMutation, false);
      assert.equal(body.grants.packageInstall, false);
      assert.equal(body.grants.riskClasses.includes("high_risk"), true);
      assert.equal(body.grants.redactionPolicy.cookies, "never_store");
      assert.equal(body.safetyBoundaries.includes("captcha_bypass_is_blocked"), true);
    } else if (createdId === "profile-super-yolo-renderer") {
      superYoloCreatedProfileBody = body;
      assert.equal(body.mode, "scoped_yolo");
      assert.equal(body.scope, "one_time");
      assert.equal(body.maxUses, 1);
      assert.equal(body.grants.credentialAccess, "never");
      assert.equal(body.grants.browserAutomation, true);
      assert.equal(body.grants.browserDomains.includes("*"), true);
      assert.equal(body.grants.network, true);
      assert.equal(body.grants.networkDomains.includes("*"), true);
      assert.equal(body.grants.generatedToolMaterialization, true);
      assert.equal(body.grants.generatedToolExecution, true);
      assert.equal(body.grants.generatedCode, true);
      assert.equal(body.grants.osMutation, false);
      assert.equal(body.grants.packageInstall, true);
      assert.equal(body.grants.packageAllowlist.includes("*"), true);
      assert.equal(body.grants.commands.allowPrefixes.includes("powershell *"), true);
      assert.equal(body.grants.filesystem.readRoots.includes("C:\\Users"), true);
      assert.equal(body.grants.riskClasses.includes("high_risk"), true);
      assert.equal(body.grants.riskClasses.includes("credential"), false);
      assert.equal(body.grants.commands.denyPatterns.includes("captcha"), false);
      assert.equal(body.grants.commands.denyPatterns.includes("cookie"), false);
      assert.equal(body.grants.commands.denyPatterns.includes("payment"), false);
      assert.equal(body.grants.commands.denyPatterns.includes("purchase"), false);
      assert.equal(body.safetyBoundaries.includes("super_yolo_requires_user_confirmation"), true);
      assert.equal(body.safetyBoundaries.includes("credential_cookie_captcha_boundary_released_by_user"), true);
      assert.equal(body.safetyBoundaries.includes("payment_purchase_boundary_released_by_user"), true);
      assert.equal(body.safetyBoundaries.some((boundary) => boundary.includes("credential_cookie_captcha_override_acknowledged")), true);
      assert.equal(body.safetyBoundaries.some((boundary) => boundary.includes("payment_purchase_override_acknowledged")), true);
      assert.equal(body.safetyBoundaries.includes("credential_cookie_captcha_override_default_off"), false);
      assert.equal(body.safetyBoundaries.includes("payment_purchase_override_default_off"), false);
    } else if (createdId === "profile-managed-renderer") {
      managedCreatedProfileBody = body;
      assert.equal(body.grants.credentialAccess, "never");
      assert.equal(body.grants.riskClasses.includes("credential"), false);
      assert.equal(body.grants.browserAutomation, false);
      assert.equal(body.grants.riskClasses.includes("read_only"), true);
    } else {
      createdProfileBody = body;
      assert.equal(body.grants.credentialAccess, "never");
      assert.equal(body.grants.riskClasses.includes("credential"), false);
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
page.setDefaultNavigationTimeout(90000);

try {
  const baseUrl = vite.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Vite did not expose a local URL.");
  }

  await page.goto(`${baseUrl}?daemonPort=${daemonPort}`, { waitUntil: "domcontentloaded" });
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
  await page.getByLabel("Computer Use permission profile JSON editor").fill(JSON.stringify({
    name: "One-time credential consent smoke",
    mode: "scoped_yolo",
    scope: "one_time",
    status: "active",
    maxUses: 1,
    grants: {
      ...existingProfile.grants,
      credentialAccess: "ask",
      credentialLeases: [
        {
          id: "renderer-credential-lease",
          status: "active",
          scope: "site_session",
          domains: ["example.com"],
          purposes: ["renderer validation smoke"],
          vaultRefs: [],
          expiresAt: "2999-01-01T00:00:00.000Z"
        }
      ],
      redactionPolicy: {
        credentials: "redact",
        cookies: "never_store",
        localPaths: "basename_or_hash",
        browserHistory: "domain_only",
        screenshots: "metadata_only",
        debugBundles: "redacted_summary",
        semanticMemory: "no_secret_values"
      },
      riskClasses: ["credential"]
    },
    safetyBoundaries: existingProfile.safetyBoundaries
  }, null, 2));
  await page.getByLabel("Computer Use permission profile validation").getByText("Draft allowed").waitFor();
  await page.getByRole("button", { name: "Save managed permission profile" }).click();
  await page.getByText("Profile created: One-time credential consent smoke").waitFor();
  assert.equal(credentialCreatedProfileBody?.grants?.credentialAccess, "ask");
  assert.equal(credentialCreatedProfileBody?.grants?.riskClasses?.includes("credential"), true);
  assert.equal(credentialCreatedProfileBody?.grants?.credentialLeases?.[0]?.id, "renderer-credential-lease");
  assert.equal(credentialCreatedProfileBody?.grants?.credentialLeases?.[0]?.status, "active");
  assert.equal(credentialCreatedProfileBody?.grants?.redactionPolicy?.cookies, "never_store");
  await page.getByRole("button", { name: "New Computer Use YOLO profile" }).click();
  await page.getByText("Computer Use YOLO one-time profile draft ready.").waitFor();
  await page.getByLabel("Computer Use permission profile validation").getByText("Draft allowed").waitFor();
  await page.getByLabel("Computer Use permission profile validation").getByText("risk read_only, reversible, side_effect, high_risk").waitFor();
  assert.equal((await page.getByLabel("Computer Use permission profile JSON editor").inputValue()).includes("captcha_bypass_is_blocked"), true);
  await page.getByRole("button", { name: "Save managed permission profile" }).click();
  await page.getByText("Profile created: Computer Use YOLO one-time profile").waitFor();
  assert.equal(yoloCreatedProfileBody?.grants?.credentialAccess, "never");
  assert.equal(yoloCreatedProfileBody?.grants?.browserDomains?.includes("*"), true);
  assert.equal(yoloCreatedProfileBody?.grants?.riskClasses?.includes("side_effect"), true);
  assert.equal(yoloCreatedProfileBody?.grants?.riskClasses?.includes("high_risk"), true);
  const superDialogPromise = page.waitForEvent("dialog");
  const superClickPromise = page.getByRole("button", { name: "Activate Computer Use SUPER-YOLO profile" }).click();
  const superDialog = await superDialogPromise;
  assert.match(superDialog.message(), /SUPER-YOLO creates a one-time profile/);
  await superDialog.accept();
  await superClickPromise;
  await page.getByText("Computer Use SUPER-YOLO one-time profile draft ready.").waitFor();
  await page.getByLabel("SUPER-YOLO permission toggles").getByText("SUPER-YOLO grants").waitFor();
  const credentialCookieCaptchaToggle = page.getByRole("checkbox", { name: /Credential \/ Cookie \/ CAPTCHA/ });
  const paymentPurchaseToggle = page.getByRole("checkbox", { name: /Payment \/ Purchase/ });
  assert.equal(await credentialCookieCaptchaToggle.isChecked(), false);
  assert.equal(await paymentPurchaseToggle.isChecked(), false);
  const superDraftDefault = await page.getByLabel("Computer Use permission profile JSON editor").inputValue();
  assert.equal(superDraftDefault.includes("credential_cookie_captcha_override_default_off"), true);
  assert.equal(superDraftDefault.includes("payment_purchase_override_default_off"), true);
  assert.equal(superDraftDefault.includes("credential_cookie_captcha_override_requires_user_acknowledgement"), true);
  assert.equal(superDraftDefault.includes("payment_purchase_override_requires_user_acknowledgement"), true);
  await page.getByRole("checkbox", { name: /OS mutation/ }).uncheck();
  assert.equal((await page.getByLabel("Computer Use permission profile JSON editor").inputValue()).includes('"osMutation": false'), true);
  await page.getByRole("checkbox", { name: /Packages/ }).uncheck();
  assert.equal((await page.getByLabel("Computer Use permission profile JSON editor").inputValue()).includes('"packageInstall": false'), true);
  await page.getByRole("checkbox", { name: /Packages/ }).check();
  await credentialCookieCaptchaToggle.check();
  await paymentPurchaseToggle.check();
  const superDraftReleased = await page.getByLabel("Computer Use permission profile JSON editor").inputValue();
  assert.equal(superDraftReleased.includes("credential_cookie_captcha_boundary_released_by_user"), true);
  assert.equal(superDraftReleased.includes("payment_purchase_boundary_released_by_user"), true);
  assert.equal(superDraftReleased.includes("credential_cookie_captcha_override_acknowledged"), true);
  assert.equal(superDraftReleased.includes("payment_purchase_override_acknowledged"), true);
  assert.equal(superDraftReleased.includes("captcha_bypass_is_blocked"), false);
  assert.equal(superDraftReleased.includes("purchase_payment_submit_require_explicit_user_commit"), false);
  await page.getByRole("button", { name: "Save managed permission profile" }).click();
  await page.getByText("Profile created: Computer Use SUPER-YOLO one-time profile").waitFor();
  assert.equal(superYoloCreatedProfileBody?.grants?.credentialAccess, "never");
  assert.equal(superYoloCreatedProfileBody?.grants?.packageInstall, true);
  assert.equal(superYoloCreatedProfileBody?.grants?.osMutation, false);
  assert.equal(superYoloCreatedProfileBody?.grants?.browserDomains?.includes("*"), true);
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
