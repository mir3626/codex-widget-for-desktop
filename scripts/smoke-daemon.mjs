import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const daemon = await startDaemon({ port: 0 });
const events = [];
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);

function waitForCompletion() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for daemon stream.")), 8000);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (event.type === "connected") {
        socket.send(
          JSON.stringify({
            type: "ask",
            id: "smoke-1",
            text: "smoke test",
            mode: "agent"
          })
        );
      }
      if (event.type === "message.completed") {
        clearTimeout(timeout);
        resolve(event);
      }
    });
    socket.on("error", reject);
  });
}

try {
  await waitForCompletion();
  const deltaCount = events.filter((event) => event.type === "message.delta").length;
  if (deltaCount === 0) {
    throw new Error("No streamed delta events were emitted.");
  }
  console.log(`daemon smoke ok: ${deltaCount} deltas on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
}
