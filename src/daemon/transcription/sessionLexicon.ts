import type { UserLexiconEntry } from "./types.js";

export function buildSessionLexicon(input: {
  terms?: string[];
  profileId?: string;
  existing?: UserLexiconEntry[];
}): UserLexiconEntry[] {
  const now = new Date().toISOString();
  const profileId = input.profileId ?? "session";
  const sessionEntries = [...new Set((input.terms ?? []).map((term) => term.trim()).filter(Boolean))]
    .slice(0, 80)
    .map((term, index): UserLexiconEntry => ({
      id: `session-${index + 1}`,
      profileId,
      canonical: term,
      aliases: [],
      observedMisrecognitions: [],
      contexts: ["session"],
      count: 1,
      lastUsedAt: now,
      confidenceBoost: 0.2
    }));
  return [...(input.existing ?? []), ...sessionEntries];
}
