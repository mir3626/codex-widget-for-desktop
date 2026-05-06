import { TERMINAL_LINE_LIMIT, TERMINAL_LINE_MAX_CHARS } from "../config";
import type { TerminalKeyName, TerminalLine } from "../types";

export function isTerminalToolEvent(tool: string): boolean {
  return tool === "terminal" || tool.startsWith("terminal:") || tool.startsWith("terminal-session:");
}

export function terminalToolLabel(tool: string): string {
  return tool.startsWith("terminal-session:") ? "pty" : "terminal";
}

export function terminalLinePrefix(kind: TerminalLine["kind"]): string {
  if (kind === "command") {
    return ">";
  }
  if (kind === "error") {
    return "!";
  }
  if (kind === "system") {
    return "*";
  }
  return "|";
}

export function terminalKeyToInput(name: TerminalKeyName): string {
  const inputs = {
    enter: "\r",
    tab: "\t",
    escape: "\x1b",
    "ctrl-c": "\x03"
  } satisfies Record<TerminalKeyName, string>;
  return inputs[name];
}

export function terminalKeyToLabel(name: TerminalKeyName): string {
  const labels = {
    enter: "Enter",
    tab: "Tab",
    escape: "Escape",
    "ctrl-c": "Ctrl+C"
  } satisfies Record<TerminalKeyName, string>;
  return labels[name];
}

export function formatTerminalMouseSequence(buttonCode: number, col: number, row: number, final: "M" | "m"): string {
  return `\x1b[<${buttonCode};${col};${row}${final}`;
}

export function readTerminalMouseCell(element: HTMLElement, clientX: number, clientY: number): { col: number; row: number } {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const paddingLeft = normalizeCssPixel(style.paddingLeft);
  const paddingTop = normalizeCssPixel(style.paddingTop);
  const paddingRight = normalizeCssPixel(style.paddingRight);
  const paddingBottom = normalizeCssPixel(style.paddingBottom);
  const fontSize = normalizeCssPixel(style.fontSize, 11.5);
  const lineHeight = normalizeCssPixel(style.lineHeight, fontSize * 1.46);
  const charWidth = Math.max(5, fontSize * 0.62);
  const contentWidth = Math.max(charWidth, rect.width - paddingLeft - paddingRight);
  const contentHeight = Math.max(lineHeight, rect.height - paddingTop - paddingBottom);
  const x = Math.min(contentWidth - 1, Math.max(0, clientX - rect.left - paddingLeft));
  const y = Math.min(contentHeight - 1, Math.max(0, clientY - rect.top - paddingTop));
  return {
    col: Math.min(400, Math.max(1, Math.floor(x / charWidth) + 1)),
    row: Math.min(200, Math.max(1, Math.floor(y / lineHeight) + 1))
  };
}

export function normalizeCssPixel(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeTerminalText(text: string): string {
  return text
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export function clampTerminalLine(text: string): string {
  return text.length > TERMINAL_LINE_MAX_CHARS ? `${text.slice(0, TERMINAL_LINE_MAX_CHARS)}...` : text;
}

export function limitTerminalLines(lines: TerminalLine[]): TerminalLine[] {
  return lines.length > TERMINAL_LINE_LIMIT ? lines.slice(-TERMINAL_LINE_LIMIT) : lines;
}

export function summarizeTerminalCompletion(markdown: string, sawOutput: boolean): string {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~#>|]/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (sawOutput) {
    const statusLine = cleaned.find((line) => /\b(completed|exited with|blocked|stopped|timed out)\b/i.test(line));
    return statusLine ? clampTerminalLine(statusLine) : "completed";
  }

  const summaryLine =
    cleaned.find((line) => /\b(Terminal|PTY|session|started|running|stopped|resized|input sent|blocked|No output)\b/i.test(line)) ??
    cleaned[0] ??
    "";
  return clampTerminalLine(summaryLine);
}
