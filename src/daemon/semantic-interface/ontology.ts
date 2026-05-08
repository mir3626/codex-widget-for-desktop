import type { SemanticTier1Risk } from "./types.js";

export const SEMANTIC_INTERFACE_VERSION = "0.1.0";
export const SEMANTIC_RANKER_VERSION = "0.1.0";
export const SEMANTIC_PREDICATE_VERSION = "0.1.0";
export const SEMANTIC_CATALOG_VERSION = "0.1.0";
export const SEMANTIC_REDACTION_POLICY_VERSION = "0.1.0";
export const REDACTED_TRACE_SCHEMA_VERSION = 1;

const RISK_ORDER: Record<SemanticTier1Risk, number> = {
  read_only: 0,
  local_navigation: 1,
  external_navigation: 2,
  input_non_submitting: 3,
  state_change: 4,
  submit_or_publish: 5,
  destructive: 6,
  credential_or_payment: 7,
  code_execution: 8,
  data_exfiltration: 9
};

export function compareSemanticRisk(left: SemanticTier1Risk, right: SemanticTier1Risk): number {
  return RISK_ORDER[left] - RISK_ORDER[right];
}

export function isReadOnlySemanticRisk(risk: SemanticTier1Risk): boolean {
  return compareSemanticRisk(risk, "local_navigation") <= 0;
}

export function isHighSemanticRisk(risk: SemanticTier1Risk): boolean {
  return compareSemanticRisk(risk, "submit_or_publish") >= 0;
}

export function normalizeSemanticText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactSemanticText(value: string | undefined): string {
  return normalizeSemanticText(value).replace(/\s+/g, "");
}

export function hashSemanticParts(parts: Array<string | number | boolean | undefined>): string {
  let hash = 2166136261;
  const text = parts.map((part) => String(part ?? "")).join("\u001f");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
