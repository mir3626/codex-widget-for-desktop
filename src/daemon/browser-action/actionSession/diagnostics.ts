import type { BrowserActionSession } from "../types.js";

export function createDiagnosticSession(): BrowserActionSession {
  return {
    id: "browser-action-adapter-diagnostics",
    startedAt: new Date().toISOString(),
    source: { kind: "active_tab", browser: "unknown" },
    mode: "auto_safe_actions",
    status: "active",
    timeline: [],
    approvals: []
  };
}
