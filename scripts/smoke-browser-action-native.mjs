import { nativeDesktopAdapter } from "../dist/daemon/browser-action/index.js";

const session = {
  id: "native-desktop-smoke",
  startedAt: new Date().toISOString(),
  source: { kind: "active_tab", browser: "unknown" },
  mode: "auto_safe_actions",
  status: "active",
  timeline: [],
  approvals: []
};

const status = await nativeDesktopAdapter.getStatus({ session });
if (status.diagnostics?.scope !== "browser_windows_only" || !status.diagnostics?.blocked?.requiredScopeExpansion) {
  throw new Error(`Native desktop diagnostics must expose bounded scope and helper blocker: ${JSON.stringify(status)}`);
}
if (process.platform !== "win32") {
  assertEqual(status.state, "unavailable", "native desktop non-windows status");
} else if (process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP === "1") {
  assertEqual(status.state, "ready", "native desktop enabled status");
  const observation = await nativeDesktopAdapter.observe({ session });
  if (!observation.title) {
    throw new Error(`Native desktop observation missing title: ${JSON.stringify(observation)}`);
  }
  const execute = await nativeDesktopAdapter.execute({
    session,
    observation,
    action: { type: "click", target: { kind: "focused" } }
  });
  assertEqual(execute.ok, false, "native desktop unsupported executable action");
  if (!String(execute.error).includes("BLOCKED") || !String(execute.error).includes("UI Automation")) {
    throw new Error(`Native desktop unsupported path should name BLOCKED UI Automation scope: ${execute.error}`);
  }
} else {
  assertEqual(status.state, "unavailable", "native desktop disabled status");
  if (!status.detail.includes("CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP")) {
    throw new Error(`Native desktop status should explain enable flag: ${status.detail}`);
  }
}

console.log(`browser action native smoke ok: ${status.state}`);

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
