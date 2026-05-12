import type { CapabilityCancellationToken } from "./types.js";

export class CapabilityCancellationRegistry {
  private controllers = new Map<string, AbortController>();
  private tokens = new Map<string, CapabilityCancellationToken>();

  create(jobId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    return controller;
  }

  readSignal(jobId: string): AbortSignal | undefined {
    return this.controllers.get(jobId)?.signal;
  }

  cancel(jobId: string, reason = "cancelled", sourceEventId?: string): CapabilityCancellationToken {
    const token: CapabilityCancellationToken = {
      jobId,
      reason,
      requestedAt: new Date().toISOString(),
      sourceEventId
    };
    this.tokens.set(jobId, token);
    const controller = this.controllers.get(jobId);
    if (controller && !controller.signal.aborted) {
      controller.abort(reason);
    }
    return token;
  }

  cancelAll(reason = "cancelled"): void {
    for (const jobId of this.controllers.keys()) {
      this.cancel(jobId, reason);
    }
  }

  complete(jobId: string): void {
    this.controllers.delete(jobId);
    this.tokens.delete(jobId);
  }

  get(jobId: string): CapabilityCancellationToken | undefined {
    return this.tokens.get(jobId);
  }
}
