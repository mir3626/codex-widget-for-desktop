#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const msiPath = join(
  root,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "msi",
  "Codex Widget_0.1.0_x64_en-US.msi"
);
const requestedInstallDir = resolve(
  process.env.CODEX_WIDGET_RELEASE_MSI_INSTALL_DIR ?? join(tmpdir(), "codex-widget-msi-smoke")
);
const daemonPort = 4128;
const desktopShortcut = join(process.env.USERPROFILE ?? root, "Desktop", "Codex Widget.lnk");
const productKey = "HKCU\\Software\\mir3626\\Codex Widget";

if (process.platform !== "win32") {
  console.log("release MSI install smoke skipped: Windows MSI install smoke is Windows-only");
  process.exit(0);
}

assertFile(msiPath, "Missing MSI installer. Run npm run build first.");

if ((findMsiInstallEntries().length > 0 || existsSync(requestedInstallDir)) && process.env.CODEX_WIDGET_RELEASE_INSTALL_SMOKE_ALLOW_EXISTING !== "1") {
  throw new Error(
    `Codex Widget MSI install state already exists or ${requestedInstallDir} exists. ` +
      "Refusing to run over existing install state. Uninstall first, or set " +
      "CODEX_WIDGET_RELEASE_INSTALL_SMOKE_ALLOW_EXISTING=1 for a controlled test machine."
  );
}

if (await canConnect()) {
  throw new Error(`Port ${daemonPort} is already serving a widget daemon; stop it before release MSI install smoke.`);
}

let appPid = undefined;
let installSucceeded = false;
let resolvedInstallDir = requestedInstallDir;
try {
  const installResult = runMsiexec(
    [
      "/i",
      msiPath,
      "/qn",
      "/norestart",
      "ALLUSERS=2",
      "MSIINSTALLPERUSER=1",
      `INSTALLDIR=${requestedInstallDir}`,
      "AUTOLAUNCHAPP="
    ],
    "MSI silent install"
  );

  if (installResult.status !== 0) {
    cleanupMsiInstallState();
    if (!isElevated() && isLikelyElevationFailure(installResult.status)) {
      console.log(
        `release MSI install smoke skipped: installer returned ${installResult.status}; ` +
          "this WiX MSI is per-machine and this shell is not elevated."
      );
      process.exit(0);
    }
    throw new Error(formatProcessFailure("MSI silent install", installResult));
  }
  installSucceeded = true;

  const installDir = resolveInstalledDir();
  resolvedInstallDir = installDir;
  const installedExe = join(installDir, "codex-widget-for-desktop.exe");
  assertFile(installedExe, "MSI install did not create the app exe.");
  assertInstalledResources(installDir);

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
  cleanupProcessTree(appPid);
  cleanupMsiDaemonProcesses(installDir);
  appPid = undefined;
  await waitUntilPortClosed(20_000);

  cleanupMsiInstallState();
  await waitUntilUninstalled(installDir);
  cleanupInstallDirIfOwned(installDir);
  console.log(`release MSI install smoke ok: installed, launched, and uninstalled from ${installDir}`);
} finally {
  cleanupProcessTree(appPid);
  cleanupMsiDaemonProcesses(resolvedInstallDir);
  await waitUntilPortClosed(20_000).catch(() => undefined);
  if (installSucceeded) {
    cleanupMsiInstallState();
    cleanupInstallDirIfOwned(resolvedInstallDir);
    cleanupInstallDirIfOwned(requestedInstallDir);
  }
}

function assertInstalledResources(installDir) {
  assertFile(join(installDir, "_up_", "dist", "daemon-bundle", "standalone.js"), "Missing bundled daemon after MSI install.");
  assertFile(join(installDir, "_up_", "dist", "node-runtime", "node.exe"), "Missing bundled Node runtime after MSI install.");
  assertFile(join(installDir, "_up_", "dist", "ocr-runtime", "ocr-runtime.json"), "Missing OCR runtime manifest after MSI install.");
  assertFile(join(installDir, "_up_", "dist", "pty-runtime", "pty-runtime.json"), "Missing PTY runtime manifest after MSI install.");
  assertFile(
    join(installDir, "_up_", "dist", "pty-runtime", "node_modules", "node-pty", "package.json"),
    "Missing node-pty runtime after MSI install."
  );
  assertFile(
    join(installDir, "_up_", "providers", "browser-native-host", "native-host.mjs"),
    "Missing browser native host after MSI install."
  );
}

function assertFile(path, message) {
  if (!existsSync(path)) {
    throw new Error(`${message} ${path}`);
  }
  if (statSync(path).size <= 0) {
    throw new Error(`File is empty: ${path}`);
  }
}

