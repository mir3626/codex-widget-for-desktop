#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const installerPath = join(
  root,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
  "Codex Widget_0.1.0_x64-setup.exe"
);
const installDir = join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? root, "AppData", "Local"), "Codex Widget");
const installedExe = join(installDir, "codex-widget-for-desktop.exe");
const uninstallExe = join(installDir, "uninstall.exe");
const bundledNodeExe = join(installDir, "_up_", "dist", "node-runtime", "node.exe");
const daemonPort = 4128;
const uninstallKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Codex Widget";
const productKey = "HKCU\\Software\\mir3626\\Codex Widget";

if (process.platform !== "win32") {
  console.log("release install smoke skipped: Windows NSIS install smoke is Windows-only");
  process.exit(0);
}

assertFile(installerPath, "Missing NSIS installer. Run npm run build first.");

if (
  (queryRegistryKey(uninstallKey) || queryRegistryKey(productKey) || existsSync(installDir)) &&
  process.env.CODEX_WIDGET_RELEASE_INSTALL_SMOKE_ALLOW_EXISTING !== "1"
) {
  throw new Error(
    `Codex Widget already appears installed or has leftover install state at ${installDir}. ` +
      "Refusing to run install/uninstall smoke over an existing install. " +
      "Uninstall it first, or set CODEX_WIDGET_RELEASE_INSTALL_SMOKE_ALLOW_EXISTING=1 for a controlled test machine."
  );
}

if (await canConnect()) {
  throw new Error(`Port ${daemonPort} is already serving a widget daemon; stop it before release install smoke.`);
}

let appPid = undefined;
let installedBySmoke = false;
try {
  runOrThrow(installerPath, ["/S"], "NSIS silent install");
  installedBySmoke = true;
  assertFile(installedExe, "Silent install did not create the app exe.");
  assertFile(uninstallExe, "Silent install did not create the uninstaller.");
  assertFile(join(installDir, "_up_", "dist", "daemon-bundle", "standalone.js"), "Missing bundled daemon after install.");
  assertFile(join(installDir, "_up_", "dist", "node-runtime", "node.exe"), "Missing bundled Node runtime after install.");
  assertFile(join(installDir, "_up_", "dist", "ocr-runtime", "ocr-runtime.json"), "Missing OCR runtime manifest after install.");
  assertFile(
    join(installDir, "_up_", "providers", "browser-dom-extension", "options.html"),
    "Missing browser extension Options page after install."
  );
  assertFile(
    join(installDir, "_up_", "providers", "browser-native-host", "native-host.mjs"),
    "Missing browser native host after install."
  );
  assertFile(
    join(installDir, "_up_", "providers", "browser-native-host", "install-native-messaging-host.ps1"),
    "Missing browser native host installer after install."
  );
  if (!queryRegistryKey(uninstallKey)) {
    throw new Error("Silent install did not register an uninstall entry.");
  }

  const app = spawn(installedExe, [], {
    cwd: installDir,
    env: {
      ...process.env,
      CODEX_WIDGET_AUTH_MODE: "mock",
      CODEX_WIDGET_START_HIDDEN: "1"
    },
    stdio: "ignore",
    windowsHide: true
  });
  appPid = app.pid;
  await waitForDaemon(app);
  await verifyInstalledDaemonRestart(app);
  await verifyAppCrashCleansDaemon(app);
  appPid = undefined;
  await waitUntilPortClosed();

  runOrThrow(uninstallExe, ["/S"], "NSIS silent uninstall");
  await waitUntilUninstalled();
  cleanupSmokeProductKey();

  console.log(
    `release install smoke ok: installed, launched, verified daemon/app crash cleanup, and uninstalled from ${installDir}`
  );
} finally {
  cleanupProcessTree(appPid);
  await waitUntilPortClosed().catch(() => undefined);
  if (installedBySmoke && existsSync(uninstallExe)) {
    runOrThrow(uninstallExe, ["/S"], "NSIS silent uninstall cleanup");
    await waitUntilUninstalled().catch(() => undefined);
    cleanupSmokeProductKey();
  }
}

function assertFile(path, message) {
  if (!existsSync(path)) {
    throw new Error(`${message} ${path}`);
  }
  if (statSync(path).size <= 0) {
    throw new Error(`File is empty: ${path}`);
  }
}

function runOrThrow(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
    windowsHide: true
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit ${result.status}.\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
    );
  }
}

