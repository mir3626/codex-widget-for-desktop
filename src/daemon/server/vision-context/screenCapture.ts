import type { WebSocket } from "ws";
import type { ScreenCrop } from "../../../shared/protocol.js";
import { captureScreenSnapshot } from "../../providers/screenCaptureProvider.js";
import { broadcast } from "../events.js";

export async function captureScreenFromHelper(
  description: string | undefined,
  crop: ScreenCrop | undefined,
  clients: Set<WebSocket>,
  daemonPort: number
): Promise<void> {
  broadcast(clients, {
    type: "provider.capture",
    mode: "screen",
    state: "started",
    message: "screen capture started"
  });

  try {
    const result = await captureScreenSnapshot({ daemonPort, description, crop });
    broadcast(clients, {
      type: "provider.capture",
      mode: "screen",
      state: "completed",
      message: result.output || "screen capture completed"
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
