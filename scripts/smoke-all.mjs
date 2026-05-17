import { spawn } from "node:child_process";

const includeLive = process.argv.includes("--include-live");

const steps = [
  npmStep("lint"),
  npmStep("build:web"),
  ["Capability runtime", process.execPath, ["scripts/smoke-capability-runtime.mjs"]],
  ["Browser Chrome capability", process.execPath, ["scripts/smoke-browser-chrome-capability.mjs"]],
  ["OCR capability", process.execPath, ["scripts/smoke-ocr-capability.mjs"]],
  ["Terminal capability", process.execPath, ["scripts/smoke-terminal-capability.mjs"]],
  ["Agent tool capability", process.execPath, ["scripts/smoke-agent-tool-capability.mjs"]],
  ["Storage foundation", process.execPath, ["scripts/smoke-storage.mjs"]],
  ["daemon stream", process.execPath, ["scripts/smoke-daemon.mjs"]],
  ["daemon reconnect replay", process.execPath, ["scripts/smoke-daemon-reconnect.mjs"]],
  ["Codex app-server bridge", process.execPath, ["scripts/smoke-codex-app-server.mjs"]],
  ["DOM provider", process.execPath, ["scripts/smoke-dom-provider.mjs"]],
  ["Architecture foundations", process.execPath, ["scripts/smoke-architecture-foundations.mjs"]],
  ["Research performance architecture", process.execPath, ["scripts/smoke-research-performance-architecture.mjs"]],
  ["Scoped autonomy toolsmith", process.execPath, ["scripts/smoke-scoped-autonomy-toolsmith.mjs"]],
  ["Scoped autonomy self-implementation", process.execPath, ["scripts/smoke-scoped-autonomy-self-implementation.mjs"]],
  ["Scoped autonomy npm dependency prepare", process.execPath, ["scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs"]],
  ["Scoped autonomy generated-tool live breadth", process.execPath, ["scripts/smoke-scoped-autonomy-generated-tool-live-breadth.mjs"]],
  ["Scoped autonomy npm dependency dogfood", process.execPath, ["scripts/smoke-scoped-autonomy-npm-dependency-dogfood.mjs"]],
  ["Computer Use action adapter", process.execPath, ["scripts/smoke-computer-use-action-adapter.mjs"]],
  ["Computer Use surface manager", process.execPath, ["scripts/smoke-computer-use-surface-manager.mjs"]],
  ["Computer Use session runtime", process.execPath, ["scripts/smoke-computer-use-session.mjs"]],
  ["Computer Use session HTTP", process.execPath, ["scripts/smoke-computer-use-session-http.mjs"]],
  ["Computer Use isolated browser", process.execPath, ["scripts/smoke-computer-use-isolated-browser.mjs"]],
  ["Computer Use browser parity", process.execPath, ["scripts/smoke-computer-use-browser-parity.mjs"]],
  ["Computer Use browser prompt dogfood", process.execPath, ["scripts/smoke-computer-use-browser-dogfood.mjs"]],
  ["Computer Use browser prompt live dogfood", process.execPath, ["scripts/smoke-computer-use-browser-live-dogfood.mjs"]],
  ["Computer Use Browser Chrome dogfood", process.execPath, ["scripts/smoke-computer-use-browser-chrome-dogfood.mjs"]],
  ["Computer Use Browser Chrome live extension dogfood", process.execPath, ["scripts/smoke-computer-use-browser-chrome-live-extension-dogfood.mjs"]],
  ["Computer Use Browser Chrome public extension dogfood", process.execPath, ["scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs"]],
  ["Computer Use terminal parity", process.execPath, ["scripts/smoke-computer-use-terminal-parity.mjs"]],
  ["Computer Use Toolsmith artifact", process.execPath, ["scripts/smoke-computer-use-toolsmith-artifact.mjs"]],
  ["Computer Use Browser Chrome", process.execPath, ["scripts/smoke-computer-use-browser-chrome.mjs"]],
  ["Computer Use UIA semantic tree", process.execPath, ["scripts/smoke-computer-use-uia-semantic-tree.mjs"]],
  ["Computer Use browser profile permission", process.execPath, ["scripts/smoke-computer-use-browser-profile-permission.mjs"]],
  ["Computer Use live task benchmark", process.execPath, ["scripts/smoke-computer-use-live-task-benchmark.mjs"]],
  ["Computer Use Windows settings", process.execPath, ["scripts/smoke-computer-use-windows-settings.mjs"]],
  ["Computer Use native watch boundary", process.execPath, ["scripts/smoke-computer-use-native-watch-boundary.mjs"]],
  ["Browser native desktop helper v2 dev contract", process.execPath, ["scripts/smoke-browser-native-desktop-helper-v2-dev-contract.mjs"]],
  ["Computer Use VM sandbox boundary", process.execPath, ["scripts/smoke-computer-use-vm-sandbox-boundary.mjs"]],
  ["Computer Use VM sandbox adapter", process.execPath, ["scripts/smoke-computer-use-vm-sandbox-adapter.mjs"]],
  ["Computer Use debug bundle", process.execPath, ["scripts/smoke-computer-use-debug-bundle.mjs"]],
  ["Renderer Computer Use live refresh", process.execPath, ["scripts/smoke-renderer-computer-use-live-refresh.mjs"]],
  ["Renderer Computer Use profile draft", process.execPath, ["scripts/smoke-renderer-computer-use-profile-draft.mjs"]],
  ["Renderer Computer Use Browser Chrome evidence", process.execPath, ["scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs"]],
  ["Renderer autonomy rerun history", process.execPath, ["scripts/smoke-renderer-autonomy-rerun-history.mjs"]],
  ["Computer Use one-time profile", process.execPath, ["scripts/smoke-computer-use-one-time-profile.mjs"]],
  ["Computer Use credential consent", process.execPath, ["scripts/smoke-computer-use-credential-consent.mjs"]],
  ["Computer Use effect verifier", process.execPath, ["scripts/smoke-computer-use-effect-verifier.mjs"]],
  ["Computer Use verifier audit", process.execPath, ["scripts/smoke-computer-use-verifier-audit.mjs"]],
  ["Computer Use promotion gate", process.execPath, ["scripts/gate-computer-use-promotion.mjs", "--dry-run"]],
  ["Computer Use promotion gate route", process.execPath, ["scripts/smoke-computer-use-promotion-gate-route.mjs"]],
  ["Browser Action", process.execPath, ["scripts/smoke-browser-action.mjs"]],
  ["Browser Action Playwright adapter", process.execPath, ["scripts/smoke-browser-action-playwright.mjs"]],
  ["Browser Action CDP adapter", process.execPath, ["scripts/smoke-browser-action-cdp.mjs"]],
  ["Browser Action evaluate gate", process.execPath, ["scripts/smoke-browser-action-evaluate.mjs"]],
  ["Browser Action native boundary", process.execPath, ["scripts/smoke-browser-action-native.mjs"]],
  ["Browser native desktop helper", process.execPath, ["scripts/smoke-browser-native-desktop-helper.mjs"]],
  ["Browser native desktop helper native", process.execPath, ["scripts/smoke-browser-native-desktop-helper-native.mjs"]],
  ["Browser native desktop helper signature", process.execPath, ["scripts/smoke-browser-native-desktop-helper-signature.mjs"]],
  ["Browser native desktop helper signing readiness", process.execPath, ["scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs"]],
  ["Screen provider", process.execPath, ["scripts/smoke-screen-provider.mjs"]],
  ["Terminal provider", process.execPath, ["scripts/smoke-terminal.mjs"]],
  ["Terminal session", process.execPath, ["scripts/smoke-terminal-session.mjs"]],
  ["Resident runtime", process.execPath, ["scripts/smoke-resident.mjs"]],
  ["Bundled Node runtime", process.execPath, ["scripts/smoke-node-runtime.mjs"]],
  ["Browser Bridge extension package", process.execPath, ["scripts/smoke-browser-extension.mjs"]],
  ["Browser Bridge heartbeat/status", process.execPath, ["scripts/smoke-browser-extension-bridge.mjs"]],
  ["Semantic trace corpus", process.execPath, ["scripts/smoke-semantic-trace-corpus.mjs"]],
  ["Browser Action semantic live corpus", process.execPath, ["scripts/smoke-browser-action-semantic-live-corpus.mjs"]],
  ["Browser Action recovery live corpus", process.execPath, ["scripts/smoke-browser-action-recovery-live-corpus.mjs"]],
  ["Browser Action live harness", process.execPath, ["scripts/smoke-browser-action-live-harness.mjs"]],
  ["Browser native host", process.execPath, ["scripts/smoke-browser-native-host.mjs"]],
  ["Browser store readiness", process.execPath, ["scripts/smoke-browser-store-readiness.mjs"]],
  ["ASR sidecar", process.execPath, ["scripts/smoke-asr-sidecar.mjs"]],
  ["ASR runtime candidates", process.execPath, ["scripts/smoke-asr-runtime-candidates.mjs"]],
  ["ASR persistent worker", process.execPath, ["scripts/smoke-asr-persistent-worker.mjs"]],
  ["ASR benchmark harness", process.execPath, ["scripts/smoke-asr-benchmark-harness.mjs"]],
  ["OCR runtime packaging", process.execPath, ["scripts/smoke-ocr-runtime.mjs"]],
  ["PTY runtime packaging", process.execPath, ["scripts/smoke-pty-runtime.mjs"]],
  ["Screen capture helper", process.execPath, ["scripts/smoke-screen-helper.mjs"]]
];

if (includeLive) {
  steps.push(["Codex app-server live", process.execPath, ["scripts/smoke-codex-app-server-live.mjs"]]);
  steps.push(["Screen capture helper OCR", process.execPath, ["scripts/smoke-screen-helper-ocr.mjs"]]);
  steps.push(["Screen capture helper live", process.execPath, ["scripts/smoke-screen-helper-live.mjs"]]);
  steps.push(["Screen capture request live", process.execPath, ["scripts/smoke-screen-capture-request.mjs"]]);
  steps.push(["Browser native desktop helper live", process.execPath, ["scripts/smoke-browser-native-desktop-helper-live.mjs"]]);
}

for (const [label, command, args] of steps) {
  console.log(`\n[smoke:all] ${label}`);
  await run(command, args);
}

console.log(`\nsmoke:all ok${includeLive ? " with live checks" : ""}`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning")
      }
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}

function appendNodeOption(current, option) {
  const existing = String(current ?? "").trim();
  return existing.includes(option) ? existing : [existing, option].filter(Boolean).join(" ");
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npmStep(script) {
  if (process.platform === "win32") {
    return [script, "cmd.exe", ["/d", "/s", "/c", "npm", "run", script]];
  }
  return [script, npmCommand(), ["run", script]];
}
