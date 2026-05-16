import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
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
    value?: string;
    placeholder?: string;
    selector?: string;
    bbox?: { x: number; y: number; w: number; h: number };
    visible?: boolean;
    enabled?: boolean;
    editable?: boolean;
    checked?: boolean;
    selected?: boolean;
    inputType?: string;
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
      command:
        | "status"
        | "observe"
        | "watch_preflight"
        | "foreground_watch_execute"
        | "capture_screenshot"
        | "focus_window"
        | "double_click"
        | "move"
        | "drag"
        | "key"
        | "clipboard_set_scoped"
        | "clipboard_restore"
        | "file_picker_select"
        | "menu_command"
        | "browser_permission_popup_click";
      timeoutMs: number;
      session: Pick<BrowserActionSession, "id" | "mode" | "source">;
      watchPreflight?: {
        monitorMs?: number;
        sampleIntervalMs?: number;
        idleThresholdMs?: number;
        requireNoUserInput?: boolean;
        requireActiveWindowStable?: boolean;
      };
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
  source?: "env" | "native" | "powershell";
  implementation?: "native" | "powershell" | "node" | "cmd" | "unknown";
};

export type NativeDesktopHelperSignatureStatus = {
  checked: boolean;
  status: "valid" | "unsigned" | "unavailable" | "not_applicable" | "not_windows" | "error";
  authenticodeStatus?: string;
  statusMessage?: string;
  signerCertificate?: string;
  detail: string;
  error?: string;
};

export type NativeDesktopHelperReleaseReadiness = {
  schemaVersion: "native-desktop-helper-release-readiness.v1";
  releaseReady: boolean;
  developmentOnly: boolean;
  helper: {
    configured: boolean;
    exists: boolean;
    path?: string;
    source?: NativeDesktopHelperAvailability["source"];
    implementation?: NativeDesktopHelperAvailability["implementation"];
    size?: number;
    sha256?: string;
    modifiedAt?: string;
  };
  signature: NativeDesktopHelperSignatureStatus;
  blockers: string[];
  notes: string[];
};

export type NativeDesktopHelperCapability = {
  name: string;
  supported: boolean;
  requiresForeground: boolean;
  requiresApproval: boolean;
  reversible: boolean;
  redactionBehavior: string;
  maxTimeoutMs: number;
  status: string;
};

export type NativeDesktopHelperCapabilityManifest = {
  schemaVersion: "browser-native-desktop-helper-capability-manifest.v2";
  helperSchemaVersion?: string;
  helperVersion?: string;
  scope?: string;
  boundary?: Record<string, unknown>;
  commands: NativeDesktopHelperCapability[];
};

export function readNativeDesktopHelperCapabilityManifest(metadata?: Record<string, unknown>): NativeDesktopHelperCapabilityManifest | undefined {
  const manifest = metadata?.capabilityManifest;
  if (!manifest || typeof manifest !== "object") {
    return undefined;
  }
  const candidate = manifest as Partial<NativeDesktopHelperCapabilityManifest>;
  if (candidate.schemaVersion !== "browser-native-desktop-helper-capability-manifest.v2" || !Array.isArray(candidate.commands)) {
    return undefined;
  }
  const commands = candidate.commands
    .filter((command): command is NativeDesktopHelperCapability => {
      if (!command || typeof command !== "object") return false;
      const entry = command as Partial<NativeDesktopHelperCapability>;
      return (
        typeof entry.name === "string" &&
        typeof entry.supported === "boolean" &&
        typeof entry.requiresForeground === "boolean" &&
        typeof entry.requiresApproval === "boolean" &&
        typeof entry.reversible === "boolean" &&
        typeof entry.redactionBehavior === "string" &&
        typeof entry.maxTimeoutMs === "number" &&
        typeof entry.status === "string"
      );
    });
  return {
    schemaVersion: candidate.schemaVersion,
    helperSchemaVersion: typeof candidate.helperSchemaVersion === "string" ? candidate.helperSchemaVersion : undefined,
    helperVersion: typeof candidate.helperVersion === "string" ? candidate.helperVersion : undefined,
    scope: typeof candidate.scope === "string" ? candidate.scope : undefined,
    boundary: candidate.boundary && typeof candidate.boundary === "object" ? candidate.boundary as Record<string, unknown> : undefined,
    commands
  };
}

