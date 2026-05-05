#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const runtimeDir = resolve(process.env.CODEX_WIDGET_PTY_RUNTIME_DIR?.trim() || "dist/pty-runtime");
const manifestPath = join(runtimeDir, "pty-runtime.json");
const packageJsonPath = join(runtimeDir, "node_modules", "node-pty", "package.json");

if (!existsSync(manifestPath) || !existsSync(packageJsonPath)) {
  throw new Error("PTY runtime is missing. Run npm run build:pty-runtime first.");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.available !== true || manifest.package !== "node-pty") {
  throw new Error(`Unexpected PTY runtime manifest: ${JSON.stringify(manifest)}`);
}

const runtimeRequire = createRequire(packageJsonPath);
const pty = runtimeRequire("node-pty");
if (typeof pty.spawn !== "function") {
  throw new Error("node-pty runtime did not expose spawn().");
}

await verifyPtySpawn(pty);
verifyBundledDaemonCanLoadPtyRuntime(runtimeDir);
console.log(`pty runtime smoke ok: ${manifest.package}@${manifest.version}`);
process.exit(0);

function verifyPtySpawn(pty) {
  return new Promise((resolvePromise, reject) => {
    const isWindows = process.platform === "win32";
    const term = pty.spawn(isWindows ? "cmd.exe" : process.env.SHELL || "/bin/sh", isWindows ? ["/Q", "/K"] : ["-i"], {
      cwd: process.cwd(),
      env: process.env,
      cols: 80,
      rows: 24,
      name: "xterm-256color",
      useConpty: true,
      useConptyDll: isWindows
    });
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Timed out waiting for PTY output: ${output}`));
      }
    }, 8000);

    const cleanup = () => {
      clearTimeout(timeout);
      dataDisposable.dispose();
      exitDisposable.dispose();
      try {
        term.kill();
      } catch {
        // The PTY may have already exited after receiving the shell exit command.
      }
    };

    const dataDisposable = term.onData((chunk) => {
      output += chunk;
      if (!settled && output.includes("__CODEX_WIDGET_PTY_SMOKE__:0")) {
        settled = true;
        term.write(isWindows ? "exit\r" : "exit\n");
        setTimeout(() => {
          cleanup();
          resolvePromise(undefined);
        }, 200);
      }
    });
    const exitDisposable = term.onExit(() => {
      if (settled) {
        cleanup();
        resolvePromise(undefined);
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(`PTY exited before marker output: ${output}`));
    });
    term.write(isWindows ? "echo __CODEX_WIDGET_PTY_SMOKE__:%ERRORLEVEL%\r\n" : "printf '__CODEX_WIDGET_PTY_SMOKE__:%s\\n' \"$?\"\n");
  });
}

function verifyBundledDaemonCanLoadPtyRuntime(runtimeDir) {
  const result = spawnSync(process.execPath, ["-e", "import('./dist/daemon/providers/ptyRuntime.js').then((m)=>{const r=m.resolveNodePtyRuntime(); if(!r?.packageJsonPath) throw new Error('no pty runtime'); console.log(r.packageJsonPath);})"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WIDGET_PTY_RUNTIME_DIR: runtimeDir
    },
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
}
