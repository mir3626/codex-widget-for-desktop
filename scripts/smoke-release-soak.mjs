#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { createSmokeAppDataEnv } from "./smoke-isolation.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseExe = join(root, "src-tauri", "target", "release", "codex-widget-for-desktop.exe");
const daemonPort = 4128;
const SOAK_MS = Number(process.env.CODEX_WIDGET_RELEASE_SOAK_MS ?? 60_000);
const MAX_WORKING_SET_MB = Number(process.env.CODEX_WIDGET_RELEASE_SOAK_MAX_WORKING_SET_MB ?? 1024);
const MAX_GROWTH_MB = Number(process.env.CODEX_WIDGET_RELEASE_SOAK_MAX_GROWTH_MB ?? 256);
const REPORT_PATH = resolve(
  process.env.CODEX_WIDGET_RELEASE_SOAK_REPORT?.trim() || join(root, "dist", "reports", "release-soak-latest.json")
);

if (process.platform !== "win32") {
  console.log("release soak skipped: Windows release exe soak is Windows-only");
  process.exit(0);
}

if (!existsSync(releaseExe)) {
  throw new Error(`Missing release exe. Run npm run build first: ${releaseExe}`);
}

if (await canConnect()) {
  throw new Error(`Port ${daemonPort} is already serving a widget daemon; stop it before release soak.`);
}

const smokeAppData = createSmokeAppDataEnv(process.env, "codex-widget-release-soak");
const app = spawn(releaseExe, [], {
  cwd: root,
  env: {
    ...smokeAppData.env,
    CODEX_WIDGET_AUTH_MODE: "mock",
    CODEX_WIDGET_START_HIDDEN: "1"
  },
  stdio: "ignore",
  windowsHide: true
});

const runtimeEvents = [];
let pongCount = 0;

try {
  await waitForDaemon(app);
  const startStats = readProcessTreeStats(app.pid);
  const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}`);
  await waitForConnected(socket);

  const pingTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ping" }));
    }
  }, 2000);

  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.type === "runtime.status") {
      runtimeEvents.push(event.status);
    }
    if (event.type === "pong") {
      pongCount += 1;
    }
  });

  await delay(SOAK_MS);
  clearInterval(pingTimer);
  socket.close();

  const endStats = readProcessTreeStats(app.pid);
  assertSoakHealth(endStats, startStats);
  const report = writeSoakReport({ appPid: app.pid, startStats, endStats });

  console.log(
    `release soak ok: duration=${Math.round(SOAK_MS / 1000)}s samples=${runtimeEvents.length} pongs=${pongCount} workingSet=${endStats.totalWorkingSetMb.toFixed(1)}MB processes=${endStats.processes.length} report=${report.path}`
  );
} finally {
  cleanupProcessTree(app.pid);
  await waitUntilPortClosed();
  smokeAppData.cleanup();
}

function writeSoakReport({ appPid, startStats, endStats }) {
  const growthMb = endStats.totalWorkingSetMb - startStats.totalWorkingSetMb;
  const latest = runtimeEvents.at(-1) ?? null;
  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: SOAK_MS,
    releaseExe,
    appPid,
    thresholds: {
      maxWorkingSetMb: MAX_WORKING_SET_MB,
      maxGrowthMb: MAX_GROWTH_MB
    },
    health: {
      runtimeSamples: runtimeEvents.length,
      pongCount,
      latestRuntimeStatus: latest,
      activeRequests: latest?.activeRequests ?? null,
      hasRootProcess: endStats.hasRootProcess,
      hasDaemonProcess: endStats.hasDaemonProcess
    },
    memory: {
      startWorkingSetMb: roundOneDecimal(startStats.totalWorkingSetMb),
      endWorkingSetMb: roundOneDecimal(endStats.totalWorkingSetMb),
      growthMb: roundOneDecimal(growthMb),
      processCount: endStats.processes.length
    },
    processes: endStats.processes
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return { path: REPORT_PATH, report };
}

function roundOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function waitForDaemon(appProcess) {
  const deadline = Date.now() + 25_000;
  return new Promise((resolveWait, reject) => {
    let settled = false;

    function attempt() {
      if (settled) {
        return;
      }
      if (Date.now() > deadline) {
        settled = true;
        reject(new Error("Timed out waiting for release daemon websocket."));
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

    appProcess.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Release app exited before daemon responded: ${signal ?? code}`));
      }
    });

    attempt();
  });
}

