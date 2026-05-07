import type { Observation, VisionContextAdapter } from "../types.js";

export const terminalAdapter: VisionContextAdapter = {
  id: "terminal",
  label: "Terminal",
  async isAvailable(input) {
    return input.captureSession.source.appName?.toLowerCase().includes("terminal") === true ||
      input.captureSession.source.kind === "app";
  },
  async collect(input) {
    const terminal = readTerminalState(input.providerState?.terminal);
    if (!terminal) {
      return [];
    }
    const observations: Observation[] = [];
    if (terminal.cwd || terminal.title) {
      observations.push({
        id: `terminal-context:${input.captureSession.id}`,
        t: input.timeRange.endMs,
        source: "terminal",
        kind: "command",
        label: terminal.title || "terminal context",
        text: [terminal.cwd ? `cwd: ${terminal.cwd}` : "", terminal.lastCommand ? `last command: ${terminal.lastCommand}` : ""].filter(Boolean).join("\n"),
        metadata: { cwd: terminal.cwd, exitCode: terminal.exitCode },
        confidence: 0.74
      });
    }
    if (terminal.output) {
      observations.push({
        id: `terminal-output:${input.captureSession.id}`,
        t: input.timeRange.endMs,
        source: "terminal",
        kind: terminal.output.match(/error|failed|exception|traceback|오류|에러/i) ? "error" : "text",
        label: "terminal output",
        text: terminal.output,
        metadata: { exitCode: terminal.exitCode },
        confidence: terminal.exitCode && terminal.exitCode !== 0 ? 0.86 : 0.72
      });
    }
    return observations;
  }
};

function readTerminalState(value: unknown): { cwd?: string; title?: string; lastCommand?: string; output?: string; exitCode?: number } | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const state = {
    cwd: readString(record.cwd),
    title: readString(record.title),
    lastCommand: readString(record.lastCommand),
    output: readString(record.output),
    exitCode: typeof record.exitCode === "number" ? record.exitCode : undefined
  };
  return state.cwd || state.title || state.lastCommand || state.output ? state : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
