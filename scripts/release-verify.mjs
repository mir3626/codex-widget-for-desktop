#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const commands = [
  npmCommand("run", "smoke:all:live"),
  npmCommand("run", "build"),
  npmCommand("run", "smoke:release-resources"),
  npmCommand("run", "smoke:release-launch"),
  npmCommand("run", "smoke:release-install"),
  npmCommand("run", "smoke:release-msi-install")
];
const artifacts = [
  join(root, "src-tauri", "target", "release", "codex-widget-for-desktop.exe"),
  join(root, "src-tauri", "target", "release", "bundle", "msi", "Codex Widget_0.1.0_x64_en-US.msi"),
  join(root, "src-tauri", "target", "release", "bundle", "nsis", "Codex Widget_0.1.0_x64-setup.exe")
];

for (const [command, args] of commands) {
  await run(command, args);
}

for (const artifact of artifacts) {
  if (!existsSync(artifact)) {
    throw new Error(`Missing release artifact after verification: ${artifact}`);
  }
  const size = statSync(artifact).size;
  if (size <= 0) {
    throw new Error(`Release artifact is empty after verification: ${artifact}`);
  }
  console.log(`[release:verify] artifact ${artifact} (${formatBytes(size)})`);
}

console.log("[release:verify] ok");

function run(command, args) {
  console.log(`\n[release:verify] ${command} ${args.join(" ")}`);
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}

function npmCommand(...args) {
  if (process.platform === "win32") {
    return ["cmd.exe", ["/d", "/s", "/c", "npm", ...args]];
  }
  if (process.env.npm_execpath) {
    return [process.execPath, [process.env.npm_execpath, ...args]];
  }
  return ["npm", args];
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
