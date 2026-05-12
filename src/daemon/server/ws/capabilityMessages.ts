import type { ClientMessage } from "../../../shared/protocol.js";
import { send } from "../events.js";
import { mapCapabilityRuntimeEvent } from "../../capability-runtime/index.js";
import type { MessageRouterContext } from "./context.js";

export async function handleCapabilityMessage(message: ClientMessage, context: MessageRouterContext): Promise<boolean> {
  if (message.type === "capability.start") {
    try {
      const job = await context.capabilityRuntime.enqueue(message.job);
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
