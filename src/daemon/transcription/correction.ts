import type { CorrectionResult, UserLexiconEntry } from "./types.js";

export function applyLexiconCorrections(text: string, entries: UserLexiconEntry[]): CorrectionResult {
  let corrected = text;
  const replacements: CorrectionResult["replacements"] = [];
  for (const entry of entries) {
    for (const alias of [...entry.aliases, ...entry.observedMisrecognitions]) {
      if (!alias.trim()) {
        continue;
      }
      const pattern = new RegExp(escapeRegExp(alias), "gi");
      if (!pattern.test(corrected)) {
        continue;
      }
      corrected = corrected.replace(pattern, entry.canonical);
      replacements.push({
        from: alias,
        to: entry.canonical,
        confidenceBoost: entry.confidenceBoost
      });
    }
  }
  return { text: corrected, replacements };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
