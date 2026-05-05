import { resolve } from "node:path";
import type { AgentRequest } from "../agent.js";
import { resolveCodexExecutionContext } from "../codexRuntime.js";
import { spawnTerminalRuntime, type TerminalRuntime } from "./ptyRuntime.js";
import type { ToolEmitter } from "../../shared/protocol.js";

type TerminalSessionCommand =
  | { type: "start" }
  | { type: "stop" }
  | { type: "status" }
  | { type: "write"; data: string; label: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "run"; command: string };

type PendingCommand = {
  sentinel: string;
  output: string;
  emittedLength: number;
  resolve: (value: { output: string; exitCode: number | null }) => void;
  reject: (error: Error) => void;
  emit: ToolEmitter;
  requestId: string;
  tool: string;
  timer: NodeJS.Timeout;
};

const DEFAULT_SESSION_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_CHARS = 32_000;
const DEFAULT_RAW_INPUT_DRAIN_MS = 1_200;
const DEFAULT_RAW_INPUT_QUIET_MS = 160;

class TerminalSession {
  private child: TerminalRuntime | undefined;
  private cwd = "";
  private pending: PendingCommand | undefined;
  private idleOutput: ((chunk: string) => void) | undefined;

  isRunning(): boolean {
    return Boolean(this.child?.isRunning());
  }

  start(): string {
    if (this.isRunning()) {
      return `Terminal session already running in ${this.cwd} (${this.child?.description ?? "unknown backend"}).`;
    }

    this.cwd = resolve(process.env.CODEX_WIDGET_TERMINAL_WORKDIR?.trim() || resolveCodexExecutionContext().workdir);
    this.child = spawnTerminalRuntime(this.cwd);
    this.child.onData((chunk) => this.handleOutput(chunk));
    this.child.onExit(() => {
      this.rejectPending(new Error("Terminal session exited."));
      this.child = undefined;
    });

    return `Terminal session started in ${this.cwd} (${this.child.description}).`;
  }

  async run(command: string, request: AgentRequest, emit: ToolEmitter, signal: AbortSignal): Promise<{
    output: string;
    exitCode: number | null;
    cwd: string;
  }> {
    this.start();
    if (!this.child || !this.isRunning()) {
      throw new Error("Terminal session is not running.");
    }
    if (this.pending) {
      throw new Error("Terminal session is already running a command.");
    }
    if (this.idleOutput) {
      throw new Error("Terminal session is already handling raw input.");
    }

    const tool = `terminal-session:${request.id}`;
    const sentinel = `__CODEX_WIDGET_PTY_DONE_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}__`;
    const timeoutMs = normalizePositiveNumber(process.env.CODEX_WIDGET_TERMINAL_TIMEOUT_MS, DEFAULT_SESSION_TIMEOUT_MS);
    const wrappedCommand = wrapSessionCommand(command, sentinel);

    emit({ type: "tool.started", id: request.id, tool, label: command });

    let abort: (() => void) | undefined;
    const result = await new Promise<{ output: string; exitCode: number | null }>((resolveRun, reject) => {
      const timer = setTimeout(() => {
        this.stop();
        reject(new Error("Terminal session command timed out."));
      }, timeoutMs);
      abort = () => {
        this.stop();
        reject(new DOMException("Aborted", "AbortError"));
      };

      this.pending = {
        sentinel,
        output: "",
        emittedLength: 0,
        resolve: resolveRun,
        reject,
        emit,
        requestId: request.id,
        tool,
        timer
      };
      signal.addEventListener("abort", abort, { once: true });
      this.child?.write(wrappedCommand);
    }).finally(() => {
      if (abort) {
        signal.removeEventListener("abort", abort);
      }
    });

    emit({ type: "tool.completed", id: request.id, tool });
    return { ...result, cwd: this.cwd };
  }

  write(data: string, label: string): string {
    this.start();
    if (!this.child || !this.isRunning()) {
      throw new Error("Terminal session is not running.");
    }

    this.child.write(data);
    return `Terminal input sent: ${label}`;
  }

