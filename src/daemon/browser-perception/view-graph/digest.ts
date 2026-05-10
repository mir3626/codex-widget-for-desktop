import { createHash } from "node:crypto";

export function hashViewGraphParts(parts: unknown[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(JSON.stringify(part ?? ""));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 20);
}

export function tokenizeViewText(value: string | undefined): string[] {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .trim();
  if (!normalized) {
    return [];
  }
  return Array.from(new Set(normalized.split(/\s+/).filter((token) => token.length >= 2).slice(0, 32)));
}

export function compactViewText(value: string | undefined, maxLength = 700): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
