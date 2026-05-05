import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const daemon = await startDaemon({ port: 0 });
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
let success = false;

try {
  await waitForConnection(socket, events);
  await askTerminal(socket, events, "terminal-session-start", "/pty start");
  await askTerminal(socket, events, "terminal-session-resize", "/pty resize 100x30");
  await askTerminal(socket, events, "terminal-session-one", process.platform === "win32" ? "/pty echo pty-session-one" : "/pty printf pty-session-one");
  await askTerminal(socket, events, "terminal-session-two", process.platform === "win32" ? "/pty echo pty-session-two" : "/pty printf pty-session-two");
  await askTerminal(socket, events, "terminal-session-stop", "/pty stop");

  const output = events
    .filter((event) => event.type === "tool.output" || event.type === "message.completed")
    .map((event) => event.chunk ?? event.text ?? "")
    .join("\n");
  if (!output.includes("pty-session-one") || !output.includes("pty-session-two")) {
    throw new Error(`Terminal session output was missing markers: ${output}`);
  }
  if (!events.some((event) => event.type === "tool.started" && String(event.tool).startsWith("terminal-session:"))) {
    throw new Error("Terminal session provider did not emit tool.started.");
  }
  if (process.env.CODEX_WIDGET_TERMINAL_BACKEND !== "pipe" && !output.includes("node-pty")) {
    throw new Error(`Terminal session did not report the node-pty backend: ${output}`);
  }

  console.log(`terminal session smoke ok on port ${daemon.port}`);
  success = true;
} finally {
  socket.close();
  await daemon.close();
}

if (success) {
  process.exit(0);
}

function waitForConnection(socket, events) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for daemon connection.")), 12000);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (event.type === "connected") {
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.on("error", reject);
  });
}

function askTerminal(socket, events, id, text) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${id}.`)), 12000);
    const onMessage = (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (event.type === "message.completed" && event.id === id) {
        socket.off("message", onMessage);
        clearTimeout(timeout);
        resolve();
      }
      if (event.type === "error" && event.id === id) {
        socket.off("message", onMessage);
        clearTimeout(timeout);
        reject(new Error(event.message));
      }
    };

    socket.on("message", onMessage);
    socket.send(JSON.stringify({ type: "ask", id, text, mode: "terminal" }));
  });
}
