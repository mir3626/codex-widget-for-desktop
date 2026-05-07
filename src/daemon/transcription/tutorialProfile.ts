import type { UserLexiconEntry } from "./types.js";

export type TutorialPhraseResult = {
  canonical: string;
  observed: string;
  contexts?: string[];
};

export function buildTutorialLexiconEntries(input: {
  profileId: string;
  results: TutorialPhraseResult[];
}): UserLexiconEntry[] {
  const now = new Date().toISOString();
  return input.results.map((result, index) => ({
    id: `tutorial-${index + 1}`,
    profileId: input.profileId,
    canonical: result.canonical,
    aliases: [],
    observedMisrecognitions: result.observed === result.canonical ? [] : [result.observed],
    contexts: result.contexts ?? ["tutorial"],
    count: 1,
    lastUsedAt: now,
    confidenceBoost: 0.34
  }));
}
