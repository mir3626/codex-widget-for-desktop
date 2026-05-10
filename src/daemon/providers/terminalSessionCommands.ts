export type TerminalSessionCommand =
  | { type: "start" }
  | { type: "stop" }
  | { type: "status" }
  | { type: "write"; data: string; label: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "run"; command: string };

const DEFAULT_MAX_OUTPUT_CHARS = 32_000;

export function extractTerminalSessionCommand(text: string): TerminalSessionCommand | null {
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

export function renderSessionResponse(command: string, cwd: string, exitCode: number | null, output: string): string {
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

export function wrapSessionCommand(command: string, sentinel: string): string {
  if (process.platform === "win32") {
    return `${command}\r\necho ${sentinel}:%ERRORLEVEL%\r\n`;
  }

  return `${command}\nprintf '\\n${sentinel}:%s\\n' "$?"\n`;
}

export function renderBlockedCommand(command: string): string {
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

export function isDangerousTerminalSessionCommand(command: string): boolean {
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

export function normalizePositiveNumber(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : fallback;
}

function terminalSessionShellLabel(): string {
  return process.platform === "win32" ? "cmd" : "bash";
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
