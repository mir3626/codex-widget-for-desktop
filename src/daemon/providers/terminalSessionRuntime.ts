import { resolve } from "node:path";
import type { ToolEmitter } from "../../shared/protocol.js";
import type { AgentRequest } from "../agent.js";
import { resolveCodexExecutionContext } from "../codexRuntime.js";
import { spawnTerminalRuntime, type TerminalRuntime } from "./ptyRuntime.js";
import {
  normalizePositiveNumber,
  wrapSessionCommand
} from "./terminalSessionCommands.js";

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
const DEFAULT_RAW_INPUT_DRAIN_MS = 1_200;
const DEFAULT_RAW_INPUT_QUIET_MS = 160;

export class TerminalSession {
  private child: TerminalRuntime | undefined;
  private cwd = "";
  private pending: PendingCommand | undefined;
  private idleOutput: ((chunk: string) => void) | undefined;
  private idleOutputSubscribers = new Set<(chunk: string) => void>();

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

  subscribeIdleOutput(listener: (chunk: string) => void): () => void {
    this.idleOutputSubscribers.add(listener);
    return () => {
      this.idleOutputSubscribers.delete(listener);
    };
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
      if (this.idleOutput) {
        this.idleOutput(chunk);
        return;
      }
      for (const listener of this.idleOutputSubscribers) {
        listener(chunk);
      }
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
