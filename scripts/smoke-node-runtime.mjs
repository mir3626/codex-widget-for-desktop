#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { createSmokeAppDataEnv } from "./smoke-isolation.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeBin = process.platform === "win32" ? "node.exe" : "node";
const runtimePath = join(root, "dist", "node-runtime", runtimeBin);
const bundledDaemon = join(root, "dist", "daemon-bundle", "standalone.js");

if (!existsSync(runtimePath)) {
  throw new Error(`Missing bundled Node runtime: ${runtimePath}`);
}
if (!existsSync(bundledDaemon)) {
  throw new Error(`Missing bundled daemon entry: ${bundledDaemon}`);
}

const version = await runVersion();
if (version.trim() !== process.version) {
  throw new Error(`Bundled Node version mismatch: expected ${process.version}, saw ${version.trim()}`);
}

const smokeAppData = createSmokeAppDataEnv(process.env, "codex-widget-node-runtime-smoke");
const daemon = spawn(runtimePath, [bundledDaemon], {
  cwd: root,
  env: {
    ...smokeAppData.env,
    CODEX_WIDGET_AUTH_MODE: "mock",
    CODEX_WIDGET_PORT: "0"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
daemon.stdout.setEncoding("utf8");
daemon.stderr.setEncoding("utf8");
daemon.stdout.on("data", (chunk) => {
  stdout += chunk;
});
daemon.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  const port = await waitForPort();
  await smokeWebSocket(port);
  console.log(`node runtime smoke ok: ${version.trim()} daemon port ${port}`);
} finally {
  daemon.kill();
  await waitForExit();
  smokeAppData.cleanup();
}

function runVersion() {
  return new Promise((resolve, reject) => {
    const child = spawn(runtimePath, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(`Bundled Node --version failed with ${code}: ${errorOutput}`));
    });
  });
}

function waitForPort() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for bundled daemon startup. stdout=${stdout} stderr=${stderr}`));
    }, 12_000);

    const interval = setInterval(() => {
      const match = stdout.match(/ws:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) {
        return;
      }
      clearTimeout(timeout);
      clearInterval(interval);
      resolve(Number(match[1]));
    }, 100);

    daemon.on("error", (error) => {
      clearTimeout(timeout);
      clearInterval(interval);
      reject(error);
    });
    daemon.on("exit", (code, signal) => {
      clearTimeout(timeout);
      clearInterval(interval);
      reject(new Error(`Bundled daemon exited early with ${signal ?? code}: ${stderr}`));
    });
  });
}

function smokeWebSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for bundled daemon websocket."));
    }, 8_000);

    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "connected") {
        socket.send(JSON.stringify({ type: "ping" }));
      }
      if (event.type === "pong") {
        clearTimeout(timeout);
        socket.close();
        resolve();
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForExit() {
  return new Promise((resolve) => {
    if (daemon.exitCode !== null || daemon.killed) {
      resolve();
      return;
    }
    daemon.once("exit", resolve);
    setTimeout(resolve, 1500);
  });
}
