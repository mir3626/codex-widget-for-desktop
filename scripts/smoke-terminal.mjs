import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const daemon = await startDaemon({ port: 0 });
const events = [];
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for terminal provider.")), 12000);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (event.type === "connected") {
        socket.send(
          JSON.stringify({
            type: "ask",
            id: "terminal-smoke-1",
            text:
              process.platform === "win32"
                ? "/run Write-Output terminal-smoke-ok"
                : "/run printf terminal-smoke-ok",
            mode: "terminal"
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

  const output = events
    .filter((event) => event.type === "tool.output" || event.type === "message.completed")
    .map((event) => event.chunk ?? event.text ?? "")
    .join("\n");
  if (!output.includes("terminal-smoke-ok")) {
    throw new Error(`Terminal smoke output was missing marker: ${output}`);
  }
  if (!events.some((event) => event.type === "tool.started" && String(event.tool).startsWith("terminal:"))) {
    throw new Error("Terminal provider did not emit tool.started.");
  }
  console.log(`terminal provider smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
}
