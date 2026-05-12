import type { CapabilityResourceSummary } from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";
import type { CapabilityResourceManagerLike } from "./types.js";

const DEFAULT_MAX_INLINE_PREVIEW_CHARS = 4096;

export class CapabilityResourceManager implements CapabilityResourceManagerLike {
  private activeBytesByJob = new Map<string, number>();

  constructor(private readonly storage: StorageService) {}

  storeBuffer(input: Parameters<CapabilityResourceManagerLike["storeBuffer"]>[0]): { resourceId: string; blobId: string; size: number } {
    const blob = this.storage.writeBlob({
      bytes: input.bytes,
      mime: input.mime,
      displayName: input.displayName
    });
    const resource = this.storage.createCapabilityResource({
      jobId: input.job.id,
      transactionId: input.job.transactionId,
      blobId: blob.id,
      role: input.role,
      mime: input.mime,
      size: blob.size,
      retention: input.retention,
      preview: input.preview ?? createPreview(input.bytes, input.mime),
      redaction: input.redaction ?? { mode: "metadata_only" }
    });
    this.activeBytesByJob.set(input.job.id, (this.activeBytesByJob.get(input.job.id) ?? 0) + blob.size);
    return { resourceId: resource.id, blobId: blob.id, size: blob.size };
  }

  list(jobId: string): CapabilityResourceSummary[] {
    return this.storage.listCapabilityResources(jobId);
  }

  releaseJob(jobId: string): { activeBytesReleased: number; cleanup: { resourcesDeleted: number; blobsDeleted: number; bytesDeleted: number } } {
    const activeBytesReleased = this.activeBytesByJob.get(jobId) ?? 0;
    this.activeBytesByJob.delete(jobId);
    return {
      activeBytesReleased,
      cleanup: this.storage.cleanupEphemeralCapabilityResources()
    };
  }

  readAccounting(): { activeJobs: number; activeBytes: number } {
    return {
      activeJobs: this.activeBytesByJob.size,
      activeBytes: [...this.activeBytesByJob.values()].reduce((sum, value) => sum + value, 0)
    };
  }
}

function createPreview(bytes: Buffer, mime: string): unknown {
  if (mime.startsWith("text/") || mime === "application/json") {
    const text = bytes.toString("utf8");
    return {
      kind: "text",
      data: text.slice(0, DEFAULT_MAX_INLINE_PREVIEW_CHARS),
      truncated: text.length > DEFAULT_MAX_INLINE_PREVIEW_CHARS,
      size: bytes.byteLength
    };
  }
  return {
    kind: "binary",
    mime,
    size: bytes.byteLength
  };
}