function queryRegistryKey(key) {
  const result = spawnSync("reg.exe", ["query", key], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  return result.status === 0;
}

function cleanupSmokeProductKey() {
  const value = readRegistryDefault(productKey);
  if (value && samePath(value, installDir)) {
    spawnSync("reg.exe", ["delete", productKey, "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
  }
}

async function verifyAppCrashCleansDaemon(app) {
  if (!app.pid) {
    throw new Error("Installed app pid is unavailable.");
  }

  const daemonPid = findInstalledDaemonPid();
  if (!daemonPid) {
    throw new Error("Could not find installed bundled daemon before app crash cleanup test.");
  }

  killProcessOnly(app.pid);
  await waitUntil(() => !isPidRunning(app.pid), "Timed out waiting for installed app process to exit.");
  await waitUntil(() => !isPidRunning(daemonPid), "Installed daemon remained after app process exit.");
  await waitUntilPortClosed();
}

async function verifyInstalledDaemonRestart(app) {
  const firstPid = findInstalledDaemonPid();
  if (!firstPid) {
    throw new Error(`Could not find installed bundled daemon process at ${bundledNodeExe}.`);
  }

  cleanupProcessTree(firstPid);
  await waitUntil(() => !isPidRunning(firstPid), "Timed out waiting for killed installed daemon process to exit.");
  await waitForDaemon(app);

  const secondPid = findInstalledDaemonPid();
  if (!secondPid) {
    throw new Error("Installed app daemon responded but the bundled daemon process was not discoverable.");
  }
  if (secondPid === firstPid) {
    throw new Error(`Installed app daemon process did not restart after kill: pid ${firstPid}`);
  }
}

function findInstalledDaemonPid() {
  const script = [
    "Get-CimInstance Win32_Process",
    "| Where-Object {",
    "$_.CommandLine -like '*Codex Widget*_up_*daemon-bundle*standalone.js*'",
    "}",
    "| Select-Object -First 1 -ExpandProperty ProcessId"
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (result.status !== 0) {
    return undefined;
  }
  const pid = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(pid) ? pid : undefined;
}

function isPidRunning(pid) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Get-Process -Id ${pid}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  return result.status === 0;
}

function readRegistryDefault(key) {
  const result = spawnSync("reg.exe", ["query", key, "/ve"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (result.status !== 0) {
    return undefined;
  }
  const line = result.stdout
    .split(/\r?\n/)
    .find((entry) => entry.includes("REG_SZ"));
  return line?.split("REG_SZ").pop()?.trim();
}

function samePath(left, right) {
  return left.replace(/[\\/]$/, "").toLocaleLowerCase() === right.replace(/[\\/]$/, "").toLocaleLowerCase();
}

function waitForDaemon(app) {
  const deadline = Date.now() + 25_000;
  return new Promise((resolve, reject) => {
    let settled = false;

    function attempt() {
      if (settled) {
        return;
      }
      if (Date.now() > deadline) {
        settled = true;
        reject(new Error("Timed out waiting for installed release daemon websocket."));
        return;
      }

      const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}`);
      const timeout = setTimeout(() => {
        socket.close();
        setTimeout(attempt, 300);
      }, 1200);

      socket.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        if (event.type === "connected") {
          socket.send(JSON.stringify({ type: "ping" }));
        }
        if (event.type === "pong") {
          clearTimeout(timeout);
          settled = true;
          socket.close();
          resolve();
        }
      });
      socket.on("error", () => {
        clearTimeout(timeout);
        setTimeout(attempt, 300);
      });
    }

    app.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Installed release app exited before daemon responded: ${signal ?? code}`));
      }
    });

    attempt();
  });
}

function canConnect() {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}`);
    const timeout = setTimeout(() => {
      socket.close();
      resolve(false);
    }, 600);
    socket.on("open", () => {
      clearTimeout(timeout);
      socket.close();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

function cleanupProcessTree(pid) {
  if (!pid) {
    return;
  }
  spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
    stdio: "ignore",
    windowsHide: true
  });
}

function killProcessOnly(pid) {
  if (!pid) {
    return;
  }
  spawnSync("taskkill.exe", ["/pid", String(pid), "/f"], {
    stdio: "ignore",
    windowsHide: true
  });
}

async function waitUntilPortClosed() {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (!(await canConnect())) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Release daemon on ${daemonPort} was still reachable after cleanup.`);
}

async function waitUntilUninstalled() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!existsSync(installedExe) && !queryRegistryKey(uninstallKey)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (existsSync(installedExe)) {
    throw new Error("Silent uninstall left the app exe behind.");
  }
  if (queryRegistryKey(uninstallKey)) {
    throw new Error("Silent uninstall left the uninstall registry entry behind.");
  }
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(message);
}
