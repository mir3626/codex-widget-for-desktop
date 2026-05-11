#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const daemonEntry = join(root, "dist", "daemon", "standalone.js");
const daemonDist = join(root, "dist", "daemon");
const devAuthProxyEntry = join(root, "scripts", "dev-auth-proxy.mjs");
const daemonPort = process.env.CODEX_WIDGET_PORT ?? "4128";
const devAuthProxyPort = process.env.CODEX_WIDGET_DEV_AUTH_PROXY_PORT ?? "8787";
const children = new Set();
const expectedDaemonExits = new WeakSet();

let daemonProcess;
let daemonRestartTimer;
let daemonStartTimer;
let shuttingDown = false;

buildDaemonOnce();

const daemonWatcher = watchDaemonDist();
const configWatcher = watchConfigFiles();
const tscWatch = spawnManaged("tsc-watch", localBin("tsc"), [
  "-p",
  "tsconfig.node.json",
  "--watch",
  "--preserveWatchOutput"
]);
const vite = spawnManaged("vite", localBin("vite"), ["--host", "127.0.0.1"]);

startDevAuthProxy();
startDaemon("initial");

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));
process.on("uncaughtException", (error) => {
  console.error(error);
  shutdown(1);
});

function buildDaemonOnce() {
  const command = commandFor(localBin("tsc"), ["-p", "tsconfig.node.json"]);
  const result = spawnSync(command.file, command.args, {
    cwd: root,
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function watchDaemonDist() {
  if (!existsSync(daemonDist)) {
    throw new Error(`Daemon dist directory does not exist: ${daemonDist}`);
  }

  return watch(daemonDist, { recursive: true }, (_eventType, filename) => {
    if (!filename || !filename.endsWith(".js")) {
      return;
    }
    scheduleDaemonRestart(filename.toString());
  });
}

function watchConfigFiles() {
  return watch(root, (_eventType, filename) => {
    const name = filename?.toString();
    if (name === ".env" || name === ".env.local") {
      scheduleDaemonRestart(name);
    }
  });
}

function scheduleDaemonRestart(reason) {
  if (shuttingDown) {
    return;
  }

  clearTimeout(daemonRestartTimer);
  daemonRestartTimer = setTimeout(() => restartDaemon(reason), 250);
}

function startDaemon(reason) {
  if (shuttingDown) {
    return;
  }

  if (!existsSync(daemonEntry)) {
    console.error(`Cannot start daemon; missing ${daemonEntry}`);
    shutdown(1);
    return;
  }

  console.log(`[dev-hot] starting daemon (${reason}) on port ${daemonPort}`);
  daemonProcess = spawnManaged("daemon", process.execPath, [daemonEntry], {
    env: {
      ...process.env,
      CODEX_WIDGET_PORT: daemonPort,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning")
    }
  });
}

function startDevAuthProxy() {
  if (process.env.CODEX_WIDGET_DEV_AUTH_PROXY !== "1") {
    console.log("[dev-hot] dev auth proxy disabled; set CODEX_WIDGET_DEV_AUTH_PROXY=1 to enable");
    return;
  }

  if (!existsSync(devAuthProxyEntry)) {
    console.error(`Cannot start dev auth proxy; missing ${devAuthProxyEntry}`);
    shutdown(1);
    return;
  }

  console.log(`[dev-hot] starting dev auth proxy on port ${devAuthProxyPort}`);
  spawnManaged("dev-auth-proxy", process.execPath, [devAuthProxyEntry], {
    env: {
      ...process.env,
      CODEX_WIDGET_DEV_AUTH_PROXY_PORT: devAuthProxyPort,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning")
    }
  });
}

function restartDaemon(reason) {
  if (shuttingDown) {
    return;
  }

  clearTimeout(daemonStartTimer);
  const previous = daemonProcess;
  if (previous && previous.exitCode === null && !previous.killed) {
    console.log(`[dev-hot] restarting daemon after ${reason}`);
    expectedDaemonExits.add(previous);
    previous.kill();
  }

  daemonProcess = undefined;
  daemonStartTimer = setTimeout(() => startDaemon(reason), 500);
}

function spawnManaged(name, command, args, options = {}) {
  const resolved = commandFor(command, args);
  const child = spawn(resolved.file, resolved.args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
    ...options
  });

  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);

    if (shuttingDown) {
      return;
    }

    if (name === "daemon" && expectedDaemonExits.has(child)) {
      return;
    }

    console.error(`[dev-hot] ${name} exited with ${signal ?? code ?? "unknown"}`);
    shutdown(code ?? 1);
  });

  return child;
}

function shutdown(code) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearTimeout(daemonRestartTimer);
  clearTimeout(daemonStartTimer);
  daemonWatcher.close();
  configWatcher.close();

  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
  }

  setTimeout(() => process.exit(code), 200);
}

function localBin(name) {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  return join(root, "node_modules", ".bin", executable);
}

function commandFor(command, args) {
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return {
      file: "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args]
    };
  }

  return {
    file: command,
    args
  };
}

function appendNodeOption(current, option) {
  const existing = String(current ?? "").trim();
  return existing.includes(option) ? existing : [existing, option].filter(Boolean).join(" ");
}
