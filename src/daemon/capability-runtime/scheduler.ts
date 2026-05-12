import type {
  CapabilityJobKind,
  CapabilityJobSummary
} from "../../shared/protocol.js";

const DEFAULT_GLOBAL_LIMIT = 4;
const DEFAULT_PER_KIND_LIMITS: Partial<Record<CapabilityJobKind, number>> = {
  screen_observe: 1,
  ocr: 1,
  desktop_action: 1,
  browser_action: 1,
  browser_chrome: 1,
  terminal: 1
};

export class CapabilityScheduler {
  private active = new Map<string, CapabilityJobSummary>();

  constructor(
    private readonly globalLimit = DEFAULT_GLOBAL_LIMIT,
    private readonly perKindLimits: Partial<Record<CapabilityJobKind, number>> = DEFAULT_PER_KIND_LIMITS
  ) {}

  canStart(job: CapabilityJobSummary): boolean {
    if (this.active.size >= this.globalLimit) {
      return false;
    }
    if (job.leaseId && [...this.active.values()].some((item) => item.leaseId === job.leaseId)) {
      return false;
    }
    const activeForKind = [...this.active.values()].filter((item) => item.kind === job.kind).length;
    const kindLimit = this.perKindLimits[job.kind] ?? this.globalLimit;
    return activeForKind < kindLimit;
  }

  start(job: CapabilityJobSummary): boolean {
    if (!this.canStart(job)) {
      return false;
    }
    this.active.set(job.id, job);
    return true;
  }

  finish(jobId: string): void {
    this.active.delete(jobId);
  }

  activeCount(): number {
    return this.active.size;
  }
}
