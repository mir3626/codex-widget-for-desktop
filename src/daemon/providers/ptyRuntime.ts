import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire as createNodeRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { terminateProcessTree } from "../codexRuntime.js";

export type TerminalBackendKind = "node-pty" | "pipe";

export type TerminalRuntime = {
  kind: TerminalBackendKind;
  description: string;
  shellLabel: string;
  pid?: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  isRunning: () => boolean;
  onData: (listener: (chunk: string) => void) => void;
  onExit: (listener: () => void) => void;
};

type NodePty = {
  pid: number;
  process: string;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (listener: (data: string) => void) => { dispose: () => void };
  onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => { dispose: () => void };
};

type NodePtyModule = {
  spawn: (file: string, args: string[], options: Record<string, unknown>) => NodePty;
};

let cachedNodePty: NodePtyModule | null | undefined;

export function spawnTerminalRuntime(cwd: string): TerminalRuntime {
  if (process.env.CODEX_WIDGET_TERMINAL_BACKEND !== "pipe") {
    const pty = loadNodePty();
    if (pty) {
      return spawnNodePtyRuntime(pty, cwd);
    }
  }

  return spawnPipeRuntime(cwd);
}

export function resolveNodePtyRuntime(): { packageJsonPath?: string; error?: string } {
  const explicitDir = process.env.CODEX_WIDGET_PTY_RUNTIME_DIR?.trim();
  const candidates = [
    explicitDir ? join(explicitDir, "node_modules", "node-pty", "package.json") : undefined,
    resolve(process.cwd(), "dist/pty-runtime/node_modules/node-pty/package.json"),
    resolve(process.cwd(), "_up_/dist/pty-runtime/node_modules/node-pty/package.json"),
    fileURLToPath(new URL("../pty-runtime/node_modules/node-pty/package.json", import.meta.url)),
    fileURLToPath(new URL("../../pty-runtime/node_modules/node-pty/package.json", import.meta.url)),
    fileURLToPath(new URL("../../../dist/pty-runtime/node_modules/node-pty/package.json", import.meta.url)),
    fileURLToPath(new URL("../../../_up_/dist/pty-runtime/node_modules/node-pty/package.json", import.meta.url))
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { packageJsonPath: candidate };
    }
  }

  try {
    createNodeRequire(import.meta.url).resolve("node-pty");
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : "node-pty was not found." };
  }
}

function loadNodePty(): NodePtyModule | undefined {
  if (cachedNodePty !== undefined) {
    return cachedNodePty ?? undefined;
  }

  const runtime = resolveNodePtyRuntime();
  try {
    const runtimeRequire = runtime.packageJsonPath ? createNodeRequire(runtime.packageJsonPath) : createNodeRequire(import.meta.url);
    cachedNodePty = runtimeRequire("node-pty") as NodePtyModule;
  } catch {
    cachedNodePty = null;
  }
  return cachedNodePty ?? undefined;
}

function spawnNodePtyRuntime(pty: NodePtyModule, cwd: string): TerminalRuntime {
  const isWindows = process.platform === "win32";
  const file = process.env.CODEX_WIDGET_TERMINAL_SHELL?.trim() || (isWindows ? "cmd.exe" : process.env.SHELL || "/bin/sh");
  const args = isWindows ? ["/Q", "/K"] : ["-i"];
  const term = pty.spawn(file, args, {
    cwd,
    env: process.env,
    cols: normalizeDimension(process.env.CODEX_WIDGET_TERMINAL_COLS, 100),
    rows: normalizeDimension(process.env.CODEX_WIDGET_TERMINAL_ROWS, 30),
    name: "xterm-256color",
    useConpty: true,
    useConptyDll: process.env.CODEX_WIDGET_TERMINAL_USE_BUNDLED_CONPTY !== "0"
  });
  let running = true;
  const exitListeners = new Set<() => void>();
  term.onExit(() => {
    running = false;
    for (const listener of exitListeners) {
      listener();
    }
  });

  return {
    kind: "node-pty",
    description: isWindows ? "node-pty ConPTY" : "node-pty",
    shellLabel: isWindows ? "cmd" : "bash",
    pid: term.pid,
    write: (data) => term.write(data),
    resize: (cols, rows) => term.resize(cols, rows),
    kill: () => {
      running = false;
      term.kill();
    },
    isRunning: () => running,
    onData: (listener) => {
      term.onData(listener);
    },
    onExit: (listener) => {
      exitListeners.add(listener);
    }
  };
}

function spawnPipeRuntime(cwd: string): TerminalRuntime {
  const child = spawnPipeSessionProcess(cwd);
  const exitListeners = new Set<() => void>();
  child.on("exit", () => {
    for (const listener of exitListeners) {
      listener();
    }
  });
  child.on("error", () => {
    for (const listener of exitListeners) {
      listener();
    }
  });

  return {
    kind: "pipe",
    description: "stdio shell",
    shellLabel: process.platform === "win32" ? "cmd" : "bash",
    pid: child.pid,
    write: (data) => child.stdin.write(data),
    resize: () => undefined,
    kill: () => terminateProcessTree(child.pid),
    isRunning: () => child.exitCode === null && !child.killed,
    onData: (listener) => {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", listener);
      child.stderr.on("data", listener);
    },
    onExit: (listener) => {
      exitListeners.add(listener);
    }
  };
}

function spawnPipeSessionProcess(cwd: string): ChildProcessWithoutNullStreams {
  if (process.platform === "win32") {
    return spawnChild("cmd.exe", ["/Q", "/K"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
  }

  return spawnChild(process.env.SHELL || "/bin/sh", ["-i"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function normalizeDimension(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : fallback;
}
