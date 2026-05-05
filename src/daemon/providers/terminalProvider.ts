import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { AgentRequest } from "../agent.js";
import { resolveCodexExecutionContext, terminateProcessTree } from "../codexRuntime.js";
import type { ToolEmitter } from "../../shared/protocol.js";

type TerminalCommand = {
  command: string;
  shellLabel: string;
};

const DEFAULT_TERMINAL_TIMEOUT_MS = 60_000;
const DEFAULT_TERMINAL_MAX_OUTPUT_CHARS = 32_000;

export async function maybeRunTerminalProvider(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal
): Promise<boolean> {
  if (request.mode !== "terminal") {
    return false;
  }

  const parsed = extractTerminalCommand(request.text);
  if (!parsed) {
    return false;
  }

  emit({ type: "session.state", state: "tooling", id: request.id });

  if (isDangerousTerminalCommand(parsed.command) && process.env.CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE !== "1") {
    const response = [
      "Terminal command was blocked before execution.",
      "",
      "The command looks destructive. Run it from the CLI, or set `CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE=1` only for a trusted local test.",
      "",
      "```text",
      parsed.command,
      "```"
    ].join("\n");
    emit({ type: "message.delta", id: request.id, text: response });
    emit({ type: "message.completed", id: request.id, text: response });
    emit({ type: "session.state", state: "idle", id: request.id });
    return true;
  }

  await runTerminalCommand(parsed, request, emit, signal);
  return true;
}

function extractTerminalCommand(text: string): TerminalCommand | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = /^```(?<lang>[A-Za-z0-9_-]+)?\s*\r?\n(?<command>[\s\S]*?)\r?\n```$/m.exec(trimmed);
  if (fenced?.groups?.command?.trim()) {
    return {
      command: fenced.groups.command.trim(),
      shellLabel: normalizeShellLabel(fenced.groups.lang)
    };
  }

  const prefixed = /^(?:\/run|run:|cmd:|shell:|terminal:|실행:|명령:|[$>]|PS>)\s*(?<command>[\s\S]+)$/i.exec(trimmed);
  if (prefixed?.groups?.command?.trim()) {
    return {
      command: prefixed.groups.command.trim(),
      shellLabel: defaultShellLabel()
    };
  }

  if (process.env.CODEX_WIDGET_TERMINAL_ALLOW_UNPREFIXED === "1" && !trimmed.includes("\n")) {
    return {
      command: trimmed,
      shellLabel: defaultShellLabel()
    };
  }

  return null;
}

async function runTerminalCommand(
  parsed: TerminalCommand,
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal
): Promise<void> {
  const tool = `terminal:${request.id}`;
  const cwd = resolve(process.env.CODEX_WIDGET_TERMINAL_WORKDIR?.trim() || resolveCodexExecutionContext().workdir);
  const timeoutMs = normalizePositiveNumber(process.env.CODEX_WIDGET_TERMINAL_TIMEOUT_MS, DEFAULT_TERMINAL_TIMEOUT_MS);
  const maxOutputChars = normalizePositiveNumber(
    process.env.CODEX_WIDGET_TERMINAL_MAX_OUTPUT_CHARS,
    DEFAULT_TERMINAL_MAX_OUTPUT_CHARS
  );
  const child = spawnTerminalProcess(parsed.command, cwd);
  let output = "";
  let truncated = false;

  emit({ type: "tool.started", id: request.id, tool, label: parsed.command });

  const appendOutput = (chunk: string) => {
    if (!chunk) {
      return;
    }

    emit({ type: "tool.output", id: request.id, tool, chunk });
    if (output.length >= maxOutputChars) {
      truncated = true;
      return;
    }

    const remaining = maxOutputChars - output.length;
    output += chunk.slice(0, remaining);
    truncated = truncated || chunk.length > remaining;
  };

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  const timeout = setTimeout(() => terminateProcessTree(child.pid), timeoutMs);
  const abort = () => terminateProcessTree(child.pid);
  signal.addEventListener("abort", abort, { once: true });

  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolveExit(code));
  }).finally(() => {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  });

  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  emit({ type: "tool.completed", id: request.id, tool });

  const response = renderTerminalResponse({
    command: parsed.command,
    shellLabel: parsed.shellLabel,
    cwd,
    exitCode,
    output,
    truncated
  });
  emit({ type: "message.delta", id: request.id, text: response });
  emit({ type: "message.completed", id: request.id, text: response });
  emit({ type: "session.state", state: "idle", id: request.id });
}

function spawnTerminalProcess(command: string, cwd: string) {
  if (process.platform === "win32") {
    return spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
  }

  return spawn(process.env.SHELL || "/bin/sh", ["-lc", command], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function renderTerminalResponse(input: {
  command: string;
  shellLabel: string;
  cwd: string;
  exitCode: number | null;
  output: string;
  truncated: boolean;
}): string {
  const output = input.output.trimEnd();
  const status = input.exitCode === 0 ? "completed" : `exited with ${input.exitCode ?? "unknown"}`;

  return [
    "### Terminal",
    "",
    `\`${status}\` in \`${input.cwd}\``,
    "",
    `\`\`\`${input.shellLabel}`,
    input.command,
    "```",
    "",
    output
      ? [
          "#### Output",
          "",
          "```text",
          input.truncated ? `${output}\n\n[output truncated]` : output,
          "```"
        ].join("\n")
      : "No output."
  ].join("\n");
}

function isDangerousTerminalCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return [
    /\brm\s+-rf\b/,
    /\bremove-item\b[\s\S]*\b-recurse\b/,
    /\bdel(?:ete)?\b[\s\S]*\s\/s\b/,
    /\brmdir\b[\s\S]*\s\/s\b/,
    /\bformat\b/,
    /\bshutdown\b/,
    /\brestart-computer\b/,
    /\bstop-computer\b/,
    /\breg\s+delete\b/,
    /\bdiskpart\b/
  ].some((pattern) => pattern.test(normalized));
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : fallback;
}

function normalizeShellLabel(value: string | undefined): string {
  if (!value) {
    return defaultShellLabel();
  }
  const normalized = value.trim().toLowerCase();
  if (["powershell", "ps1", "pwsh"].includes(normalized)) {
    return "powershell";
  }
  if (["cmd", "bat"].includes(normalized)) {
    return "cmd";
  }
  if (["bash", "sh", "zsh"].includes(normalized)) {
    return "bash";
  }
  return normalized || defaultShellLabel();
}

function defaultShellLabel(): string {
  return process.platform === "win32" ? "powershell" : "bash";
}
