import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { daemonInfo, runAgentStream } from "./agent.js";
import type { ClientMessage, ServerEvent } from "../shared/protocol.js";

export type DaemonHandle = {
  port: number;
  close: () => Promise<void>;
};

export type DaemonOptions = {
  port?: number;
};

export async function startDaemon(options: DaemonOptions = {}): Promise<DaemonHandle> {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const controllers = new Map<string, AbortController>();

  wss.on("connection", (socket) => {
    send(socket, { type: "connected", daemon: daemonInfo(getServerPort(server)) });
    send(socket, { type: "session.state", state: "idle" });

    socket.on("message", (raw) => {
      void handleMessage(raw.toString(), socket, controllers);
    });

    socket.on("close", () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
    });
  });

  const requestedPort = options.port ?? Number(process.env.CODEX_WIDGET_PORT ?? 0);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    port: getServerPort(server),
    close: () =>
      new Promise((resolve, reject) => {
        for (const controller of controllers.values()) {
          controller.abort();
        }
        wss.close((wssError) => {
          if (wssError) {
            reject(wssError);
            return;
          }
          server.close((serverError) => {
            if (serverError) {
              reject(serverError);
              return;
            }
            resolve();
          });
        });
      })
  };
}

async function handleMessage(
  raw: string,
  socket: WebSocket,
  controllers: Map<string, AbortController>
): Promise<void> {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    send(socket, { type: "error", message: "Invalid daemon message." });
    return;
  }

  if (message.type === "ping") {
    send(socket, { type: "pong" });
    return;
  }

  if (message.type === "cancel") {
    controllers.get(message.id)?.abort();
    controllers.delete(message.id);
    send(socket, { type: "session.state", state: "cancelled", id: message.id });
    return;
  }

  if (message.type !== "ask") {
    send(socket, { type: "error", message: "Unsupported daemon message." });
    return;
  }

  const controller = new AbortController();
  controllers.set(message.id, controller);

  try {
    await runAgentStream(message, (event) => send(socket, event), controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      send(socket, { type: "session.state", state: "cancelled", id: message.id });
      return;
    }
    send(socket, {
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : "Unknown daemon error."
    });
    send(socket, { type: "session.state", state: "error", id: message.id });
  } finally {
    controllers.delete(message.id);
  }
}

function send(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function getServerPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    return 0;
  }
  return address.port;
}