function runMsiexec(args, label) {
  const result = spawnSync("msiexec.exe", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 240_000,
    windowsHide: true
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && label.includes("uninstall")) {
    throw new Error(formatProcessFailure(label, result));
  }
  return result;
}

function cleanupMsiInstallState() {
  for (const entry of findMsiInstallEntries()) {
    const productCode = typeof entry.PSChildName === "string" ? entry.PSChildName : "";
    const uninstallTarget = /^\{[0-9a-f-]+}$/i.test(productCode) ? productCode : msiPath;
    runMsiexec(["/x", uninstallTarget, "/qn", "/norestart"], "MSI silent uninstall cleanup");
  }
  cleanupSmokeProductKey();
}

function findMsiInstallEntries() {
  const script = [
    "$paths = @(",
    "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    ");",
    "$items = Get-ItemProperty -Path $paths -ErrorAction SilentlyContinue |",
    "Where-Object { $_.DisplayName -eq 'Codex Widget' -and $_.Publisher -eq 'mir3626' } |",
    "Select-Object DisplayName,Publisher,PSChildName,UninstallString,InstallLocation;",
    "$items | ConvertTo-Json -Compress"
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function resolveInstalledDir() {
  const registryInstallDir = readRegistryValue(productKey, "InstallDir");
  if (registryInstallDir && existsSync(join(registryInstallDir, "codex-widget-for-desktop.exe"))) {
    return registryInstallDir;
  }
  if (existsSync(join(requestedInstallDir, "codex-widget-for-desktop.exe"))) {
    return requestedInstallDir;
  }
  const entryInstallDir = findMsiInstallEntries()
    .map((entry) => (typeof entry.InstallLocation === "string" ? entry.InstallLocation : ""))
    .find((value) => value && existsSync(join(value, "codex-widget-for-desktop.exe")));
  if (entryInstallDir) {
    return entryInstallDir;
  }
  throw new Error("Could not resolve MSI install directory after successful install.");
}

function readRegistryValue(key, name) {
  const result = spawnSync("reg.exe", ["query", key, "/v", name], {
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

function cleanupSmokeProductKey() {
  const value = readRegistryValue(productKey, "InstallDir");
  if (value && samePath(value, requestedInstallDir)) {
    spawnSync("reg.exe", ["delete", productKey, "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
  }
}

function cleanupInstallDirIfOwned(installDir) {
  if (!samePath(installDir, requestedInstallDir) || !existsSync(installDir)) {
    return;
  }
  rmSync(installDir, { force: true, recursive: true });
}

function isElevated() {
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  return result.stdout.trim().toLowerCase() === "true";
}

function isLikelyElevationFailure(status) {
  return status === 5 || status === 1602 || status === 1603 || status === 1625;
}

function samePath(left, right) {
  return left.replace(/[\\/]$/, "").toLocaleLowerCase() === right.replace(/[\\/]$/, "").toLocaleLowerCase();
}

function formatProcessFailure(label, result) {
  return `${label} failed with exit ${result.status}.\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
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

function waitForDaemon(app) {
  const deadline = Date.now() + 25_000;
  return new Promise((resolveWait, reject) => {
    let settled = false;

    function attempt() {
      if (settled) {
        return;
      }
      if (Date.now() > deadline) {
        settled = true;
        reject(new Error("Timed out waiting for MSI-installed release daemon websocket."));
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
          resolveWait();
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
        reject(new Error(`MSI-installed release app exited before daemon responded: ${signal ?? code}`));
      }
    });

    attempt();
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

function cleanupMsiDaemonProcesses(installDir) {
  for (const pid of findMsiDaemonPids(installDir)) {
    cleanupProcessTree(pid);
  }
}

function findMsiDaemonPids(installDir) {
  const escapedInstallDir = installDir.replace(/'/g, "''");
  const script = [
    "Get-CimInstance Win32_Process |",
    "Where-Object {",
    "$_.Name -match '^node(\\.exe)?$' -and",
    "$_.CommandLine -like '*_up_*dist*daemon-bundle*standalone.js*' -and",
    `$_.CommandLine -like '*${escapedInstallDir.replace(/\\/g, "*")}*'`,
    "} | Select-Object -ExpandProperty ProcessId"
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter(Number.isFinite);
}

async function waitUntilPortClosed(timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await canConnect())) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Release daemon on ${daemonPort} was still reachable after MSI cleanup.`);
}

async function waitUntilUninstalled(installDir) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const installedExeGone = !existsSync(join(installDir, "codex-widget-for-desktop.exe"));
    const entriesGone = findMsiInstallEntries().length === 0;
    const shortcutGone = !existsSync(desktopShortcut);
    if (installedExeGone && entriesGone && shortcutGone) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  throw new Error("MSI uninstall left install files, uninstall registry entries, or desktop shortcut behind.");
}
