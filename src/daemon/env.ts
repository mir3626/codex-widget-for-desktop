import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnv(cwd = process.cwd()): void {
  for (const filename of [".env", ".env.local"]) {
    const path = resolve(cwd, filename);
    if (existsSync(path)) {
      loadEnvFile(path);
    }
  }
}

export function upsertLocalEnv(updates: Record<string, string>, cwd = process.cwd()): void {
  const path = resolve(cwd, ".env");
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));
  const nextLines = lines.map((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed || !pending.has(parsed.key)) {
      return line;
    }

    const value = pending.get(parsed.key) ?? "";
    pending.delete(parsed.key);
    return `${parsed.key}=${formatEnvValue(value)}`;
  });

  for (const [key, value] of pending) {
    nextLines.push(`${key}=${formatEnvValue(value)}`);
  }

  writeFileSync(path, `${nextLines.filter((line, index) => index < nextLines.length - 1 || line).join("\n")}\n`, "utf8");
}

function loadEnvFile(path: string): void {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed || process.env[parsed.key] !== undefined) {
      continue;
    }
    process.env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const separator = trimmed.indexOf("=");
  if (separator <= 0) {
    return undefined;
  }

  const key = trimmed.slice(0, separator).trim();
  const rawValue = trimmed.slice(separator + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return undefined;
  }

  return {
    key,
    value: unquote(rawValue)
  };
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function formatEnvValue(value: string): string {
  if (!value || /[\s#"'=]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}
