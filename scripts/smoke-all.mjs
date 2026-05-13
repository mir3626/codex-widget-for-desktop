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
  ["Browser Action", process.execPath, ["scripts/smoke-browser-action.mjs"]],
  ["Browser Action Playwright adapter", process.execPath, ["scripts/smoke-browser-action-playwright.mjs"]],
  ["Browser Action CDP adapter", process.execPath, ["scripts/smoke-browser-action-cdp.mjs"]],
  ["Browser Action evaluate gate", process.execPath, ["scripts/smoke-browser-action-evaluate.mjs"]],
  ["Browser Action native boundary", process.execPath, ["scripts/smoke-browser-action-native.mjs"]],
  ["Browser native desktop helper", process.execPath, ["scripts/smoke-browser-native-desktop-helper.mjs"]],
  ["Browser native desktop helper native", process.execPath, ["scripts/smoke-browser-native-desktop-helper-native.mjs"]],
  ["Browser native desktop helper signature", process.execPath, ["scripts/smoke-browser-native-desktop-helper-signature.mjs"]],
  ["Screen provider", process.execPath, ["scripts/smoke-screen-provider.mjs"]],
  ["Terminal provider", process.execPath, ["scripts/smoke-terminal.mjs"]],
  ["Terminal session", process.execPath, ["scripts/smoke-terminal-session.mjs"]],
  ["Resident runtime", process.execPath, ["scripts/smoke-resident.mjs"]],
  ["Bundled Node runtime", process.execPath, ["scripts/smoke-node-runtime.mjs"]],
  ["Browser Bridge extension package", process.execPath, ["scripts/smoke-browser-extension.mjs"]],
  ["Browser Bridge heartbeat/status", process.execPath, ["scripts/smoke-browser-extension-bridge.mjs"]],
  ["Semantic trace corpus", process.execPath, ["scripts/smoke-semantic-trace-corpus.mjs"]],
  ["Browser Action semantic live corpus", process.execPath, ["scripts/smoke-browser-action-semantic-live-corpus.mjs"]],
  ["Browser Action live harness", process.execPath, ["scripts/smoke-browser-action-live-harness.mjs"]],
  ["Browser native host", process.execPath, ["scripts/smoke-browser-native-host.mjs"]],
  ["Browser store readiness", process.execPath, ["scripts/smoke-browser-store-readiness.mjs"]],
  ["ASR sidecar", process.execPath, ["scripts/smoke-asr-sidecar.mjs"]],
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
