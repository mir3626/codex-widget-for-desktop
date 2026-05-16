import { buildBrowserObservation } from "../browserObservation.js";
import type { BrowserActionAdapter } from "../types.js";
import { executeOnPlaywrightPage } from "./playwright/actions.js";
import { openPlaywrightPage, safeLoadPlaywright } from "./playwright/runtime.js";
import { collectPlaywrightSnapshot } from "./playwright/snapshot.js";

export const playwrightAdapter: BrowserActionAdapter = {
  id: "playwright",
  label: "Playwright controlled browser",
  capabilities: ["observe_dom", "screenshot", "click", "type", "select", "scroll", "navigate", "tab_control", "evaluate"],
  async isAvailable() {
    return Boolean(await safeLoadPlaywright());
  },
  async getStatus() {
    const api = await safeLoadPlaywright();
    if (!api) {
      return {
        id: "playwright",
        label: "Playwright controlled browser",
        state: "unavailable",
        capabilities: playwrightAdapter.capabilities,
        detail: "@playwright/test is not installed or cannot be loaded.",
        checkedAt: new Date().toISOString()
      };
    }
    return {
      id: "playwright",
      label: "Playwright controlled browser",
      state: "ready",
      capabilities: playwrightAdapter.capabilities,
      detail: "Playwright can launch a controlled Chromium browser.",
      checkedAt: new Date().toISOString(),
      diagnostics: { executablePath: api.chromium.executablePath() }
    };
  },
  async observe(input) {
    const pageSession = await openPlaywrightPage(input);
    try {
      const snapshot = await collectPlaywrightSnapshot(pageSession.page);
      return buildBrowserObservation({ source: input.session.source, snapshot });
    } finally {
      await pageSession.close();
    }
  },
  async execute(input) {
    const pageSession = await openPlaywrightPage({
      session: input.session,
      providerState: { url: input.observation.url }
    });
    try {
      const before = await collectPlaywrightSnapshot(pageSession.page);
      if (input.action.type === "screenshot") {
        const buffer = await pageSession.page.screenshot({
          fullPage: Boolean(input.action.fullPage),
          type: "png"
        });
        const after = await collectPlaywrightSnapshot(pageSession.page);
        after.screenshot = { dataUrl: `data:image/png;base64,${buffer.toString("base64")}`, title: "Playwright screenshot" };
        return { requestId: "playwright", adapterId: "playwright", ok: true, before, after };
      }
      const actionResult = await executeOnPlaywrightPage(pageSession.page, input);
      const after = await collectPlaywrightSnapshot(pageSession.page);
      return {
        requestId: "playwright",
        adapterId: "playwright",
        ok: actionResult.ok,
        before,
        after,
        error: actionResult.error,
        metadata: actionResult.metadata
      };
    } finally {
      await pageSession.close();
    }
  }
};