  async writeAndDrain(data: string, label: string, request: AgentRequest, emit: ToolEmitter, signal: AbortSignal): Promise<string> {
    this.start();
    if (!this.child || !this.isRunning()) {
      throw new Error("Terminal session is not running.");
    }
    if (this.pending) {
      throw new Error("Terminal session is already running a command.");
    }

    const tool = `terminal-session:${request.id}`;
    const maxDrainMs = normalizePositiveNumber(process.env.CODEX_WIDGET_TERMINAL_RAW_INPUT_DRAIN_MS, DEFAULT_RAW_INPUT_DRAIN_MS);
    const quietMs = normalizePositiveNumber(process.env.CODEX_WIDGET_TERMINAL_RAW_INPUT_QUIET_MS, DEFAULT_RAW_INPUT_QUIET_MS);

    emit({ type: "tool.started", id: request.id, tool, label });

    await new Promise<void>((resolveDrain, reject) => {
      let settled = false;
      let quietTimer: NodeJS.Timeout | undefined;
      let maxTimer: NodeJS.Timeout | undefined;

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.idleOutput = undefined;
        if (quietTimer) {
          clearTimeout(quietTimer);
        }
        if (maxTimer) {
          clearTimeout(maxTimer);
        }
        signal.removeEventListener("abort", abort);
        if (error) {
          reject(error);
        } else {
          resolveDrain();
        }
      };

      const armQuietTimer = () => {
        if (quietTimer) {
          clearTimeout(quietTimer);
        }
        quietTimer = setTimeout(() => finish(), quietMs);
      };

      const abort = () => finish(new DOMException("Aborted", "AbortError"));
      this.idleOutput = (chunk) => {
        emit({ type: "tool.output", id: request.id, tool, chunk });
        armQuietTimer();
      };

      signal.addEventListener("abort", abort, { once: true });
      maxTimer = setTimeout(() => finish(), maxDrainMs);
      armQuietTimer();
      this.child?.write(data);
    });

    emit({ type: "tool.completed", id: request.id, tool });
    return `Terminal input sent: ${label}`;
  }

  resize(cols: number, rows: number): string {
    this.start();
    if (!this.child || !this.isRunning()) {
      throw new Error("Terminal session is not running.");
    }

    this.child.resize(cols, rows);
    return `Terminal resized to ${cols}x${rows} (${this.child.description}).`;
  }

  stop(): string {
    this.rejectPending(new Error("Terminal session stopped."));
    const child = this.child;
    this.child = undefined;
    if (child?.isRunning()) {
      child.kill();
    }
    return "Terminal session stopped.";
  }

  status(): string {
    return this.isRunning()
      ? `Terminal session running in ${this.cwd} (${this.child?.description ?? "unknown backend"}).`
      : "Terminal session is not running.";
  }

  private handleOutput(chunk: string): void {
    const pending = this.pending;
    if (!pending) {
      this.idleOutput?.(chunk);
      return;
    }

    pending.output += chunk;
    const sentinelIndex = pending.output.indexOf(pending.sentinel);
    if (sentinelIndex < 0) {
      const safeLength = Math.max(0, pending.output.length - pending.sentinel.length - 8);
      if (safeLength > pending.emittedLength) {
        pending.emit({
          type: "tool.output",
          id: pending.requestId,
          tool: pending.tool,
          chunk: pending.output.slice(pending.emittedLength, safeLength)
        });
        pending.emittedLength = safeLength;
      }
      return;
    }

    const beforeSentinel = pending.output.slice(0, sentinelIndex);
    const afterSentinel = pending.output.slice(sentinelIndex + pending.sentinel.length);
    const exitMatch = /^:(?<code>-?\d+)/.exec(afterSentinel.trimStart());
    const exitCode = exitMatch?.groups?.code ? Number(exitMatch.groups.code) : null;
    if (sentinelIndex > pending.emittedLength) {
      pending.emit({
        type: "tool.output",
        id: pending.requestId,
        tool: pending.tool,
        chunk: beforeSentinel.slice(pending.emittedLength)
      });
    }

    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.resolve({ output: beforeSentinel, exitCode });
  }

  private rejectPending(error: Error): void {
    if (!this.pending) {
      return;
    }
    clearTimeout(this.pending.timer);
    const pending = this.pending;
    this.pending = undefined;
    pending.reject(error);
  }
}

const terminalSession = new TerminalSession();

export async function maybeRunTerminalSessionProvider(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal
): Promise<boolean> {
  if (request.mode !== "terminal") {
    return false;
  }

  const parsed = extractTerminalSessionCommand(request.text);
  if (!parsed) {
    return false;
  }

  emit({ type: "session.state", state: "tooling", id: request.id });

  if (parsed.type === "start") {
    completeText(request.id, terminalSession.start(), emit);
    return true;
  }
  if (parsed.type === "stop") {
    completeText(request.id, terminalSession.stop(), emit);
    return true;
  }
  if (parsed.type === "status") {
    completeText(request.id, terminalSession.status(), emit);
    return true;
  }
  if (parsed.type === "write") {
    if (isDangerousTerminalSessionCommand(parsed.data) && process.env.CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE !== "1") {
      completeText(request.id, renderBlockedCommand(parsed.data), emit);
      return true;
    }

    completeText(request.id, await terminalSession.writeAndDrain(parsed.data, parsed.label, request, emit, signal), emit);
    return true;
  }
  if (parsed.type === "resize") {
    completeText(request.id, terminalSession.resize(parsed.cols, parsed.rows), emit);
    return true;
  }

  if (isDangerousTerminalSessionCommand(parsed.command) && process.env.CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE !== "1") {
    completeText(request.id, renderBlockedCommand(parsed.command), emit);
    return true;
  }

  const result = await terminalSession.run(parsed.command, request, emit, signal);
  completeText(request.id, renderSessionResponse(parsed.command, result.cwd, result.exitCode, result.output), emit);
  return true;
}

