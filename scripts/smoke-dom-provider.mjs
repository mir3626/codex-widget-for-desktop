import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const daemon = await startDaemon({ port: 0 });
const marker = "dom-smoke-selection";
const response = await fetch(`http://127.0.0.1:${daemon.port}/providers/dom/snapshot`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: "https://example.test/page",
    title: "DOM Smoke Page",
    selection: marker,
    text: `Visible page text with ${marker}`
  })
});

if (!response.ok) {
  throw new Error(`DOM snapshot POST failed (${response.status}).`);
}

const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for DOM provider.")), 12000);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (event.type === "connected") {
        socket.send(
          JSON.stringify({
            type: "ask",
            id: "dom-smoke-1",
            text: "Summarize the attached selection.",
            mode: "browser"
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
  const browserStatus = providerStatus?.providers?.find((provider) => provider.mode === "browser");
  if (browserStatus?.state !== "ready") {
    throw new Error(`Browser provider was not ready: ${JSON.stringify(browserStatus)}`);
  }

  const toolOutput = events
    .filter((event) => event.type === "tool.output")
    .map((event) => event.chunk ?? "")
    .join("\n");
  if (!toolOutput.includes(marker)) {
    throw new Error(`DOM tool output did not include marker: ${toolOutput}`);
  }
  console.log(`dom provider smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
}
