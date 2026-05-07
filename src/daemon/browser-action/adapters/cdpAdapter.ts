import WebSocket from "ws";
import { buildBrowserObservation } from "../browserObservation.js";
import { inspectEvaluateCode } from "../evaluatePolicy.js";
import type { BrowserAction, BrowserActionAdapter, BrowserActionExecutionResult, BrowserExecuteInput } from "../types.js";

const CDP_ENV_KEYS = ["CODEX_WIDGET_BROWSER_ACTION_CDP_URL", "BROWSER_ACTION_CDP_URL", "CDP_URL"] as const;

export const cdpAdapter: BrowserActionAdapter = {
  id: "cdp",
  label: "Chrome DevTools Protocol",
  capabilities: ["observe_dom", "screenshot", "click", "type", "select", "scroll", "navigate", "tab_control", "console", "network", "evaluate"],
  async isAvailable() {
    const endpoint = readConfiguredCdpEndpoint();
    return endpoint ? Boolean(await resolveCdpWebSocketUrl(endpoint).catch(() => undefined)) : false;
  },
  async getStatus() {
    const endpoint = readConfiguredCdpEndpoint();
    if (!endpoint) {
      return {
        id: "cdp",
        label: "Chrome DevTools Protocol",
        state: "unavailable",
        capabilities: cdpAdapter.capabilities,
        detail: `Configure one of ${CDP_ENV_KEYS.join(", ")} with a Chrome/Edge remote debugging URL.`,
        checkedAt: new Date().toISOString()
      };
    }
    try {
      const wsUrl = await resolveCdpWebSocketUrl(endpoint);
      return {
        id: "cdp",
        label: "Chrome DevTools Protocol",
        state: "ready",
        capabilities: cdpAdapter.capabilities,
        detail: "CDP remote debugging endpoint is reachable.",
        checkedAt: new Date().toISOString(),
        diagnostics: { endpoint, webSocketUrl: redactDebuggerUrl(wsUrl) }
      };
    } catch (error) {
      return {
        id: "cdp",
        label: "Chrome DevTools Protocol",
        state: "error",
        capabilities: cdpAdapter.capabilities,
        detail: error instanceof Error ? error.message : "CDP endpoint check failed.",
        checkedAt: new Date().toISOString(),
        diagnostics: { endpoint }
      };
    }
  },
  async observe(input) {
    const client = await openCdpClient();
    try {
      await ensureCdpPageUrl(client, input.session.source.url);
      await waitForCdpDomReady(client);
      const snapshot = await evaluateCdp<Record<string, unknown>>(client, collectSnapshotExpression());
      return buildBrowserObservation({ source: input.session.source, snapshot });
    } finally {
      client.close();
    }
  },
  async execute(input) {
    const client = await openCdpClient();
    try {
      await ensureCdpPageUrl(client, input.observation.url || input.session.source.url);
      await waitForCdpDomReady(client);
      const before = await evaluateCdp<Record<string, unknown>>(client, collectSnapshotExpression());
      if (input.action.type === "screenshot") {
        await client.send("Page.enable");
        const captured = await client.send<{ data?: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: Boolean(input.action.fullPage) });
        const after = await evaluateCdp<Record<string, unknown>>(client, collectSnapshotExpression());
        after.screenshot = { dataUrl: `data:image/png;base64,${captured.data ?? ""}`, title: "CDP screenshot" };
        return { requestId: "cdp", adapterId: "cdp", ok: true, before, after };
      }
      const executed = await executeCdpAction(client, input);
      const after = await evaluateCdp<Record<string, unknown>>(client, collectSnapshotExpression());
      return {
        requestId: "cdp",
        adapterId: "cdp",
        ok: executed.ok,
        before,
        after,
        error: executed.error,
        metadata: executed.metadata
      };
    } finally {
      client.close();
    }
  }
};

class CdpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { id?: number; result?: unknown; error?: { message?: string } };
      if (typeof message.id !== "number") {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "CDP command failed."));
      } else {
        pending.resolve(message.result);
      }
    });
    ws.on("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("CDP socket closed."));
      }
      this.pending.clear();
    });
  }

  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params: params ?? {} });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.ws.send(payload, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function openCdpClient(): Promise<CdpClient> {
  const endpoint = readConfiguredCdpEndpoint();
  if (!endpoint) {
    throw new Error(`CDP adapter requires ${CDP_ENV_KEYS.join(" or ")}.`);
  }
  const wsUrl = await resolveCdpWebSocketUrl(endpoint);
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
    setTimeout(() => reject(new Error("Timed out connecting to CDP endpoint.")), 5_000).unref();
  });
  const client = new CdpClient(ws);
  await client.send("Runtime.enable");
  await client.send("Page.enable").catch(() => undefined);
  return client;
}

async function resolveCdpWebSocketUrl(endpoint: string): Promise<string> {
  if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) {
    return endpoint;
  }
  const base = endpoint.replace(/\/$/, "");
  const targets = await fetchJson<Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>>(`${base}/json/list`);
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) ?? targets.find((target) => target.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) {
    const version = await fetchJson<{ webSocketDebuggerUrl?: string }>(`${base}/json/version`).catch(() => undefined);
    if (version?.webSocketDebuggerUrl) {
      return version.webSocketDebuggerUrl;
    }
    throw new Error("No debuggable page target was found at the CDP endpoint.");
  }
  return page.webSocketDebuggerUrl;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CDP endpoint returned ${response.status} for ${url}.`);
  }
  return await response.json() as T;
}

async function evaluateCdp<T>(client: CdpClient, expression: string): Promise<T> {
  const result = await client.send<{ result?: { value?: unknown; unserializableValue?: string }; exceptionDetails?: { text?: string } }>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "CDP Runtime.evaluate failed.");
  }
  return result.result?.value as T;
}

async function waitForCdpDomReady(client: CdpClient): Promise<void> {
  await evaluateCdp<boolean>(client, `new Promise((resolve) => {
    if (document.readyState !== "loading") {
      resolve(true);
      return;
    }
    const done = () => resolve(true);
    document.addEventListener("DOMContentLoaded", done, { once: true });
    setTimeout(done, 2000);
  })`);
}

async function ensureCdpPageUrl(client: CdpClient, url?: string): Promise<void> {
  if (!url || !/^https?:\/\//i.test(url)) {
    return;
  }
  const current = await evaluateCdp<string>(client, "location.href").catch(() => "");
  if (current === url) {
    return;
  }
  await client.send("Page.navigate", { url });
  await waitForCdpDomReady(client);
}

async function executeCdpAction(client: CdpClient, input: BrowserExecuteInput): Promise<{ ok: boolean; error?: string; metadata?: Record<string, unknown> }> {
  if (input.action.type === "read") {
    return { ok: true };
  }
  if (input.action.type === "navigate") {
    await client.send("Page.navigate", { url: input.action.url });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { ok: true };
  }
  if (input.action.type === "back" || input.action.type === "forward" || input.action.type === "reload") {
    const browserAction = input.action.type === "back" ? "history.back()" : input.action.type === "forward" ? "history.forward()" : "location.reload()";
    await evaluateCdp(client, `(() => { ${browserAction}; return true; })()`);
    return { ok: true };
  }
  if (input.action.type === "evaluate") {
    const guard = inspectEvaluateCode(input.action);
    if (!guard.ok) {
      return { ok: false, error: guard.reason, metadata: { codeHash: guard.codeHash } };
    }
    const expression = `(() => {
      const target = ${JSON.stringify(input.target?.selector ?? "")} ? document.querySelector(${JSON.stringify(input.target?.selector ?? "")}) : document.activeElement;
      const fn = new Function("target", "return (async () => {\\n${escapeForNewFunction(input.action.code)}\\n})()");
      return Promise.resolve(fn(target)).then((value) => JSON.stringify(value).slice(0, ${guard.resultLimitBytes}));
    })()`;
    const value = await evaluateCdp<string>(client, expression);
    return { ok: true, metadata: { codeHash: guard.codeHash, resultPreview: value } };
  }
  const expression = executeDomActionExpression(input.action, input.target?.selector);
  return await evaluateCdp<{ ok: boolean; error?: string }>(client, expression);
}

function executeDomActionExpression(action: BrowserAction, selector?: string): string {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const selector = ${JSON.stringify(selector ?? "")};
    try {
      const target = selector ? document.querySelector(selector) : null;
      if (action.type === "scroll") {
        const pixels = typeof action.amount === "number" ? action.amount : action.amount === "small" ? 240 : action.amount === "large" ? 960 : 520;
        const x = action.direction === "left" ? -pixels : action.direction === "right" ? pixels : 0;
        const y = action.direction === "up" ? -pixels : action.direction === "down" ? pixels : 0;
        (target || window).scrollBy(x, y);
        return { ok: true };
      }
      if (!target) return { ok: false, error: "CDP action requires a selector-backed target." };
      if (action.type === "click") {
        target.scrollIntoView({ block: "center", inline: "center" });
        target.click();
        return { ok: true };
      }
      if (action.type === "type") {
        target.focus();
        if (!("value" in target) && !target.isContentEditable) return { ok: false, error: "Target is not editable." };
        if ("value" in target) target.value = action.clearFirst ? action.text : String(target.value || "") + action.text;
        else target.textContent = action.clearFirst ? action.text : String(target.textContent || "") + action.text;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      if (action.type === "select") {
        if (!(target instanceof HTMLSelectElement)) return { ok: false, error: "Target is not a select element." };
        target.value = action.value;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      if (action.type === "check") {
        if (!("checked" in target)) return { ok: false, error: "Target is not checkable." };
        target.checked = Boolean(action.checked);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      return { ok: false, error: "Unsupported CDP action type: " + action.type };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  })()`;
}

