import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { WebSocketServer } from "ws";

const daemon = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise((resolve) => daemon.once("listening", resolve));
const daemonAddress = daemon.address();
if (!daemonAddress || typeof daemonAddress === "string") {
  throw new Error("Fake daemon did not bind.");
}
const daemonPort = daemonAddress.port;
const clientMessages = [];

daemon.on("connection", (socket) => {
  socket.send(JSON.stringify({
    type: "connected",
    daemon: {
      port: daemonPort,
      model: "mock",
      liveModel: true,
      auth: { mode: "mock", configured: true, authenticated: true, signInAvailable: false, signInMethod: null }
    }
  }));
  socket.send(JSON.stringify({
    type: "provider.status",
    providers: [
      { mode: "agent", label: "Agent", state: "ready", detail: "ready", capabilities: [] },
      { mode: "browser", label: "DOM", state: "ready", detail: "snapshot ready", capabilities: ["dom"] },
      { mode: "screen", label: "Vision", state: "stub", detail: "waiting", capabilities: [] },
      { mode: "terminal", label: "PTY", state: "ready", detail: "ready", capabilities: [] }
    ]
  }));
  socket.send(JSON.stringify({
    type: "session.snapshot",
    snapshot: {
      activeSessionId: "browser-action-renderer-session",
      sessions: [
        {
          id: "browser-action-renderer-session",
          title: "Browser Action renderer smoke",
          status: "active",
          createdAt: "2026-05-08T00:00:00.000Z",
          updatedAt: "2026-05-08T00:00:00.000Z",
          activeModel: "gpt-5.5",
          activeReasoning: "medium",
          activeMode: "browser",
          messageCount: 0
        }
      ],
      trashedSessions: [],
      messages: []
    }
  }));
  socket.send(JSON.stringify({
    type: "ledger.snapshot",
    snapshot: { sessionId: "browser-action-renderer-session", artifacts: [], activities: [], providerSnapshots: [] }
  }));
  socket.send(JSON.stringify({
    type: "browserAction.started",
    actionSessionId: "renderer-browser-action",
    summary: { mode: "auto_safe_actions" }
  }));
  socket.send(JSON.stringify({
    type: "browserAction.adapters",
    actionSessionId: "renderer-browser-action",
    adapters: [
      { id: "extension", label: "Browser extension active tab", state: "ready", detail: "active tab connected", capabilities: ["observe_dom", "click", "type"], checkedAt: "2026-05-08T00:00:00.000Z" },
      { id: "cdp", label: "CDP remote debugging", state: "unavailable", detail: "CDP endpoint is not configured.", capabilities: ["observe_dom"], checkedAt: "2026-05-08T00:00:00.000Z" }
    ]
  }));
  socket.send(JSON.stringify({
    type: "browserAction.policies",
    policies: [
      {
        id: "policy-renderer-safe",
        decision: "allow",
        actionFamily: "safe_click_type",
        origin: "https://example.test",
        targetRisk: "low",
        mode: "any",
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z"
      }
    ]
  }));
  socket.send(JSON.stringify({
    type: "browserAction.observation",
    actionSessionId: "renderer-browser-action",
    observationSummary: { url: "https://example.test", title: "Renderer Smoke", elements: 3, capturedAt: "2026-05-08T00:00:00.000Z" }
  }));
  socket.send(JSON.stringify({
    type: "browserAction.plan",
    actionSessionId: "renderer-browser-action",
    plan: {
      id: "renderer-plan",
      status: "completed",
      summary: "Renderer smoke plan completed.",
      steps: [{ id: "step-1", action: "read", status: "succeeded", safety: "allow", risk: "low" }]
    }
  }));
  socket.send(JSON.stringify({
    type: "browserAction.result",
    actionSessionId: "renderer-browser-action",
    result: { id: "renderer-result", action: "read", status: "succeeded", safety: "allow", verification: "passed" }
  }));

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    clientMessages.push(message);
    if (message.type === "browserAction.policy.set") {
      socket.send(JSON.stringify({ type: "browserAction.policies", policies: [{ ...message.policy, id: "policy-renderer-updated", createdAt: "2026-05-08T00:00:00.000Z", updatedAt: "2026-05-08T00:00:00.000Z" }] }));
    }
  });
});

const vite = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false } });
await vite.listen();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 820 } });

try {
  const viteAddress = vite.httpServer?.address();
  if (!viteAddress || typeof viteAddress === "string") {
    throw new Error("Vite did not bind.");
  }
  await page.goto(`http://127.0.0.1:${viteAddress.port}/?daemonPort=${daemonPort}`);
  const panel = page.getByRole("region", { name: "Browser Action" });
  await panel.waitFor({ state: "visible" });
  await expectPanelText(page, "Browser Action");
  await expectPanelText(page, "Browser extension active tab");
  await expectPanelText(page, "CDP remote debugging");
  await expectPanelText(page, "auto_safe_actions");
  await expectPanelText(page, "Renderer smoke plan completed.");
  await expectPanelText(page, "renderer-result");
  await expectPanelText(page, "1 saved browser policy");
  await page.getByRole("button", { name: "Deny risky" }).click();
  await waitUntil(() => clientMessages.some((message) => message.type === "browserAction.policy.set" && message.policy?.decision === "deny"), "Renderer policy button did not send policy update.");
  console.log(`browser action renderer smoke ok on port ${daemonPort}`);
} finally {
  await browser.close();
  await vite.close();
  daemon.close();
}

async function expectPanelText(page, text) {
  await waitUntil(async () => {
    const content = await page.locator(".browser-action-panel").evaluate((node) => node.textContent ?? "");
    return content.includes(text);
  }, `Browser Action panel did not contain ${JSON.stringify(text)}.`);
}

async function waitUntil(predicate, message) {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > 5_000) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
