import { buildBrowserObservation } from "../browserObservation.js";
import type { BrowserActionAdapter } from "../types.js";
import { executeCdpAction } from "./cdp/actions.js";
import {
  CDP_ENV_KEYS,
  ensureCdpPageUrl,
  evaluateCdp,
  openCdpClient,
  readConfiguredCdpEndpoint,
  redactDebuggerUrl,
  resolveCdpWebSocketUrl,
  waitForCdpDomReady
} from "./cdp/client.js";
import { collectSnapshotExpression } from "./cdp/snapshot.js";

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
        const captured = await client.send<{ data?: string }>("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: Boolean(input.action.fullPage)
        });
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
