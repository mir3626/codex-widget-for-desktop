#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseExe = join(root, "src-tauri", "target", "release", "codex-widget-for-desktop.exe");
const daemonPort = 4128;

if (process.platform !== "win32") {
  console.log("release launch smoke skipped: Windows release exe smoke is Windows-only");
  process.exit(0);
}

if (!existsSync(releaseExe)) {
  throw new Error(`Missing release exe. Run npm run build first: ${releaseExe}`);
}

if (await canConnect()) {
  throw new Error(`Port ${daemonPort} is already serving a widget daemon; stop it before release launch smoke.`);
}

const app = spawn(releaseExe, [], {
  cwd: root,
  env: {
    ...process.env,
    CODEX_WIDGET_AUTH_MODE: "mock",
    CODEX_WIDGET_START_HIDDEN: "1"
  },
  stdio: "ignore",
  windowsHide: true
});

try {
  await waitForDaemon();
  console.log(`release launch smoke ok: ${releaseExe} started daemon on ${daemonPort}`);
} finally {
  cleanupProcessTree(app.pid);
  await waitUntilPortClosed();
}

function waitForDaemon() {
  const deadline = Date.now() + 25_000;
  return new Promise((resolve, reject) => {
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
        reject(new Error(`Release app exited before daemon responded: ${signal ?? code}`));
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
