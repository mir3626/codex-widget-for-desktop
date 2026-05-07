import { randomUUID } from "node:crypto";
import { buildTaskCapsule } from "./capsuleBuilder.js";
import { readTimelineRange, renderUserUtterance, sortTimeline } from "./eventTimeline.js";
import { enforceRetentionAfterCapsule } from "./retention.js";
import type {
  BuildTaskCapsuleInput,
  CaptureEvent,
  CaptureSource,
  Observation,
  TaskCapsule,
  VisionCaptureSession,
  VisionContextStartInput,
  VisionRetentionPolicy
} from "./types.js";
import { DEFAULT_RETENTION, PRIVACY_RETENTION } from "./types.js";

export class VisionContextSessionManager {
  private sessions = new Map<string, VisionCaptureSession>();

  start(input: VisionContextStartInput = {}): VisionCaptureSession {
    const id = input.id?.trim() || `vision-${randomUUID()}`;
    if (this.sessions.has(id)) {
      throw new Error(`Vision Context session already exists: ${id}`);
    }
    const session: VisionCaptureSession = {
      id,
      sessionId: input.sessionId,
      startedAt: new Date().toISOString(),
      source: normalizeCaptureSource(input.source),
      retention: normalizeRetention(input.retention),
      timeline: [],
      rawMedia: input.rawMedia
    };
    this.sessions.set(id, session);
    return cloneSession(session);
  }

  addEvent(captureId: string, event: CaptureEvent): VisionCaptureSession {
    const session = this.requireSession(captureId);
    session.timeline.push(normalizeEvent(event));
    session.timeline = sortTimeline(session.timeline);
    return cloneSession(session);
  }

  get(captureId: string): VisionCaptureSession | undefined {
    const session = this.sessions.get(captureId);
    return session ? cloneSession(session) : undefined;
  }

  cancel(captureId: string): VisionCaptureSession {
    const session = this.requireSession(captureId);
    this.sessions.delete(captureId);
    return cloneSession({ ...session, stoppedAt: new Date().toISOString() });
  }

  async complete(input: {
    captureId: string;
    observations?: Observation[];
    now?: Date;
  }): Promise<{ session: VisionCaptureSession; capsule: TaskCapsule; deletedRawMedia: string[] }> {
    const session = this.requireSession(input.captureId);
    session.stoppedAt = new Date().toISOString();
    const capsuleInput: BuildTaskCapsuleInput = {
      captureSession: cloneSession(session),
      observations: input.observations,
      now: input.now
    };
    let capsule: TaskCapsule | undefined;
    try {
      capsule = buildTaskCapsule(capsuleInput);
      return {
        session: cloneSession(session),
        capsule,
        ...(await enforceRetentionAfterCapsule({ session, capsule }))
      };
    } finally {
      if (!capsule) {
        await enforceRetentionAfterCapsule({ session });
      }
      this.sessions.delete(input.captureId);
    }
  }

  private requireSession(captureId: string): VisionCaptureSession {
    const session = this.sessions.get(requireCaptureId(captureId));
    if (!session) {
      throw new Error(`Vision Context session not found: ${captureId}`);
    }
    return session;
  }
}

export function summarizeCaptureSession(session: VisionCaptureSession): Record<string, unknown> {
  return {
    id: session.id,
    sessionId: session.sessionId,
    source: session.source,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    events: session.timeline.length,
    utterance: renderUserUtterance(session.timeline),
    timeRange: readTimelineRange(session.timeline),
    retention: session.retention
  };
}

function normalizeCaptureSource(source: Partial<CaptureSource> | undefined): CaptureSource {
  return {
    kind: source?.kind ?? "screen",
    appName: source?.appName,
    windowTitle: source?.windowTitle,
    url: source?.url,
    viewport: source?.viewport
  };
}

function normalizeRetention(input: VisionContextStartInput["retention"]): VisionRetentionPolicy {
  if (!input || input === "default") {
    return DEFAULT_RETENTION;
  }
  if (input === "privacy") {
    return PRIVACY_RETENTION;
  }
  return input;
}

function normalizeEvent(event: CaptureEvent): CaptureEvent {
  return {
    ...event,
    id: event.id?.trim() || `event-${randomUUID()}`,
    t: Math.max(0, Math.floor(Number(event.t ?? 0)))
  } as CaptureEvent;
}

function cloneSession(session: VisionCaptureSession): VisionCaptureSession {
  return {
    ...session,
    source: { ...session.source, viewport: session.source.viewport ? { ...session.source.viewport } : undefined },
    retention: { ...session.retention },
    timeline: session.timeline.map((event) => ({ ...event })),
    rawMedia: session.rawMedia
      ? {
          ...session.rawMedia,
          segmentPaths: session.rawMedia.segmentPaths ? [...session.rawMedia.segmentPaths] : undefined
        }
      : undefined
  };
}

function requireCaptureId(captureId: string): string {
  const normalized = captureId.trim();
  if (!normalized) {
    throw new Error("Vision Context capture id is required.");
  }
  return normalized;
}
