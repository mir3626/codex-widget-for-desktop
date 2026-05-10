import { randomUUID } from "node:crypto";
import { createTimelineEvent } from "../actionTimeline.js";
import { summarizeBrowserObservation } from "../browserObservation.js";
import type {
  BrowserActionMode,
  BrowserActionSession,
  BrowserActionSource
} from "../types.js";

export function createBrowserActionSession(input: {
  id?: string;
  sessionId?: string;
  mode?: BrowserActionMode;
  source?: Partial<BrowserActionSource>;
} = {}): BrowserActionSession {
  const id = input.id?.trim() || `browser-action-${randomUUID()}`;
  const session: BrowserActionSession = {
    id,
    sessionId: input.sessionId,
    startedAt: new Date().toISOString(),
    source: {
      kind: input.source?.kind ?? "active_tab",
      browser: input.source?.browser ?? "unknown",
      tabId: input.source?.tabId,
      url: input.source?.url,
      title: input.source?.title,
      windowId: input.source?.windowId
    },
    mode: input.mode ?? "auto_safe_actions",
    status: "active",
    timeline: [],
    approvals: []
  };
  session.timeline.push(createTimelineEvent({
    startedAt: session.startedAt,
    type: "start",
    summary: "Browser Action session started",
    detail: { mode: session.mode }
  }));
  return session;
}

export function summarizeBrowserActionSessionData(session: BrowserActionSession): Record<string, unknown> {
  return {
    id: session.id,
    sessionId: session.sessionId,
    mode: session.mode,
    status: session.status,
    source: session.source,
    events: session.timeline.length,
    approvals: session.approvals.length,
    latestObservation: session.latestObservation ? summarizeBrowserObservation(session.latestObservation) : undefined
  };
}
