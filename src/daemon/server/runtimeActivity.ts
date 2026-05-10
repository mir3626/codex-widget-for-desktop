import type { StorageService } from "../storage/storage.js";

export function recordRuntimeActivity(
  storage: StorageService,
  sessionId: string,
  level: "debug" | "info" | "warn" | "error",
  category: string,
  summary: string,
  detail?: unknown
): void {
  storage.recordActivity({
    id: cryptoRandomId(),
    sessionId,
    level,
    category,
    summary: summary.slice(0, 240),
    detail
  });
}

export function cryptoRandomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
