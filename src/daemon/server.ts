import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { daemonInfo, runAgentStream, type AgentSessionState } from "./agent.js";
import { CodexAppServerBridge } from "./codexAppServer.js";
import { resolveCodexExecutionContext } from "./codexRuntime.js";
import { OAuthSession } from "./oauth.js";
import { getProviderStatuses } from "./tools.js";
import type { ClientMessage, ServerEvent } from "../shared/protocol.js";

export type DaemonHandle = {
  port: number;
  close: () => Promise<void>;
};

export type DaemonOptions = {
  port?: number;
};

export async function startDaemon(options: DaemonOptions = {}): Promise<DaemonHandle> {
  let serverRef: Server | undefined;
  const controllers = new Map<string, AbortController>();
  const clients = new Set<WebSocket>();
  const auth = new OAuthSession(() => (serverRef ? getServerPort(serverRef) : 0));
  const codexAppServer = new CodexAppServerBridge();
  const agentSession: AgentSessionState = {};
  const onAuthChanged = () => {
    broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    syncCodexAppServer(auth, codexAppServer);
  };

  const server = createServer((request, response) => {
    void handleHttpRequest(request, response, auth, onAuthChanged);
  });
  serverRef = server;
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    clients.add(socket);
    send(socket, { type: "connected", daemon: daemonInfo(getServerPort(server), auth.getStatus()) });
    send(socket, { type: "auth.status", auth: auth.getStatus() });
    send(socket, { type: "provider.status", providers: getProviderStatuses() });
    send(socket, { type: "session.state", state: "idle" });

    socket.on("message", (raw) => {
      void handleMessage(raw.toString(), socket, controllers, auth, clients, agentSession, codexAppServer);
    });

    socket.on("close", () => {
      clients.delete(socket);
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
  syncCodexAppServer(auth, codexAppServer);

  return {
    port: getServerPort(server),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
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
      });
      await codexAppServer.close();
    }
  };
}

async function handleMessage(
  raw: string,
  socket: WebSocket,
  controllers: Map<string, AbortController>,
  auth: OAuthSession,
  clients: Set<WebSocket>,
  agentSession: AgentSessionState,
  codexAppServer: CodexAppServerBridge
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

  if (message.type === "auth.start") {
    try {
      const url = auth.startSignIn(() => {
        broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
        syncCodexAppServer(auth, codexAppServer);
      });
      if (url) {
        send(socket, { type: "auth.url", url });
      }
      send(socket, { type: "auth.status", auth: auth.getStatus() });
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to start OAuth sign-in."
      });
      send(socket, { type: "auth.status", auth: auth.getStatus() });
    }
    return;
  }

  if (message.type === "auth.logout") {
    auth.logout();
    resetAgentSession(agentSession);
    await codexAppServer.close();
    broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    return;
  }

  if (message.type === "auth.save-token") {
    try {
      auth.completeTokenEntry(
        new URLSearchParams({
          access_token: message.accessToken,
          proxy_url: message.proxyUrl,
          model_label: message.modelLabel ?? ""
        })
      );
      await codexAppServer.close();
      broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to save OAuth token."
      });
      send(socket, { type: "auth.status", auth: auth.getStatus() });
    }
    return;
  }

  if (message.type === "cancel") {
    controllers.get(message.id)?.abort();
    controllers.delete(message.id);
    send(socket, { type: "session.state", state: "cancelled", id: message.id });
    return;
  }

  if (message.type === "session.reset") {
    for (const controller of controllers.values()) {
      controller.abort();
    }
    controllers.clear();
    resetAgentSession(agentSession);
    codexAppServer.resetThread();
    broadcast(clients, { type: "session.reset" });
    broadcast(clients, { type: "session.state", state: "idle" });
    return;
  }

  if (message.type === "interaction.respond") {
    const handled = codexAppServer.respondToInteraction(message);
    if (!handled) {
      send(socket, {
        type: "error",
        message: "That Codex interaction is no longer active."
      });
    }
    return;
  }

  if (message.type !== "ask") {
    send(socket, { type: "error", message: "Unsupported daemon message." });
    return;
  }

  const controller = new AbortController();
  controllers.set(message.id, controller);

  try {
    await runAgentStream(message, (event) => send(socket, event), controller.signal, {
      ...auth.getProxyCredentials(),
      session: agentSession,
      codexAppServer
    });
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

function resetAgentSession(agentSession: AgentSessionState): void {
  agentSession.codexThreadId = undefined;
  agentSession.proxySessionId = undefined;
}

function syncCodexAppServer(auth: OAuthSession, codexAppServer: CodexAppServerBridge): void {
  const status = auth.getStatus();
  if (status.mode !== "codex" || !status.authenticated || process.env.CODEX_WIDGET_CODEX_RUNTIME === "exec") {
    codexAppServer.resetThread();
    return;
  }

  void codexAppServer.warm(resolveCodexExecutionContext()).catch(() => undefined);
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  auth: OAuthSession,
  onAuthChanged: () => void
): Promise<void> {
  if (!request.url) {
    response.writeHead(404).end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
  if (request.method === "GET" && url.pathname === "/oauth/token") {
    auth.writeTokenEntryResponse(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/oauth/token") {
    try {
      auth.completeTokenEntry(new URLSearchParams(await readRequestBody(request)));
      auth.writeCallbackResponse(response, true, "OAuth token이 저장되었습니다. 위젯으로 돌아가 계속 사용할 수 있습니다.");
    } catch (error) {
      auth.writeCallbackResponse(
        response,
        false,
        error instanceof Error ? error.message : "OAuth token save failed."
      );
    } finally {
      onAuthChanged();
    }
    return;
  }

  if (request.method !== "GET" || url.pathname !== "/oauth/callback") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Codex widget daemon");
    return;
  }

  try {
    await auth.completeCallback(url);
    auth.writeCallbackResponse(response, true, "위젯으로 돌아가 계속 사용할 수 있습니다.");
  } catch (error) {
    auth.writeCallbackResponse(
      response,
      false,
      error instanceof Error ? error.message : "OAuth callback failed."
    );
  } finally {
    onAuthChanged();
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function broadcast(clients: Set<WebSocket>, event: ServerEvent): void {
  for (const client of clients) {
    send(client, event);
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
