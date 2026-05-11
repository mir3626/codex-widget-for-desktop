import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

await assertNativeHelperContract();

console.log(`browser action native smoke ok: ${status.state}`);

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

async function assertNativeHelperContract() {
  const previousEnabled = process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP;
  const previousHelper = process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER;
  const tempDir = mkdtempSync(join(tmpdir(), "browser-native-helper-smoke-"));
  const helperPath = join(tempDir, "mock-helper.mjs");
  writeFileSync(
    helperPath,
    `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  if (request.action?.value && /secret/i.test(String(request.action.value))) {
    process.stdout.write(JSON.stringify({ ok: false, error: "mock helper refuses secret values" }));
    return;
  }
  const observation = {
    url: "browser://native-helper-smoke",
    title: "Native Helper Smoke",
    text: "Native helper observed a browser chrome fallback surface.",
    elements: [
      { id: "tab-back", role: "button", tagName: "button", label: "Back", text: "Back", selector: "uia:back", visible: true, enabled: true, editable: false, confidence: 0.9 }
    ]
  };
  if (request.command === "observe") {
    process.stdout.write(JSON.stringify({ ok: true, observation, metadata: { mockCommand: "observe" } }));
    return;
  }
  if (request.command === "execute") {
    process.stdout.write(JSON.stringify({ ok: true, after: observation, metadata: { mockCommand: "execute", actionType: request.action.type } }));
    return;
  }
  process.stdout.write(JSON.stringify({ ok: true, metadata: { mockCommand: request.command } }));
});
`,
    "utf8"
  );
  try {
    process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP = "1";
    process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER = helperPath;
    const helperStatus = await nativeDesktopAdapter.getStatus({ session });
    if (process.platform === "win32") {
      assertEqual(helperStatus.state, "ready", "native helper status");
      if (helperStatus.diagnostics?.helper?.exists !== true) {
        throw new Error(`Native helper status should report configured helper: ${JSON.stringify(helperStatus)}`);
      }
    }
    const observation = await nativeDesktopAdapter.observe({ session });
    assertEqual(observation.title, "Native Helper Smoke", "native helper observation title");
    const execute = await nativeDesktopAdapter.execute({
      session,
      observation,
      action: { type: "click", target: { kind: "selector", selector: "uia:back" } },
      target: observation.elements[0]
    });
    assertEqual(execute.ok, true, "native helper executable action");
    assertEqual(execute.metadata?.helperConfigured, true, "native helper metadata");
    assertEqual(execute.metadata?.helperAction, "click", "native helper action metadata");
    if (execute.after?.title !== "Native Helper Smoke") {
      throw new Error(`Native helper should return after observation evidence: ${JSON.stringify(execute)}`);
    }
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP;
    } else {
      process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP = previousEnabled;
    }
    if (previousHelper === undefined) {
      delete process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER;
    } else {
      process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER = previousHelper;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}
