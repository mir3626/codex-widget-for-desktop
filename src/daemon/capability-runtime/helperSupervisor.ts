import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { CapabilityHelperSupervisorLike } from "./types.js";

const DEFAULT_MAX_STDOUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 128 * 1024;

export class CapabilityHelperSupervisor implements CapabilityHelperSupervisorLike {
  async runJson(input: Parameters<CapabilityHelperSupervisorLike["runJson"]>[0]): ReturnType<CapabilityHelperSupervisorLike["runJson"]> {
    const startedAt = Date.now();
    const helperDiagnostics = readHelperDiagnostics(input.command);
    return await new Promise((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(input.command, input.args ?? [], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: sanitizeEnv(input.env)
        });
      } catch (error) {
        resolve({
          ok: false,
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error.message : String(error),
          metadata: { spawnFailed: true, elapsedMs: Date.now() - startedAt, helper: helperDiagnostics }
        });
        return;
      }

      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let settled = false;
      const maxStdout = input.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
      const maxStderr = input.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
      const finish = (response: Awaited<ReturnType<CapabilityHelperSupervisorLike["runJson"]>>) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
        resolve(response);
      };
      const failAndKill = (message: string, reason: string) => {
        killProcessTree(child);
        finish({
          ok: false,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          error: message,
          metadata: { reason, elapsedMs: Date.now() - startedAt, helper: helperDiagnostics }
        });
      };
      const timer = setTimeout(() => {
        failAndKill("Capability helper timed out.", "timeout");
      }, Math.max(1, input.timeoutMs));
      const onAbort = () => {
        failAndKill("Capability helper cancelled.", "cancelled");
      };

      input.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk, maxStdout);
        if (stdout.byteLength >= maxStdout) {
          failAndKill("Capability helper stdout exceeded byte limit.", "stdout_limit");
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk, maxStderr);
      });
      child.on("error", (error) => {
        finish({
          ok: false,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          error: error.message,
          metadata: { childError: true, elapsedMs: Date.now() - startedAt, helper: helperDiagnostics }
        });
      });
      child.on("close", (code, signal) => {
        const stdoutText = stdout.toString("utf8").trim();
        const stderrText = stderr.toString("utf8").trim();
        if (code !== 0) {
          finish({
            ok: false,
            stdout: stdoutText,
            stderr: stderrText,
            exitCode: code,
            signal,
            error: `Capability helper exited with ${signal ?? code}.`,
            metadata: { elapsedMs: Date.now() - startedAt, helper: helperDiagnostics }
          });
          return;
        }
        try {
          const output = stdoutText ? JSON.parse(stdoutText) as unknown : undefined;
          finish({
            ok: true,
            output,
            stdout: stdoutText,
            stderr: stderrText,
            exitCode: code,
            signal,
            metadata: { elapsedMs: Date.now() - startedAt, helper: helperDiagnostics }
          });
        } catch (error) {
          finish({
            ok: false,
            stdout: stdoutText,
            stderr: stderrText,
            exitCode: code,
            signal,
            error: `Capability helper returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            metadata: { invalidJson: true, elapsedMs: Date.now() - startedAt, helper: helperDiagnostics }
          });
        }
      });

      child.stdin.end(JSON.stringify(input.request));
    });
  }
}

function readHelperDiagnostics(command: string): Record<string, unknown> {
  const diagnostics: Record<string, unknown> = {
    command,
    implementation: inferImplementation(command),
    signature: "not_checked"
  };
  if (!isAbsolute(command) || !existsSync(command)) {
    return diagnostics;
  }
  try {
    const stats = statSync(command);
    const bytes = readFileSync(command);
    diagnostics.path = command;
    diagnostics.size = stats.size;
    diagnostics.sha256 = createHash("sha256").update(bytes).digest("hex");
    diagnostics.modifiedAt = stats.mtime.toISOString();
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : String(error);
  }
  return diagnostics;
}

function inferImplementation(command: string): string {
  const normalized = command.toLowerCase();
  if (normalized.endsWith("node.exe") || normalized.endsWith("node")) return "node";
  if (normalized.endsWith("powershell.exe") || normalized.endsWith("powershell")) return "powershell";
  if (normalized.endsWith(".exe")) return "native";
  if (normalized.endsWith(".cmd") || normalized.endsWith(".bat")) return "cmd";
  if (normalized.endsWith(".ps1")) return "powershell";
  return "unknown";
}

function appendBounded(current: Buffer<ArrayBufferLike>, chunk: Buffer, maxBytes: number): Buffer<ArrayBufferLike> {
  return Buffer.concat([current, chunk]).subarray(0, maxBytes);
}

function sanitizeEnv(extra: Record<string, string | undefined> | undefined): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "LOCALAPPDATA",
    "APPDATA",
    "USERPROFILE"
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  child.kill("SIGKILL");
}
