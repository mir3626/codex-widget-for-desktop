import { spawn } from "node:child_process";

const includeLive = process.argv.includes("--include-live");

const steps = [
  npmStep("lint"),
  npmStep("build:web"),
  ["daemon stream", process.execPath, ["scripts/smoke-daemon.mjs"]],
  ["DOM provider", process.execPath, ["scripts/smoke-dom-provider.mjs"]],
  ["Screen provider", process.execPath, ["scripts/smoke-screen-provider.mjs"]],
  ["Terminal provider", process.execPath, ["scripts/smoke-terminal.mjs"]],
  ["Terminal session", process.execPath, ["scripts/smoke-terminal-session.mjs"]],
  ["Resident runtime", process.execPath, ["scripts/smoke-resident.mjs"]],
  ["Bundled Node runtime", process.execPath, ["scripts/smoke-node-runtime.mjs"]],
  ["Browser DOM extension", process.execPath, ["scripts/smoke-browser-extension.mjs"]],
  ["Screen capture helper", process.execPath, ["scripts/smoke-screen-helper.mjs"]]
];

if (includeLive) {
  steps.push(["Screen capture helper live", process.execPath, ["scripts/smoke-screen-helper-live.mjs"]]);
  steps.push(["Screen capture request live", process.execPath, ["scripts/smoke-screen-capture-request.mjs"]]);
}

for (const [label, command, args] of steps) {
  console.log(`\n[smoke:all] ${label}`);
  await run(command, args);
}

console.log(`\nsmoke:all ok${includeLive ? " with live screen helper" : ""}`);

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
