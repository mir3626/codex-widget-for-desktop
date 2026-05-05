import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const MAX_IDLE_RSS_MB = Number(process.env.CODEX_WIDGET_SMOKE_MAX_RSS_MB ?? 256);
const daemon = await startDaemon({ port: 0 });
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const runtimeEvents = [];

function waitForRuntimeEvents(count) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for runtime status.")), 15000);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type !== "runtime.status") {
        return;
      }

      runtimeEvents.push(event.status);
      if (runtimeEvents.length >= count) {
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.on("error", reject);
  });
}

try {
  await waitForRuntimeEvents(2);
  const lastStatus = runtimeEvents.at(-1);
  if (!lastStatus) {
    throw new Error("No runtime status was emitted.");
  }
  if (lastStatus.clients !== 1) {
    throw new Error(`Expected one connected client, saw ${lastStatus.clients}.`);
  }
  if (lastStatus.activeRequests !== 0) {
    throw new Error(`Expected no active requests while idle, saw ${lastStatus.activeRequests}.`);
  }
  if (lastStatus.codexAppServer.state !== "closed") {
    throw new Error(`Mock resident smoke should not start app-server, saw ${lastStatus.codexAppServer.state}.`);
  }
  if (typeof lastStatus.codexAppServer.startCount !== "number") {
    throw new Error(`Codex app-server startCount diagnostic missing: ${JSON.stringify(lastStatus.codexAppServer)}`);
  }
  if ("lastError" in lastStatus.codexAppServer && typeof lastStatus.codexAppServer.lastError !== "string") {
    throw new Error(`Codex app-server lastError diagnostic should be a string when present.`);
  }

  const rssMb = process.memoryUsage().rss / 1024 / 1024;
  if (rssMb > MAX_IDLE_RSS_MB) {
    throw new Error(`Idle daemon smoke RSS ${rssMb.toFixed(1)}MB exceeded ${MAX_IDLE_RSS_MB}MB.`);
  }

  console.log(
    `resident smoke ok: uptime=${lastStatus.uptimeSeconds}s rss=${rssMb.toFixed(1)}MB port=${daemon.port}`
  );
} finally {
  socket.close();
  await daemon.close();
}