function extractTerminalSessionCommand(text: string): TerminalSessionCommand | null {
  const trimmed = text.trim();
  const match = /^(?:\/pty|\/session|\/send)\s*(?<command>[\s\S]*)$/i.exec(trimmed);
  const command = match?.groups?.command?.trim();
  if (command === undefined) {
    return null;
  }
  if (!command || /^start$/i.test(command)) {
    return { type: "start" };
  }
  if (/^(?:stop|exit|close)$/i.test(command)) {
    return { type: "stop" };
  }
  if (/^status$/i.test(command)) {
    return { type: "status" };
  }
  const resize = /^resize\s+(?<cols>\d{2,4})x(?<rows>\d{2,4})$/i.exec(command);
  if (resize?.groups?.cols && resize.groups.rows) {
    return {
      type: "resize",
      cols: clampTerminalDimension(Number(resize.groups.cols), 20, 400),
      rows: clampTerminalDimension(Number(resize.groups.rows), 5, 200)
    };
  }
  const key = /^key\s+(?<name>enter|tab|escape|esc|ctrl-c|ctrl-d|backspace)$/i.exec(command);
  if (key?.groups?.name) {
    return mapTerminalKey(key.groups.name);
  }
  const write = /^(?:write|input)\s+(?<data>[\s\S]+)$/i.exec(command);
  if (write?.groups?.data) {
    return {
      type: "write",
      data: decodeTerminalInput(write.groups.data),
      label: write.groups.data
    };
  }
  return { type: "run", command };
}

function completeText(id: string, text: string, emit: ToolEmitter): void {
  emit({ type: "message.delta", id, text });
  emit({ type: "message.completed", id, text });
  emit({ type: "session.state", state: "idle", id });
}

function renderSessionResponse(command: string, cwd: string, exitCode: number | null, output: string): string {
  const maxOutputChars = normalizePositiveNumber(process.env.CODEX_WIDGET_TERMINAL_MAX_OUTPUT_CHARS, DEFAULT_MAX_OUTPUT_CHARS);
  const trimmedOutput = output.trimEnd();
  const truncated = trimmedOutput.length > maxOutputChars;
  const safeOutput = truncated ? `${trimmedOutput.slice(0, maxOutputChars)}\n\n[output truncated]` : trimmedOutput;

  return [
    "### Terminal Session",
    "",
    `\`${exitCode === 0 ? "completed" : `exited with ${exitCode ?? "unknown"}`}\` in \`${cwd}\``,
    "",
    `\`\`\`${terminalSessionShellLabel()}`,
    command,
    "```",
    "",
    safeOutput
      ? ["#### Output", "", "```text", safeOutput, "```"].join("\n")
      : "No output."
  ].join("\n");
}

function wrapSessionCommand(command: string, sentinel: string): string {
  if (process.platform === "win32") {
    return `${command}\r\necho ${sentinel}:%ERRORLEVEL%\r\n`;
  }

  return `${command}\nprintf '\\n${sentinel}:%s\\n' "$?"\n`;
}

function terminalSessionShellLabel(): string {
  return process.platform === "win32" ? "cmd" : "bash";
}

function renderBlockedCommand(command: string): string {
  return [
    "Terminal session command was blocked before execution.",
    "",
    "The command looks destructive. Run it from the CLI, or set `CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE=1` only for a trusted local test.",
    "",
    "```text",
    command,
    "```"
  ].join("\n");
}

function mapTerminalKey(name: string): TerminalSessionCommand {
  const normalized = name.toLowerCase();
  const keys: Record<string, { data: string; label: string }> = {
    enter: { data: process.platform === "win32" ? "\r" : "\n", label: "Enter" },
    tab: { data: "\t", label: "Tab" },
    escape: { data: "\x1b", label: "Escape" },
    esc: { data: "\x1b", label: "Escape" },
    "ctrl-c": { data: "\x03", label: "Ctrl+C" },
    "ctrl-d": { data: "\x04", label: "Ctrl+D" },
    backspace: { data: "\x7f", label: "Backspace" }
  };
  const key = keys[normalized] ?? keys.enter;
  return { type: "write", ...key };
}

function decodeTerminalInput(data: string): string {
  const literalSlash = "\0CODEX_WIDGET_LITERAL_SLASH\0";
  return data
    .replace(/\\\\/g, literalSlash)
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\e/g, "\x1b")
    .replace(/\\x03/g, "\x03")
    .replace(/\\x04/g, "\x04")
    .replaceAll(literalSlash, "\\");
}

function clampTerminalDimension(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function isDangerousTerminalSessionCommand(command: string): boolean {
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
