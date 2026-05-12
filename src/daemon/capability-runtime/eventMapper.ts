import type { ServerEvent } from "../../shared/protocol.js";
import type { CapabilityRuntimeEvent } from "./types.js";

export function mapCapabilityRuntimeEvent(event: CapabilityRuntimeEvent): ServerEvent {
  if (event.type === "resource") {
    return {
      type: "capability.resource",
      jobId: event.job.id,
      transactionId: event.job.transactionId,
      resourceId: event.resourceId,
      role: event.role,
      mime: event.mime,
      preview: event.preview
    };
  }

  return {
    type: "capability.job",
    jobId: event.job.id,
    transactionId: event.job.transactionId,
    kind: event.job.kind,
    status: event.job.status,
    phase: event.phase,
    summary: event.summary,
    detail: event.detail
  };
}
