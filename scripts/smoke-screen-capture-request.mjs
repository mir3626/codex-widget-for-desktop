import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

if (process.platform !== "win32") {
  console.log("screen capture request smoke skipped: Windows-only helper");
  process.exit(0);
}

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const daemon = await startDaemon({ port: 0 });
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for screen capture request.")), 30000);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (event.type === "connected") {
        socket.send(
          JSON.stringify({
            type: "provider.captureScreen",
            description: "screen capture request smoke"
          })
        );
      }
      if (event.type === "provider.capture" && event.state === "completed") {
        clearTimeout(timeout);
        resolve();
      }
      if (event.type === "provider.capture" && event.state === "error") {
        clearTimeout(timeout);
        reject(new Error(event.message));
      }
    });
    socket.on("error", reject);
  });

  const statusEvents = events.filter((event) => event.type === "provider.status");
  const screenReady = statusEvents.some((event) =>
    event.providers?.some((provider) => provider.mode === "screen" && provider.state === "ready")
  );
  if (!screenReady) {
    throw new Error(`Screen provider did not become ready: ${JSON.stringify(statusEvents.at(-1))}`);
  }

  const response = await fetch(`http://127.0.0.1:${daemon.port}/providers/screen/snapshot`);
  const payload = await response.json();
  if (payload.snapshot?.description !== "screen capture request smoke" || payload.snapshot?.imageDataUrlLength <= 0) {
    throw new Error(`Unexpected captured screen snapshot: ${JSON.stringify(payload)}`);
  }

  console.log(`screen capture request smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
}