function collectSnapshotExpression(): string {
  return `(() => {
    const elements = Array.from(document.querySelectorAll("a[href],button,input,textarea,select,option,summary,label,[role],[aria-label],[title],[contenteditable='true'],[data-testid]"))
      .filter((element) => element instanceof HTMLElement)
      .slice(0, 220)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const input = element instanceof HTMLInputElement ? element : undefined;
        const selector = element.id ? "#" + CSS.escape(element.id) : element.getAttribute("data-testid") ? element.tagName.toLowerCase() + "[data-testid=\\"" + element.getAttribute("data-testid").replace(/"/g, "\\\\\\"") + "\\"]" : element.tagName.toLowerCase();
        return {
          id: element.id || element.getAttribute("data-testid") || "el-" + (index + 1),
          role: element.getAttribute("role") || undefined,
          tagName: element.tagName.toLowerCase(),
          label: String(element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 500) || undefined,
          text: String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 500) || undefined,
          value: input && !/password|hidden|token|secret|card|cc/.test(input.type.toLowerCase()) ? String(input.value || "").slice(0, 500) : undefined,
          selector,
          bbox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          visible: rect.width > 0 && rect.height > 0,
          enabled: !element.matches(":disabled,[aria-disabled='true']"),
          editable: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element.isContentEditable,
          checked: "checked" in element ? Boolean(element.checked) : undefined,
          selected: "selected" in element ? Boolean(element.selected) : undefined,
          href: element instanceof HTMLAnchorElement ? element.href || undefined : undefined,
          inputType: input ? input.type.toLowerCase() : undefined,
          confidence: 0.9,
          riskHints: []
        };
      });
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio, scrollX: window.scrollX, scrollY: window.scrollY },
      focusedElementId: undefined,
      selection: window.getSelection() ? window.getSelection().toString() : "",
      text: String(document.body && document.body.innerText || "").slice(0, 20000),
      elements
    };
  })()`;
}

function readConfiguredCdpEndpoint(): string | undefined {
  for (const key of CDP_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function escapeForNewFunction(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(/\n/g, "\\n");
}

function redactDebuggerUrl(value: string): string {
  return value.replace(/devtools\/page\/[^/?#]+/i, "devtools/page/<target>");
}
