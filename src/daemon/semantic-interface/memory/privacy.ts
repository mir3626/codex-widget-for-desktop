import { createHash } from "node:crypto";

const SECRET_PATTERN = /(\bsecret_value\b|bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9]{16,}|(?:password|token|cookie|api[_ -]?key|secret)\s*[:=]\s*["']?[^"',}\s]{4,}|\b(?:\d[ -]?){13,19}\b)/i;

export function redactSemanticMemoryText(value: string | undefined): string {
  return (value ?? "").replace(SECRET_PATTERN, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 500);
}

export function hashSemanticMemoryText(value: string | undefined): string {
  return createHash("sha256").update((value ?? "").normalize("NFKC").trim().toLowerCase()).digest("hex").slice(0, 24);
}

export function containsSemanticMemorySecret(value: unknown): boolean {
  return SECRET_PATTERN.test(JSON.stringify(value).toLowerCase());
}
