import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const daemon = await startDaemon({ port: 0 });
const marker = "screen-smoke-ocr-marker";
const response = await fetch(`http://127.0.0.1:${daemon.port}/providers/screen/snapshot`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    source: "smoke-test-capture",
    title: "Screen Smoke Snapshot",
    description: "Synthetic screen snapshot for provider smoke coverage.",
    ocrText: `Visible OCR text includes ${marker}`
  })
});

if (!response.ok) {
  throw new Error(`Screen snapshot POST failed (${response.status}).`);
}

const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for screen provider.")), 12000);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (event.type === "connected") {
        socket.send(
          JSON.stringify({
            type: "ask",
            id: "screen-smoke-1",
            text: "Summarize the attached screen snapshot.",
            mode: "screen"
          })
        );
      }
      if (event.type === "message.completed") {
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.on("error", reject);
  });

  const providerStatus = events.find((event) => event.type === "provider.status");
  const screenStatus = providerStatus?.providers?.find((provider) => provider.mode === "screen");
  if (screenStatus?.state !== "ready") {
    throw new Error(`Screen provider was not ready: ${JSON.stringify(screenStatus)}`);
  }

  const toolOutput = events
    .filter((event) => event.type === "tool.output")
    .map((event) => event.chunk ?? "")
    .join("\n");
  if (!toolOutput.includes(marker)) {
    throw new Error(`Screen tool output did not include marker: ${toolOutput}`);
  }
  console.log(`screen provider smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
}
