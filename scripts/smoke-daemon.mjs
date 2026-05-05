import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const daemon = await startDaemon({ port: 0 });
const events = [];
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
let branchRequested = false;
let sessionResetDuringBranch = false;

function waitForCompletion() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for daemon stream.")), 8000);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (branchRequested && event.type === "session.reset") {
        sessionResetDuringBranch = true;
      }
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
        if (event.id === "smoke-1") {
          branchRequested = true;
          socket.send(JSON.stringify({ type: "session.branch" }));
          socket.send(
            JSON.stringify({
              type: "ask",
              id: "smoke-2",
              text: "branch follow-up",
              mode: "agent",
              branchContext: [
                { role: "user", text: "smoke test" },
                { role: "assistant", text: event.text }
              ]
            })
          );
          return;
        }

        if (event.id === "smoke-2") {
          clearTimeout(timeout);
          resolve(event);
        }
      }
    });
    socket.on("error", reject);
  });
}

try {
  await waitForCompletion();
  const deltaCount = events.filter((event) => event.type === "message.delta").length;
  const providerStatus = events.find((event) => event.type === "provider.status");
  const runtimeStatus = events.find((event) => event.type === "runtime.status");
  if (deltaCount === 0) {
    throw new Error("No streamed delta events were emitted.");
  }
  if (sessionResetDuringBranch) {
    throw new Error("session.branch should not broadcast a visible session.reset event.");
  }
  if (!providerStatus || providerStatus.providers?.length !== 4) {
    throw new Error("Provider status event was not emitted.");
  }
  if (!runtimeStatus || typeof runtimeStatus.status?.uptimeSeconds !== "number") {
    throw new Error("Runtime status event was not emitted.");
  }
  console.log(`daemon smoke ok: ${deltaCount} deltas on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
}
