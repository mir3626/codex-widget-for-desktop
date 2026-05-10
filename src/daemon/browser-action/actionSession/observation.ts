import { auditObservation } from "../auditLog.js";
import { BrowserActionAdapterRegistry, observeWithAdapter } from "../adapterRegistry.js";
import { createTimelineEvent } from "../actionTimeline.js";
import { buildBrowserObservation, summarizeBrowserObservation } from "../browserObservation.js";
import type {
  BrowserActionAuditEntry,
  BrowserActionSession,
  BrowserObservation
} from "../types.js";
import { cloneSession } from "./cloning.js";

export function observeBrowserActionSession(input: {
  session: BrowserActionSession;
  snapshot: unknown;
  now?: Date;
}): { session: BrowserActionSession; observation: BrowserObservation; audit: BrowserActionAuditEntry } {
  const observation = buildBrowserObservation({
    source: input.session.source,
    snapshot: input.snapshot,
    now: input.now
  });
  input.session.latestObservation = observation;
  input.session.source = { ...input.session.source, url: observation.url, title: observation.title };
  input.session.timeline.push(createTimelineEvent({
    startedAt: input.session.startedAt,
    type: "observe",
    summary: "Browser observation captured",
    detail: summarizeBrowserObservation(observation)
  }));
  return {
    session: cloneSession(input.session),
    observation,
    audit: auditObservation(input.session, observation)
  };
}

export async function observeBrowserActionSessionViaAdapter(input: {
  session: BrowserActionSession;
  adapters: BrowserActionAdapterRegistry;
  adapterId: string;
  providerState?: unknown;
}): Promise<{ session: BrowserActionSession; observation: BrowserObservation; audit: BrowserActionAuditEntry }> {
  const adapter = input.adapters.get(input.adapterId);
  if (!adapter) {
    throw new Error(`Browser Action adapter not found: ${input.adapterId}`);
  }
  const available = await adapter.isAvailable({ session: input.session });
  if (!available) {
    throw new Error(`${adapter.label} is unavailable for this Browser Action session.`);
  }
  const observation = await observeWithAdapter({
    adapter,
    observeInput: {
      session: input.session,
      providerState: input.providerState ?? {
        url: input.session.source.url,
        title: input.session.source.title
      }
    }
  });
  input.session.latestObservation = observation;
  input.session.source = { ...input.session.source, url: observation.url, title: observation.title };
  input.session.timeline.push(createTimelineEvent({
    startedAt: input.session.startedAt,
    type: "observe",
    summary: `Browser observation captured via ${adapter.label}`,
    detail: summarizeBrowserObservation(observation)
  }));
  return {
    session: cloneSession(input.session),
    observation,
    audit: auditObservation(input.session, observation)
  };
}
