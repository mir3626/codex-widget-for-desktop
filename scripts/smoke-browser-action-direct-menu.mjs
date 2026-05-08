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
      { mode: "screen", label: "Vision", state: "ready", detail: "ready", capabilities: [] },
      { mode: "terminal", label: "PTY", state: "ready", detail: "ready", capabilities: [] }
    ]
  }));
  socket.send(JSON.stringify({
    type: "session.snapshot",
    snapshot: {
      activeSessionId: "browser-action-direct-menu-session",
      sessions: [
        {
          id: "browser-action-direct-menu-session",
          title: "Browser Action direct menu smoke",
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
    snapshot: { sessionId: "browser-action-direct-menu-session", artifacts: [], activities: [], providerSnapshots: [] }
  }));
  socket.send(JSON.stringify({
    type: "browserAction.started",
    actionSessionId: "direct-menu-browser-action",
    summary: { mode: "auto_safe_actions" }
  }));
  socket.send(JSON.stringify({
    type: "browserAction.adapters",
    actionSessionId: "direct-menu-browser-action",
    adapters: [
      { id: "extension", label: "Browser extension active tab", state: "ready", detail: "active tab connected", capabilities: ["observe_dom", "click", "type"], checkedAt: "2026-05-08T00:00:00.000Z" },
      { id: "playwright", label: "Playwright controlled browser", state: "ready", detail: "managed browser available", capabilities: ["observe_dom", "click", "type"], checkedAt: "2026-05-08T00:00:00.000Z" },
      { id: "cdp", label: "CDP remote debugging", state: "unavailable", detail: "CDP endpoint is not configured.", capabilities: ["observe_dom"], checkedAt: "2026-05-08T00:00:00.000Z" },
      { id: "native-desktop", label: "Windows native fallback", state: "unavailable", detail: "UIA helper is not installed.", capabilities: [], checkedAt: "2026-05-08T00:00:00.000Z" }
    ]
  }));
  socket.send(JSON.stringify({
    type: "browserExtensionBridge.status",
    status: {
      connected: true,
      mode: "idle",
      updatedAt: "2026-05-08T00:00:00.000Z",
      activeTab: {
        tabId: 17,
        windowId: 3,
        url: "https://example.test/direct-menu",
        title: "Direct menu smoke",
        origin: "https://example.test/*",
        permission: "allowed"
      },
      nativeHost: "enabled"
    }
  }));
  socket.send(JSON.stringify({ type: "browserAction.policies", policies: [] }));

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    clientMessages.push(message);
    if (message.type === "browserAction.command" && message.command?.kind === "adapter_status") {
      socket.send(JSON.stringify({
        type: "browserAction.adapters",
        actionSessionId: message.command.actionSessionId,
        adapters: [
          { id: "extension", label: "Browser extension active tab", state: "ready", detail: "refreshed", capabilities: ["observe_dom", "click"], checkedAt: "2026-05-08T00:00:01.000Z" }
        ]
      }));
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
  await page.goto(`http://127.0.0.1:${viteAddress.port}/?daemonPort=${daemonPort}&mode=browser`);
  await page.locator(".mode-row").getByRole("button", { name: "Browser" }).click();
  await page.locator(".browser-action-menu").waitFor();
  await expectMenuText(page, "Browser Bridge");
  await expectMenuText(page, "Browser connected");
  await expectMenuText(page, "Direct menu smoke");
  await page.getByRole("button", { name: "Advanced diagnostics" }).click();
  await expectMenuText(page, "Browser extension active tab");
  await expectMenuText(page, "Playwright controlled browser");
  await expectMenuText(page, "CDP endpoint is not configured.");
  await expectMenuText(page, "UIA helper is not installed.");

  await page.getByRole("menuitem", { name: "Adapter status" }).click();
  await page.getByRole("menuitem", { name: "Observe state" }).click();
  await page.getByRole("menuitem", { name: "Explain page" }).click();
  await page.getByLabel("Browser Action target").fill("Open details");
  await page.getByLabel("Browser Action text").fill("codex widget");
  await page.getByRole("menuitem", { name: "Click target" }).click();
  await page.getByRole("menuitem", { name: "Type field" }).click();
  await page.getByRole("menuitem", { name: "Search" }).click();
  await page.getByLabel("Browser Action URL").fill("example.com");
  await page.getByRole("menuitem", { name: "Navigate URL" }).click();
  await page.getByRole("menuitem", { name: "Scroll down" }).click();

  await waitUntil(() => hasCommand("adapter_status"), "Adapter status command was not sent.");
  await waitUntil(() => hasCommand("observe"), "Observe command was not sent.");
  await waitUntil(() => hasCommand("read"), "Read command was not sent.");
  await waitUntil(() => hasCommand("click", (command) => command.targetText === "Open details"), "Click command did not include target text.");
  await waitUntil(() => hasCommand("type", (command) => command.text === "codex widget"), "Type command did not include text.");
  await waitUntil(() => hasCommand("search", (command) => command.text === "codex widget"), "Search command did not include text.");
  await waitUntil(() => hasCommand("navigate", (command) => command.url === "example.com"), "Navigate command did not include URL.");
  await waitUntil(() => hasCommand("scroll", (command) => command.direction === "down"), "Scroll command did not include direction.");
  console.log(`browser action direct menu smoke ok on port ${daemonPort}`);
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

function hasCommand(kind, predicate = () => true) {
  return clientMessages.some((message) => message.type === "browserAction.command" && message.command?.kind === kind && predicate(message.command));
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
