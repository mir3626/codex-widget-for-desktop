#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { removeSmokeDir } from "./smoke-isolation.mjs";

const helperPath = path.resolve("providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1");

if (process.platform !== "win32") {
  console.log("browser native desktop helper live smoke skipped: Windows-only helper");
  process.exit(0);
}

const browserExe = findBrowserExecutable();
if (!browserExe) {
  console.log("browser native desktop helper live smoke skipped: no Chrome/Edge executable found");
  process.exit(0);
}

const tempDir = mkdtempSync(path.join(tmpdir(), "browser-native-desktop-helper-live-"));
const profileDir = path.join(tempDir, "profile");
const pagePath = path.join(tempDir, "native-helper-smoke.html");
writeFileSync(
  pagePath,
  `<!doctype html><html><head><title>Native Helper Smoke Page</title></head><body><h1>Native Helper Smoke Page</h1><button>Smoke Button</button><input aria-label="Smoke Input"></body></html>`,
  "utf8"
);

const browser = spawn(browserExe, [
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--disable-extensions",
  "--disable-background-networking",
  "--new-window",
  pathToFileURL(pagePath).href
], {
  stdio: "ignore",
  windowsHide: false
});

try {
  const status = await waitForBrowserWindow();
  if (!status.observation?.windows?.length) {
    throw new Error(`Expected helper to observe launched browser window: ${JSON.stringify(status)}`);
  }

  const read = await runHelper({
    schemaVersion: "browser-native-desktop-helper.v1",
    requestId: "native-helper-live-read",
    command: "execute",
    timeoutMs: 7_500,
    session: createSession(),
    action: { type: "read", reason: "live smoke" }
  });
  if (read.ok !== true || !read.after) {
    throw new Error(`Live helper read failed: ${JSON.stringify(read)}`);
  }

  const reload = await runHelper({
    schemaVersion: "browser-native-desktop-helper.v1",
    requestId: "native-helper-live-reload",
    command: "execute",
    timeoutMs: 7_500,
    session: createSession(),
    action: { type: "reload" }
  });
  if (reload.ok !== true || reload.metadata?.method !== "f5") {
    throw new Error(`Live helper reload failed: ${JSON.stringify(reload)}`);
  }

  console.log(`browser native desktop helper live smoke ok: ${path.basename(browserExe)}`);
} finally {
  await killProcessTree(browser.pid);
  removeSmokeDir(tempDir);
}

function createSession() {
  return {
    id: "native-helper-live-smoke",
    mode: "auto_safe_actions",
    source: { kind: "active_tab", browser: "unknown", title: "Native Helper Smoke Page" }
  };
}

async function waitForBrowserWindow() {
  const deadline = Date.now() + 15_000;
  let last;
  while (Date.now() < deadline) {
    last = await runHelper({
      schemaVersion: "browser-native-desktop-helper.v1",
      requestId: "native-helper-live-status",
      command: "status",
      timeoutMs: 5_000,
      session: createSession()
    });
    const windows = last.observation?.windows ?? [];
    if (last.ok === true && windows.some((window) => String(window.title ?? "").includes("Native Helper Smoke Page"))) {
      return last;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for launched browser window. last=${JSON.stringify(last)}`);
}

function findBrowserExecutable() {
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const candidates = [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
    programFilesX86 ? path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    programFilesX86 ? path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe") : undefined
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function runHelper(request) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`helper timed out. stdout=${stdout} stderr=${stderr}`));
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if ((code ?? 0) !== 0 || signal) {
        reject(new Error(`helper exited with ${signal ?? code}. stdout=${stdout} stderr=${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`helper returned invalid JSON: ${error instanceof Error ? error.message : String(error)} stdout=${stdout} stderr=${stderr}`));
      }
    });
    child.stdin.end(JSON.stringify(request), "utf8");
  });
}

function killProcessTree(pid) {
  if (!pid) return Promise.resolve();
  return new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
