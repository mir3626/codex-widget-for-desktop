import { createSafetyDecision } from "./riskTaxonomy.js";
import type { SafetyDecision } from "./types.js";

export function decideTerminalCommandSafety(command: string): SafetyDecision {
  if (isDestructiveTerminalCommand(command)) {
    return createSafetyDecision({
      subjectKind: "terminal_command",
      actionFamily: "shell_command",
      decision: "block",
      risk: "destructive",
      reason: "The command looks destructive and requires an explicit local override.",
      destructive: true,
      sensitive: false,
      metadata: { commandPreview: command.slice(0, 160) }
    });
  }
  return createSafetyDecision({
    subjectKind: "terminal_command",
    actionFamily: "shell_command",
    decision: "allow",
    risk: "medium",
    reason: "The command does not match the destructive terminal guard.",
    destructive: false,
    sensitive: false,
    metadata: { commandPreview: command.slice(0, 160) }
  });
}

export function isDestructiveTerminalCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return [
    /\brm\s+-rf\b/,
    /\bremove-item\b[\s\S]*(?:^|\s)-recurse\b/,
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
