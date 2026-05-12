import type {
  CapabilityJobStatus,
  CapabilityJobSummary,
  CapabilityStartInput
} from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";

export class CapabilityDurableQueue {
  constructor(private readonly storage: StorageService) {}

  create(input: CapabilityStartInput & { status?: CapabilityJobStatus }): CapabilityJobSummary {
    return this.storage.createCapabilityJob({
      id: input.id,
      transactionId: input.transactionId,
      sessionId: input.sessionId,
      kind: input.kind,
      status: input.status,
      priority: input.priority,
      requestedBy: input.requestedBy,
      inputJson: input.input,
      inputBlobIds: input.inputBlobIds,
      leaseId: input.leaseId,
      approvalId: input.approvalId,
      timeoutMs: input.timeoutMs,
      maxRetries: input.maxRetries
    });
  }

  list(input: { sessionId?: string; statuses?: CapabilityJobStatus[]; limit?: number } = {}): CapabilityJobSummary[] {
    return this.storage.listCapabilityJobs(input);
  }

  read(id: string): CapabilityJobSummary | null {
    return this.storage.readCapabilityJob(id);
  }
}
