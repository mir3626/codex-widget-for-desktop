import type { ChildProcess } from "node:child_process";
import WebSocket from "ws";
import { terminateProcessTreeAndWait } from "../codexRuntime.js";

export async function closeAppServerTransport(input: {
  ws: WebSocket | undefined;
  child: ChildProcess | undefined;
}): Promise<void> {
  if (input.ws && input.ws.readyState === WebSocket.OPEN) {
    await new Promise<void>((resolve) => {
      input.ws?.once("close", () => resolve());
      input.ws?.close();
      setTimeout(resolve, 500);
    });
  }

  if (input.child && input.child.exitCode === null && !input.child.killed) {
    await terminateProcessTreeAndWait(input.child.pid);
  }
}
