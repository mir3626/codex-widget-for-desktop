import type { StorageService } from "../../storage/storage.js";

export function resolveClientSessionId(storage: StorageService, sessionId: string | undefined): string {
  if (sessionId) {
    const snapshot = storage.ensureSessionSnapshot();
    if (snapshot.sessions.some((session) => session.id === sessionId)) {
      return sessionId;
    }
  }
  return storage.ensureSessionSnapshot().activeSessionId;
}

export function resolveStreamSessionId(storage: StorageService, stream: { sessionId?: string }): string {
  return stream.sessionId ?? storage.ensureSessionSnapshot().activeSessionId;
}