export function getNativeDesktopHelperAvailability(): NativeDesktopHelperAvailability {
  const resolved = resolveNativeDesktopHelperPath();
  if (!resolved.path) {
    return {
      configured: false,
      exists: false,
      detail: `Set ${NATIVE_DESKTOP_HELPER_ENV} to a signed/bounded helper executable or script to enable executable native desktop Browser Action fallback.`
    };
  }
  const exists = existsSync(resolved.path);
  return {
    configured: true,
    path: resolved.path,
    exists,
    source: resolved.source,
    implementation: resolved.implementation,
    detail: exists
      ? resolved.source === "env"
        ? `Native desktop helper path is configured (${resolved.implementation ?? "unknown"}).`
        : resolved.source === "native"
          ? "Bundled native desktop Rust helper was found."
          : "Bundled PowerShell native desktop helper fallback was found."
      : resolved.source === "env"
        ? "Native desktop helper path is configured but does not exist."
        : resolved.source === "native"
          ? "Bundled native desktop Rust helper was not found."
          : "Bundled PowerShell native desktop helper fallback was not found."
  };
}

export async function getNativeDesktopHelperReleaseReadiness(): Promise<NativeDesktopHelperReleaseReadiness> {
  const availability = getNativeDesktopHelperAvailability();
  const helperEvidence = readHelperFileEvidence(availability);
  const blockers: string[] = [];
  const notes: string[] = [];

  if (!availability.configured || !availability.path) {
    blockers.push("helper_not_configured");
  }
  if (availability.configured && !availability.exists) {
    blockers.push("helper_path_missing");
  }
  if (availability.implementation !== "native") {
    blockers.push("native_executable_required_for_release");
    notes.push("PowerShell, Node, cmd, and unknown helper implementations are development-only for release readiness.");
  }
  if (availability.source === "powershell") {
    blockers.push("powershell_fallback_development_only");
    notes.push("Release builds must not rely on PowerShell ExecutionPolicy Bypass fallback.");
  }

  const signature = availability.path && availability.exists && availability.implementation === "native"
    ? await readAuthenticodeSignature(availability.path)
    : {
        checked: false,
        status: availability.implementation === "native" ? "unavailable" : "not_applicable",
        detail: availability.implementation === "native"
          ? "Native helper signature could not be checked because the helper is unavailable."
          : "Authenticode signature checks apply only to native helper executables."
      } satisfies NativeDesktopHelperSignatureStatus;

  if (availability.implementation === "native" && signature.status !== "valid") {
    blockers.push("authenticode_signature_required");
  }

  const uniqueBlockers = Array.from(new Set(blockers));
  return {
    schemaVersion: "native-desktop-helper-release-readiness.v1",
    releaseReady: uniqueBlockers.length === 0,
    developmentOnly: uniqueBlockers.length > 0,
    helper: {
      configured: availability.configured,
      exists: availability.exists,
      path: availability.path,
      source: availability.source,
      implementation: availability.implementation,
      ...helperEvidence
    },
    signature,
    blockers: uniqueBlockers,
    notes
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

function resolveNativeDesktopHelperPath(): { path?: string; source?: "env" | "native" | "powershell"; implementation?: NativeDesktopHelperAvailability["implementation"] } {
  const configured = process.env[NATIVE_DESKTOP_HELPER_ENV]?.trim();
  if (configured) {
    return { path: configured, source: "env", implementation: inferHelperImplementation(configured) };
  }
  const candidates: Array<{ path: string; source: "native" | "powershell"; implementation: NativeDesktopHelperAvailability["implementation"] }> = [
    {
      path: resolve(process.cwd(), "dist", "browser-native-desktop-helper", "browser-native-desktop-helper.exe"),
      source: "native",
      implementation: "native"
    },
    {
      path: resolve(process.cwd(), "_up_", "dist", "browser-native-desktop-helper", "browser-native-desktop-helper.exe"),
      source: "native",
      implementation: "native"
    },
    {
      path: resolve(process.cwd(), "providers", "browser-native-desktop-helper", "browser-native-desktop-helper.ps1"),
      source: "powershell",
      implementation: "powershell"
    },
    {
      path: resolve(process.cwd(), "_up_", "providers", "browser-native-desktop-helper", "browser-native-desktop-helper.ps1"),
      source: "powershell",
      implementation: "powershell"
    }
  ];
  const found = candidates.find((candidate) => existsSync(candidate.path));
  return found ?? {};
}

function inferHelperImplementation(helperPath: string): NativeDesktopHelperAvailability["implementation"] {
  const extension = extname(helperPath).toLowerCase();
  if (extension === ".ps1") return "powershell";
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return "node";
  if (extension === ".cmd" || extension === ".bat") return "cmd";
  if (extension === ".exe") return "native";
  return "unknown";
}

function readHelperFileEvidence(availability: NativeDesktopHelperAvailability): { size?: number; sha256?: string; modifiedAt?: string } {
  if (!availability.path || !availability.exists) {
    return {};
  }
  try {
    const stats = statSync(availability.path);
    const bytes = readFileSync(availability.path);
    return {
      size: stats.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      modifiedAt: stats.mtime.toISOString()
    };
  } catch {
    return {};
  }
}

async function readAuthenticodeSignature(helperPath: string): Promise<NativeDesktopHelperSignatureStatus> {
  if (process.platform !== "win32") {
    return {
      checked: false,
      status: "not_windows",
      detail: "Authenticode signature verification is Windows-only."
    };
  }

  const command = [
    "$ErrorActionPreference = 'Continue'",
    "$sig = Get-AuthenticodeSignature -LiteralPath $env:CODEX_WIDGET_HELPER_PATH",
    "[pscustomobject]@{ Status = [string]$sig.Status; StatusMessage = [string]$sig.StatusMessage; SignerCertificate = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null } } | ConvertTo-Json -Compress"
  ].join("; ");
  const result = await runPowerShellSignatureCheck(command, helperPath);
  if (!result.ok) {
    return {
      checked: false,
      status: "unavailable",
      detail: "Native helper signature status is unavailable.",
      error: result.error
    };
  }
  try {
    const parsed = JSON.parse(result.stdout) as { Status?: string; StatusMessage?: string; SignerCertificate?: string | null };
    const status = parsed.Status ?? "";
    if (status === "Valid") {
      return {
        checked: true,
        status: "valid",
        authenticodeStatus: status,
        statusMessage: parsed.StatusMessage,
        signerCertificate: parsed.SignerCertificate ?? undefined,
        detail: "Native helper Authenticode signature is valid."
      };
    }
    return {
      checked: true,
      status: status ? "unsigned" : "unavailable",
      authenticodeStatus: status || undefined,
      statusMessage: parsed.StatusMessage,
      signerCertificate: parsed.SignerCertificate ?? undefined,
      detail: status
        ? "Native helper Authenticode signature is not valid for release readiness."
        : "Native helper Authenticode signature status is unavailable."
    };
  } catch (error) {
    return {
      checked: false,
      status: "error",
      detail: "Native helper signature output could not be parsed.",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runPowerShellSignatureCheck(command: string, helperPath: string): Promise<{ ok: boolean; stdout: string; error?: string }> {
  const env = {
    ...process.env,
    CODEX_WIDGET_HELPER_PATH: helperPath
  };
  const first = await runSignatureCommand("pwsh.exe", ["-NoProfile", "-Command", command], env);
  if (first.ok) {
    return first;
  }
  return runSignatureCommand("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], env);
}

function runSignatureCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ ok: boolean; stdout: string; error?: string }> {
  return new Promise((resolveCheck) => {
    const child = spawn(command, args, {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolveCheck({ ok: false, stdout: "", error: error.message });
    });
    child.on("close", (code, signal) => {
      const trimmed = stdout.trim();
      resolveCheck({
        ok: code === 0 && Boolean(trimmed),
        stdout: trimmed,
        error: code === 0 && trimmed ? undefined : (stderr.trim() || `PowerShell exited with ${signal ?? code}.`)
      });
    });
  });
}
