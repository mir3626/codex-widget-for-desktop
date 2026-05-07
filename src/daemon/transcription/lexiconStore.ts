import { createHash, randomUUID } from "node:crypto";
import type { UserLexiconEntry } from "./types.js";

export function createProfileId(userId: string, localInstallSalt: string): string {
  return createHash("sha256").update(`${userId}:${localInstallSalt}`).digest("hex");
}

export class MemoryLexiconStore {
  private entries = new Map<string, UserLexiconEntry>();

  upsert(input: Omit<UserLexiconEntry, "id" | "count" | "lastUsedAt"> & { id?: string }): UserLexiconEntry {
    const existing = input.id ? this.entries.get(input.id) : undefined;
    const entry: UserLexiconEntry = {
      ...input,
      id: existing?.id ?? input.id ?? `lex-${randomUUID()}`,
      count: (existing?.count ?? 0) + 1,
      lastUsedAt: new Date().toISOString()
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  list(profileId?: string): UserLexiconEntry[] {
    return [...this.entries.values()].filter((entry) => !profileId || entry.profileId === profileId);
  }
}
