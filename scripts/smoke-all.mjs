import { spawn } from "node:child_process";

const includeLive = process.argv.includes("--include-live");

const steps = [
  npmStep("lint"),
  npmStep("build:web"),
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
  ["Screen provider", process.execPath, ["scripts/smoke-screen-provider.mjs"]],
  ["Terminal provider", process.execPath, ["scripts/smoke-terminal.mjs"]],
  ["Terminal session", process.execPath, ["scripts/smoke-terminal-session.mjs"]],
  ["Resident runtime", process.execPath, ["scripts/smoke-resident.mjs"]],
  ["Bundled Node runtime", process.execPath, ["scripts/smoke-node-runtime.mjs"]],
  ["Browser Bridge extension package", process.execPath, ["scripts/smoke-browser-extension.mjs"]],
  ["Browser Bridge heartbeat/status", process.execPath, ["scripts/smoke-browser-extension-bridge.mjs"]],
  ["Semantic trace corpus", process.execPath, ["scripts/smoke-semantic-trace-corpus.mjs"]],
  ["Browser native host", process.execPath, ["scripts/smoke-browser-native-host.mjs"]],
  ["Browser store readiness", process.execPath, ["scripts/smoke-browser-store-readiness.mjs"]],
  ["OCR runtime packaging", process.execPath, ["scripts/smoke-ocr-runtime.mjs"]],
  ["PTY runtime packaging", process.execPath, ["scripts/smoke-pty-runtime.mjs"]],
  ["Screen capture helper", process.execPath, ["scripts/smoke-screen-helper.mjs"]]
];

if (includeLive) {
  steps.push(["Codex app-server live", process.execPath, ["scripts/smoke-codex-app-server-live.mjs"]]);
  steps.push(["Screen capture helper OCR", process.execPath, ["scripts/smoke-screen-helper-ocr.mjs"]]);
  steps.push(["Screen capture helper live", process.execPath, ["scripts/smoke-screen-helper-live.mjs"]]);
  steps.push(["Screen capture request live", process.execPath, ["scripts/smoke-screen-capture-request.mjs"]]);
}

for (const [label, command, args] of steps) {
  console.log(`\n[smoke:all] ${label}`);
  await run(command, args);
}

console.log(`\nsmoke:all ok${includeLive ? " with live checks" : ""}`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
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

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npmStep(script) {
  if (process.platform === "win32") {
    return [script, "cmd.exe", ["/d", "/s", "/c", "npm", "run", script]];
  }
  return [script, npmCommand(), ["run", script]];
}
