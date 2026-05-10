import type { ExecutionPermissionDecision } from "../../../shared/protocol.js";
import { readRecord } from "./records.js";

export type ExecutionPermissionReader = {
  read: (action: string) => ExecutionPermissionDecision;
};

export type AppServerMessageLike = {
  method?: string;
  params?: unknown;
};

export function readApprovalAction(item: Record<string, unknown> | undefined, fallback: string, externalUrl?: string): string {
  if (externalUrl) {
    return "Open external URL";
  }

  const command = readCommandText(item);
  if (command && isPowerShellCommand(command)) {
    return "PowerShell command";
  }

  return readInteractionAction(item, fallback);
}

export function readInteractionAction(item: Record<string, unknown> | undefined, fallback: string): string {
  if (!item) {
    return fallback;
  }

  for (const key of ["command", "url", "uri", "href", "path", "file", "title", "name", "tool"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return fallback;
}

export function readCommandText(item: Record<string, unknown> | undefined): string {
  const command = item?.command;
  if (typeof command === "string") {
    return command.trim();
  }
  if (Array.isArray(command)) {
    return command.filter((part): part is string => typeof part === "string").join(" ").trim();
  }
  return "";
}

export function isExternalUrlApprovalRequest(message: AppServerMessageLike): boolean {
  const method = message.method?.toLowerCase() ?? "";
  if (!method.includes("approval") && !method.includes("request")) {
    return false;
  }

  const params = readRecord(message.params);
  const item = readRecord(params?.item) ?? params;
  return Boolean(readExternalUrlApprovalTarget(message.method, params, item));
}

export function readExternalUrlApprovalTarget(
  method: string | undefined,
  params: Record<string, unknown> | undefined,
  item: Record<string, unknown> | undefined
): string | undefined {
  const url = readFirstHttpUrl(item) ?? readFirstHttpUrl(params);
  if (!url) {
    return undefined;
  }

  const methodText = method?.toLowerCase() ?? "";
  const typeText = [item?.type, item?.kind, item?.tool, item?.name, item?.title]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/(open|browser|external|url|link)/.test(`${methodText} ${typeText}`)) {
    return url;
  }

  const command = readCommandText(item);
  if (command && isBrowserOpenCommand(command, url)) {
    return url;
  }

  return undefined;
}

export function readSavedApprovalDecision(
  permissions: ExecutionPermissionReader | undefined,
  action: string,
  item: Record<string, unknown> | undefined,
  fallbackTitle: string
): ExecutionPermissionDecision {
  const savedDecision = permissions?.read(action) ?? "ask";
  if (savedDecision === "allow" || savedDecision === "deny") {
    return savedDecision;
  }

  const legacyAction = readInteractionAction(item, fallbackTitle);
  if (legacyAction && legacyAction !== action) {
    const legacyDecision = permissions?.read(legacyAction) ?? "ask";
    if (legacyDecision === "allow" || legacyDecision === "deny") {
      return legacyDecision;
    }
  }

  return "ask";
}

function readFirstHttpUrl(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) {
    return undefined;
  }

  const seen = new Set<unknown>();
  const stack: unknown[] = [record];
  while (stack.length > 0) {
    const value = stack.shift();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);

    if (typeof value === "string") {
      const direct = normalizeHttpUrl(value);
      if (direct) return direct;
      const match = value.match(/https?:\/\/[^\s"'<>]+/i);
      const embedded = match ? normalizeHttpUrl(match[0]) : undefined;
      if (embedded) return embedded;
      continue;
    }

    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }

    const nested = readRecord(value);
    if (nested) {
      stack.push(...Object.values(nested));
    }
  }

  return undefined;
}

function normalizeHttpUrl(value: string): string | undefined {
  const trimmed = value.trim().replace(/[),.;]+$/g, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    return url.toString();
  } catch {
    return undefined;
  }
}

function isBrowserOpenCommand(command: string, url: string): boolean {
  const canonicalUrl = url.replace(/\/$/, "");
  const escapedUrl = escapeRegex(canonicalUrl);
  if (!new RegExp(`${escapedUrl}/?`, "i").test(command)) {
    return false;
  }

  const normalized = command.replace(/\s+/g, " ").trim();
  if (/^(?:start(?:\s+"[^"]*")?|cmd\s+\/c\s+start(?:\s+"[^"]*")?|open|xdg-open|explorer(?:\.exe)?|rundll32\s+url\.dll,FileProtocolHandler)\b/i.test(normalized)) {
    return true;
  }

  return isPowerShellCommand(normalized) && /\b(?:start-process|start)\b/i.test(normalized);
}

function isPowerShellCommand(command: string): boolean {
  const executable = readCommandExecutable(command).replace(/\//g, "\\");
  return /(?:^|\\)(?:powershell|pwsh)(?:\.exe)?$/i.test(executable);
}

function readCommandExecutable(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith('"')) {
    const closingQuote = trimmed.indexOf('"', 1);
    return closingQuote > 1 ? trimmed.slice(1, closingQuote).trim() : trimmed;
  }

  return trimmed.split(/\s+/, 1)[0]?.trim() ?? "";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