function waitForConnected(socket) {
  return new Promise((resolveWait, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for release soak connection.")), 12_000);
    const onMessage = (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "runtime.status") {
        runtimeEvents.push(event.status);
      }
      if (event.type === "connected") {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolveWait();
      }
    };
    socket.on("message", onMessage);
    socket.on("error", reject);
  });
}

function assertSoakHealth(endStats, startStats) {
  if (runtimeEvents.length < Math.max(3, Math.floor(SOAK_MS / 7000))) {
    throw new Error(`Expected runtime samples during release soak, saw ${runtimeEvents.length}.`);
  }
  if (pongCount < Math.max(3, Math.floor(SOAK_MS / 4000))) {
    throw new Error(`Expected ping/pong health responses during release soak, saw ${pongCount}.`);
  }

  const latest = runtimeEvents.at(-1);
  if (!latest) {
    throw new Error("No runtime status was emitted during release soak.");
  }
  if (latest.activeRequests !== 0) {
    throw new Error(`Expected no active requests during release soak, saw ${latest.activeRequests}.`);
  }
  if (!endStats.hasRootProcess) {
    throw new Error("Release soak process tree did not include the root app process.");
  }
  if (!endStats.hasDaemonProcess) {
    throw new Error("Release soak process tree did not include the daemon process.");
  }
  if (endStats.totalWorkingSetMb > MAX_WORKING_SET_MB) {
    throw new Error(
      `Release soak process tree working set ${endStats.totalWorkingSetMb.toFixed(1)}MB exceeded ${MAX_WORKING_SET_MB}MB.`
    );
  }
  const growth = endStats.totalWorkingSetMb - startStats.totalWorkingSetMb;
  if (growth > MAX_GROWTH_MB) {
    throw new Error(`Release soak working set grew ${growth.toFixed(1)}MB, over ${MAX_GROWTH_MB}MB.`);
  }
}

function readProcessTreeStats(rootPid) {
  if (!rootPid) {
    throw new Error("Release app pid is unavailable.");
  }

  const script = `
$rootPid = ${rootPid}
$all = Get-CimInstance Win32_Process
$ids = [System.Collections.Generic.HashSet[int]]::new()
[void]$ids.Add($rootPid)
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($p in $all) {
    if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
      [void]$ids.Add([int]$p.ProcessId)
      $changed = $true
    }
  }
}
$items = foreach ($p in $all) {
  if ($ids.Contains([int]$p.ProcessId)) {
    $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    [pscustomobject]@{
      pid = [int]$p.ProcessId
      parentPid = [int]$p.ParentProcessId
      name = $p.Name
      path = $p.ExecutablePath
      commandLine = $p.CommandLine
      workingSet = if ($proc) { [int64]$proc.WorkingSet64 } else { 0 }
    }
  }
}
$items | ConvertTo-Json -Depth 4
`;

  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`Unable to read release process tree: ${result.stderr}`);
  }

  const parsed = JSON.parse(result.stdout.trim() || "[]");
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  const totalWorkingSetMb = processes.reduce((total, processInfo) => total + Number(processInfo.workingSet ?? 0), 0) / 1024 / 1024;
  const hasRootProcess = processes.some((processInfo) => Number(processInfo.pid) === rootPid);
  const hasDaemonProcess = processes.some((processInfo) =>
    String(processInfo.commandLine ?? "").toLowerCase().includes("standalone.js")
  );

  return {
    processes,
    totalWorkingSetMb,
    hasRootProcess,
    hasDaemonProcess
  };
}

function canConnect() {
  return new Promise((resolveCanConnect) => {
    const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}`);
    const timeout = setTimeout(() => {
      socket.close();
      resolveCanConnect(false);
    }, 600);
    socket.on("open", () => {
      clearTimeout(timeout);
      socket.close();
      resolveCanConnect(true);
    });
    socket.on("error", () => {
      clearTimeout(timeout);
      resolveCanConnect(false);
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

async function waitUntilPortClosed() {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (!(await canConnect())) {
      return;
    }
    await delay(250);
  }
  throw new Error(`Release daemon on ${daemonPort} was still reachable after cleanup.`);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
