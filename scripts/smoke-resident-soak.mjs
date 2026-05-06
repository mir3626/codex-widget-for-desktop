import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-resident-soak");
const SOAK_MS = Number(process.env.CODEX_WIDGET_SMOKE_SOAK_MS ?? 18_000);
const MAX_RSS_MB = Number(process.env.CODEX_WIDGET_SMOKE_MAX_RSS_MB ?? 256);
const MAX_RSS_GROWTH_MB = Number(process.env.CODEX_WIDGET_SMOKE_MAX_RSS_GROWTH_MB ?? 32);

const daemon = await startDaemon({ port: 0 });
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const runtimeEvents = [];
let pongCount = 0;

try {
  await waitForConnected(socket);
  const rssStartMb = readRssMb();
  const pingTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ping" }));
    }
  }, 1000);

  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.type === "runtime.status") {
      runtimeEvents.push(event.status);
    }
    if (event.type === "pong") {
      pongCount += 1;
    }
  });

  await delay(SOAK_MS);
  clearInterval(pingTimer);

  const lastStatus = runtimeEvents.at(-1);
  if (!lastStatus) {
    throw new Error("No runtime status was emitted during resident soak.");
  }
  if (runtimeEvents.length < 3) {
    throw new Error(`Expected at least 3 runtime samples, saw ${runtimeEvents.length}.`);
  }
  if (lastStatus.clients !== 1) {
    throw new Error(`Expected one resident client, saw ${lastStatus.clients}.`);
  }
  if (lastStatus.activeRequests !== 0) {
    throw new Error(`Expected no active requests during resident soak, saw ${lastStatus.activeRequests}.`);
  }
  if (lastStatus.codexAppServer.state !== "closed") {
    throw new Error(`Mock resident soak should not start app-server, saw ${lastStatus.codexAppServer.state}.`);
  }
  if (pongCount < 3) {
    throw new Error(`Expected ping/pong health responses during soak, saw ${pongCount}.`);
  }

  const rssEndMb = readRssMb();
  if (rssEndMb > MAX_RSS_MB) {
    throw new Error(`Resident soak RSS ${rssEndMb.toFixed(1)}MB exceeded ${MAX_RSS_MB}MB.`);
  }
  if (rssEndMb - rssStartMb > MAX_RSS_GROWTH_MB) {
    throw new Error(
      `Resident soak RSS grew ${Math.max(0, rssEndMb - rssStartMb).toFixed(1)}MB, over ${MAX_RSS_GROWTH_MB}MB.`
    );
  }

  console.log(
    `resident soak ok: samples=${runtimeEvents.length} pongs=${pongCount} rss=${rssEndMb.toFixed(1)}MB port=${daemon.port}`
  );
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

function waitForConnected(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for resident soak connection.")), 12000);
    const onMessage = (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "runtime.status") {
        runtimeEvents.push(event.status);
      }
      if (event.type === "connected") {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve();
      }
    };
    socket.on("message", onMessage);
    socket.on("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRssMb() {
  return process.memoryUsage().rss / 1024 / 1024;
}
