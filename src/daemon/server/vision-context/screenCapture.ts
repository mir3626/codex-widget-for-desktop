import type { WebSocket } from "ws";
import type { ScreenCrop } from "../../../shared/protocol.js";
import type { CapabilityRuntime } from "../../capability-runtime/index.js";
import { broadcast } from "../events.js";

export async function captureScreenFromHelper(
  description: string | undefined,
  crop: ScreenCrop | undefined,
  clients: Set<WebSocket>,
  daemonPort: number,
  capabilityRuntime: CapabilityRuntime
): Promise<void> {
  broadcast(clients, {
    type: "provider.capture",
    mode: "screen",
    state: "started",
    message: "screen capture started"
  });

  try {
    const job = await capabilityRuntime.enqueue({
      kind: "screen_observe",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { description, crop, daemonPort },
      timeoutMs: 60_000
    });
    const completed = await waitForCapabilityJob(capabilityRuntime, job.id, 65_000);
    const output = readOutputText(completed.outputJson);
    broadcast(clients, {
      type: "provider.capture",
      mode: "screen",
      state: "completed",
      message: output || "screen capture completed"
    });
  } catch (error) {
    broadcast(clients, {
      type: "provider.capture",
      mode: "screen",
      state: "error",
      message: error instanceof Error ? error.message : "Screen capture failed."
    });
  }
}

async function waitForCapabilityJob(capabilityRuntime: CapabilityRuntime, jobId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = capabilityRuntime.read(jobId);
    if (job?.status === "completed") {
      return job;
    }
    if (job?.status === "failed" || job?.status === "cancelled" || job?.status === "expired") {
      throw new Error(job.lastError ?? `Screen capture ${job.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await capabilityRuntime.cancel(jobId, "provider_capture_timeout");
  throw new Error("Screen capture capability timed out.");
}

function readOutputText(output: unknown): string | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  return typeof record.output === "string" ? record.output : undefined;
}
