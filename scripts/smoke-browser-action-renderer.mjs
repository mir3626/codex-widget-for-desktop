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
      { mode: "browser", label: "Browser Bridge", state: "ready", detail: "bridge ready", capabilities: ["browser-bridge"] },
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
  socket.send(JSON.stringify({
    type: "browserAction.diagnostics",
    actionSessionId: "renderer-browser-action",
    diagnostics: {
      schemaVersion: "browser-action-diagnostics.v1",
      transactionId: "tx-renderer",
      timingSummary: { transaction_started: 0, candidates_generated: 120, phase_completed: 240 }
    }
  }));
  socket.send(JSON.stringify({
    type: "browserExtensionBridge.status",
    status: {
      connected: true,
      mode: "idle",
      updatedAt: "2026-05-08T00:00:00.000Z",
      activeTab: {
        tabId: 42,
        windowId: 4,
        url: "https://example.test/renderer",
        title: "Renderer Smoke",
        origin: "https://example.test/*",
        permission: "allowed"
      },
      nativeHost: "enabled"
    }
  }));
  socket.send(JSON.stringify({
    type: "interaction.required",
    interaction: {
      id: "browser-target-clarification-renderer",
      kind: "input",
      title: "Browser target clarification",
      body: "Browser Action 대상이 애매합니다. 실행할 대상을 선택하면 같은 요청을 이어서 수행합니다.",
      action: "Browser action: click",
      fields: [{ id: "choice", label: "Target", placeholder: "1" }],
      choices: [
        {
          id: "candidate-1",
          label: "1. 링크: 공지",
          value: "1",
          description: "영역: main/본문 · 위치: 상단 중앙",
          detail: "요소 신뢰도: 65%",
          visual: { kind: "bbox", bbox: { x: 440, y: 90, w: 180, h: 28 }, viewport: { width: 1024, height: 768 }, region: "main/본문" }
        },
        {
          id: "candidate-2",
          label: "2. 링크: 일반 게시글",
          value: "2",
          description: "영역: content-list/본문 · 위치: 중단 중앙",
          detail: "요소 신뢰도: 82%",
          visual: { kind: "bbox", bbox: { x: 420, y: 360, w: 220, h: 32 }, viewport: { width: 1024, height: 768 }, region: "content-list/본문" }
        }
      ]
    }
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
  await waitUntil(async () => (await page.locator(".browser-action-panel").count()) === 0, "Idle Browser Bridge panel should stay out of the chat top.");
  await page.locator(".interaction-card").waitFor();
  await waitUntil(async () => (await page.locator(".interaction-choice-list button").count()) === 2, "Clarification choices did not render as selectable cards.");
  await waitUntil(async () => (await page.locator(".interaction-target-preview").count()) === 2, "Clarification target previews did not render.");
  await page.locator(".interaction-choice-list button").nth(1).click();
  await waitUntil(
    () => clientMessages.some((message) =>
      message.type === "interaction.respond" &&
      message.id === "browser-target-clarification-renderer" &&
      message.decision === "submit" &&
      message.answers?.choice === "2"
    ),
    "Clarification choice card did not submit the selected target."
  );
  await page.locator(".mode-row").getByRole("button", { name: "Browser" }).click();
  await page.locator(".browser-action-menu").waitFor();
  await expectMenuText(page, "Browser connected");
  await expectMenuText(page, "Renderer Smoke");
  await expectMenuText(page, "Explain page");
  await page.getByRole("button", { name: "Advanced diagnostics" }).click();
  await expectMenuText(page, "Browser extension active tab");
  await expectMenuText(page, "CDP remote debugging");
  await expectMenuText(page, "Auto safe");
  await expectMenuText(page, "1 saved browser policy");
  await page.getByRole("button", { name: "Deny risky" }).click();
  await waitUntil(() => clientMessages.some((message) => message.type === "browserAction.policy.set" && message.policy?.decision === "deny"), "Renderer policy button did not send policy update.");
  console.log(`browser action renderer smoke ok on port ${daemonPort}`);
} finally {
  await browser.close();
  await vite.close();
  daemon.close();
}

async function expectMenuText(page, text) {
  await waitUntil(async () => {
    const content = await page.locator(".browser-action-menu").evaluate((node) => node.textContent ?? "");
    return content.includes(text);
  }, `Browser Action menu did not contain ${JSON.stringify(text)}.`);
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
