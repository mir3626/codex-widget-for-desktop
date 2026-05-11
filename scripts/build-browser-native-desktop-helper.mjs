#!/usr/bin/env node
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = join(root, "providers", "browser-native-desktop-helper-rs", "Cargo.toml");
const outputDir = join(root, "dist", "browser-native-desktop-helper");
const exeName = process.platform === "win32" ? "browser-native-desktop-helper.exe" : "browser-native-desktop-helper";
const builtExe = join(root, "providers", "browser-native-desktop-helper-rs", "target", "release", exeName);
const outputExe = join(outputDir, "browser-native-desktop-helper.exe");

if (process.platform !== "win32") {
  console.log("browser native desktop helper build skipped: Windows-only helper");
  process.exit(0);
}

await run("cargo", ["build", "--release", "--manifest-path", manifestPath], { cwd: root });
mkdirSync(outputDir, { recursive: true });
await copyWithRetry(builtExe, outputExe);
if (process.env.CODEX_WIDGET_SIGN_HELPERS === "1") {
  await run(process.execPath, [join(root, "scripts", "sign-browser-native-desktop-helper.mjs")], { cwd: root });
}

const size = statSync(outputExe).size;
if (size <= 0) {
  throw new Error(`Built native desktop helper is empty: ${outputExe}`);
}

console.log(`browser native desktop helper built: ${outputExe} (${size} bytes)`);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      ...options
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

async function copyWithRetry(source, destination) {
  let lastError;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      copyFileSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!["EBUSY", "EPERM", "EACCES"].includes(error?.code) || attempt === 20) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}
