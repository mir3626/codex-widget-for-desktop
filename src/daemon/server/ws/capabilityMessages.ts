import type { CapabilityStartInput, ClientMessage } from "../../../shared/protocol.js";
import { send } from "../events.js";
import { mapCapabilityRuntimeEvent } from "../../capability-runtime/index.js";
import type { MessageRouterContext } from "./context.js";

export async function handleCapabilityMessage(message: ClientMessage, context: MessageRouterContext): Promise<boolean> {
  if (message.type === "capability.start") {
    try {
      const job = await context.capabilityRuntime.enqueue(sanitizeClientCapabilityStartInput(message.job));
      send(context.socket, mapCapabilityRuntimeEvent({
        type: "job",
        job,
        phase: job.status === "awaiting_approval" ? "awaiting_approval" : "queued",
        summary: `Capability job accepted: ${job.kind}`
      }));
    } catch (error) {
      send(context.socket, { type: "error", id: message.requestId, message: error instanceof Error ? error.message : "Capability job start failed." });
    }
    return true;
  }

  if (message.type === "capability.cancel") {
    try {
      const job = await context.capabilityRuntime.cancel(message.cancel.jobId, message.cancel.reason);
      send(context.socket, mapCapabilityRuntimeEvent({
        type: "job",
        job,
        phase: "cancelled",
        summary: job.lastError ?? "Capability job cancelled."
      }));
    } catch (error) {
      send(context.socket, { type: "error", id: message.requestId, message: error instanceof Error ? error.message : "Capability job cancel failed." });
    }
    return true;
  }

  if (message.type === "capability.approve") {
    try {
      const job = await context.capabilityRuntime.approve(message.jobId);
      send(context.socket, mapCapabilityRuntimeEvent({
        type: "job",
        job,
        phase: job.status === "queued" ? "queued" : job.status === "running" ? "executing" : "awaiting_approval",
        summary: `Capability job approval accepted: ${job.kind}`
      }));
    } catch (error) {
      send(context.socket, { type: "error", id: message.requestId, message: error instanceof Error ? error.message : "Capability job approve failed." });
    }
    return true;
  }

  if (message.type === "capability.list") {
    send(context.socket, {
      type: "capability.jobs",
      jobs: context.capabilityRuntime.list({ sessionId: message.sessionId, limit: 100 })
    });
    return true;
  }

  return false;
}

function sanitizeClientCapabilityStartInput(input: CapabilityStartInput): CapabilityStartInput {
  const raw = input as CapabilityStartInput & Record<string, unknown>;
  return {
    id: raw.id,
    transactionId: raw.transactionId,
    sessionId: raw.sessionId,
    kind: raw.kind,
    priority: raw.priority,
    requestedBy: raw.requestedBy,
    input: sanitizeClientCapabilityInput(raw.input),
    inputBlobIds: raw.inputBlobIds,
    leaseId: raw.leaseId,
    approvalId: raw.approvalId,
    timeoutMs: raw.timeoutMs,
    maxRetries: raw.maxRetries
  };
}

function sanitizeClientCapabilityInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === "permissionDecision") {
      continue;
    }
    output[key] = value;
  }
  return output;
}
