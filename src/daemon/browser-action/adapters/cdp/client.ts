import WebSocket from "ws";

export const CDP_ENV_KEYS = ["CODEX_WIDGET_BROWSER_ACTION_CDP_URL", "BROWSER_ACTION_CDP_URL", "CDP_URL"] as const;

export class CdpClient {
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

export async function openCdpClient(): Promise<CdpClient> {
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

export async function resolveCdpWebSocketUrl(endpoint: string): Promise<string> {
  if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) {
    return endpoint;
  }
  const base = endpoint.replace(/\/$/, "");
  const targets = await fetchJson<Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>>(`${base}/json/list`);
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
    ?? targets.find((target) => target.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) {
    const version = await fetchJson<{ webSocketDebuggerUrl?: string }>(`${base}/json/version`).catch(() => undefined);
    if (version?.webSocketDebuggerUrl) {
      return version.webSocketDebuggerUrl;
    }
    throw new Error("No debuggable page target was found at the CDP endpoint.");
  }
  return page.webSocketDebuggerUrl;
}

export async function evaluateCdp<T>(client: CdpClient, expression: string): Promise<T> {
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

export async function waitForCdpDomReady(client: CdpClient): Promise<void> {
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

export async function ensureCdpPageUrl(client: CdpClient, url?: string): Promise<void> {
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

export function readConfiguredCdpEndpoint(): string | undefined {
  for (const key of CDP_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function redactDebuggerUrl(value: string): string {
  return value.replace(/devtools\/page\/[^/?#]+/i, "devtools/page/<target>");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CDP endpoint returned ${response.status} for ${url}.`);
  }
  return await response.json() as T;
}
