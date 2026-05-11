import type { CapabilityTimingEvent, CapabilityTransactionPhase } from "./types.js";

export type CapabilityTimingRecorder = {
  startedAt: number;
  mark(name: string, phase?: CapabilityTransactionPhase, detail?: Record<string, unknown>): CapabilityTimingEvent;
};

export function createCapabilityTimingRecorder(startedAt = Date.now()): CapabilityTimingRecorder {
  return {
    startedAt,
    mark(name, phase, detail) {
      return {
        name,
        at: new Date().toISOString(),
        elapsedMs: Math.max(0, Date.now() - startedAt),
        phase,
        detail
      };
    }
  };
}

export function summarizeCapabilityTimings(events: CapabilityTimingEvent[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const event of events) {
    summary[event.name] = event.elapsedMs;
  }
  return summary;
}

