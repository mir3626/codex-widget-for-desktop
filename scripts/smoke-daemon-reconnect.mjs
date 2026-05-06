import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-reconnect-smoke");
const daemon = await startDaemon({ port: 0 });
const requestId = "reconnect-smoke-1";

try {
  const first = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
  let firstDelta = "";

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for first daemon delta.")), 8000);
    first.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "connected") {
        first.send(
          JSON.stringify({
            type: "ask",
            id: requestId,
            text: "reconnect smoke",
            mode: "agent"
          })
        );
      }
      if (event.type === "message.delta" && event.id === requestId) {
        firstDelta += event.text;
        clearTimeout(timeout);
        first.close();
        resolve();
      }
    });
    first.on("error", reject);
  });

  if (!firstDelta) {
    throw new Error("First connection did not receive an initial delta.");
  }

  const second = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
  let replayedSnapshot = "";
  let completedText = "";

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for reconnect replay.")), 10000);
    second.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "message.snapshot" && event.id === requestId) {
        replayedSnapshot = event.text;
      }
      if (event.type === "message.completed" && event.id === requestId) {
        completedText = event.text;
        clearTimeout(timeout);
        second.close();
        resolve();
      }
    });
    second.on("error", reject);
  });

  if (!replayedSnapshot.includes(firstDelta)) {
    throw new Error(`Reconnect snapshot did not replay the active response text: ${JSON.stringify({ firstDelta, replayedSnapshot })}`);
  }
  if (!completedText.includes("daemon")) {
    throw new Error(`Reconnect completion did not reach the second client: ${completedText}`);
  }

  console.log(`daemon reconnect smoke ok on port ${daemon.port}`);
} finally {
  await daemon.close();
  smokeAppData.cleanup();
}
