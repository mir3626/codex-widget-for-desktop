import { buildBrowserObservation } from "../browserObservation.js";
import type { BrowserActionAdapter, BrowserActionExecutionResult } from "../types.js";

export const extensionAdapter: BrowserActionAdapter = {
  id: "extension",
  label: "Browser DOM Extension",
  capabilities: ["observe_dom", "screenshot", "click", "type", "select", "scroll", "navigate", "tab_control", "evaluate"],
  async isAvailable() {
    return true;
  },
  async getStatus() {
    return {
      id: "extension",
      label: "Browser DOM Extension",
      state: "ready",
      capabilities: extensionAdapter.capabilities,
      detail: "Extension queue path is available when the browser extension polls the daemon.",
      checkedAt: new Date().toISOString(),
      diagnostics: { transport: "daemon-http-poll" }
    };
  },
  async observe(input) {
    return buildBrowserObservation({ source: input.session.source, snapshot: input.providerState });
  },
  async execute(): Promise<BrowserActionExecutionResult> {
    return {
      requestId: "",
      ok: false,
      error: "Extension actions are delivered through the daemon extension command queue."
    };
  }
};
