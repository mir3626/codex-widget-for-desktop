import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import type { BrowserAction, BrowserActionSession, BrowserElement } from "../../types.js";

export const NATIVE_DESKTOP_HELPER_ENV = "CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER";

export type NativeDesktopWindow = {
  processName: string;
  id: number;
  title: string;
};

export type NativeDesktopHelperSnapshot = {
  url?: string;
  title?: string;
  text?: string;
  windows?: NativeDesktopWindow[];
  elements?: Array<{
    id?: string;
    role?: string;
    tagName?: string;
    label?: string;
    text?: string;
    selector?: string;
    visible?: boolean;
    enabled?: boolean;
    editable?: boolean;
    confidence?: number;
    riskHints?: string[];
  }>;
};

export type NativeDesktopHelperResponse = {
  ok: boolean;
  error?: string;
  observation?: NativeDesktopHelperSnapshot;
  after?: NativeDesktopHelperSnapshot;
  metadata?: Record<string, unknown>;
};

export type NativeDesktopHelperRequest =
  | {
      schemaVersion: "browser-native-desktop-helper.v1";
      requestId: string;
      command: "status" | "observe";
      timeoutMs: number;
      session: Pick<BrowserActionSession, "id" | "mode" | "source">;
    }
  | {
      schemaVersion: "browser-native-desktop-helper.v1";
      requestId: string;
      command: "execute";
      timeoutMs: number;
      session: Pick<BrowserActionSession, "id" | "mode" | "source">;
      action: BrowserAction;
      target?: BrowserElement;
    };

export type NativeDesktopHelperAvailability = {
  configured: boolean;
  path?: string;
  exists: boolean;
  detail: string;
};

export function getNativeDesktopHelperAvailability(): NativeDesktopHelperAvailability {
  const helperPath = process.env[NATIVE_DESKTOP_HELPER_ENV]?.trim();
  if (!helperPath) {
    return {
      configured: false,
      exists: false,
      detail: `Set ${NATIVE_DESKTOP_HELPER_ENV} to a signed/bounded helper executable or script to enable executable native desktop Browser Action fallback.`
    };
  }
  return {
    configured: true,
    path: helperPath,
    exists: existsSync(helperPath),
    detail: existsSync(helperPath) ? "Native desktop helper path is configured." : "Native desktop helper path is configured but does not exist."
  };
}

export async function runNativeDesktopHelper(request: NativeDesktopHelperRequest): Promise<NativeDesktopHelperResponse> {
  const availability = getNativeDesktopHelperAvailability();
  if (!availability.configured || !availability.path) {
    return { ok: false, error: availability.detail };
  }
  if (!availability.exists) {
    return { ok: false, error: availability.detail };
  }

  const { command, args } = buildHelperCommand(availability.path);
  const input = JSON.stringify(request);
  const timeoutMs = Math.max(250, Math.min(request.timeoutMs, 15_000));

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, error: `Native desktop helper timed out after ${timeoutMs}ms.` });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: `Native desktop helper failed to start: ${error.message}` });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve({ ok: false, error: `Native desktop helper returned no JSON output.${stderr ? ` stderr: ${stderr.trim()}` : ""}` });
        return;
      }
      try {
        const parsed = JSON.parse(trimmed) as NativeDesktopHelperResponse;
        if ((code ?? 0) !== 0 || signal) {
          resolve({
            ok: false,
            error: parsed.error ?? `Native desktop helper exited with ${signal ?? code}.`,
            metadata: {
              ...parsed.metadata,
              helperExitCode: code,
              helperSignal: signal ?? undefined
            }
          });
          return;
        }
        resolve({
          ...parsed,
          metadata: {
            ...parsed.metadata,
            helperExitCode: code,
            helperSignal: signal ?? undefined
          }
        });
      } catch (error) {
        resolve({
          ok: false,
          error: `Native desktop helper returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          metadata: {
            helperExitCode: code,
            helperSignal: signal ?? undefined,
            stderr: stderr.trim() || undefined
          }
        });
      }
    });

    child.stdin.end(input, "utf8");
  });
}

function buildHelperCommand(helperPath: string): { command: string; args: string[] } {
  const extension = extname(helperPath).toLowerCase();
  if (extension === ".ps1") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath]
    };
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return { command: process.execPath, args: [helperPath] };
  }
  if (extension === ".cmd" || extension === ".bat") {
    return { command: "cmd.exe", args: ["/c", helperPath] };
  }
  return { command: helperPath, args: [] };
}
