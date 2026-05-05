import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { daemonInfo, runAgentStream, type AgentSessionState } from "./agent.js";
import { CodexAppServerBridge } from "./codexAppServer.js";
import { resolveCodexExecutionContext } from "./codexRuntime.js";
import { OAuthSession } from "./oauth.js";
import { captureScreenSnapshot } from "./providers/screenCaptureProvider.js";
import { ProviderRegistry, type ScreenSnapshot } from "./providers/providerRegistry.js";
import { getProviderStatuses } from "./tools.js";
import type { ClientMessage, MessageSnapshotStatus, RuntimeStatus, ScreenCrop, ServerEvent } from "../shared/protocol.js";

export type DaemonHandle = {
  port: number;
  close: () => Promise<void>;
};

export type DaemonOptions = {
  port?: number;
};

type RetainedMessage = {
  id: string;
  text: string;
  status: MessageSnapshotStatus;
  updatedAt: number;
};

const MAX_RETAINED_MESSAGES = 80;

export async function startDaemon(options: DaemonOptions = {}): Promise<DaemonHandle> {
  let serverRef: Server | undefined;
  const controllers = new Map<string, AbortController>();
  const retainedMessages = new Map<string, RetainedMessage>();
  const clients = new Set<WebSocket>();
  const startedAt = Date.now();
  const auth = new OAuthSession(() => (serverRef ? getServerPort(serverRef) : 0));
  const codexAppServer = new CodexAppServerBridge();
  const providers = new ProviderRegistry();
  const agentSession: AgentSessionState = {};
  const onAuthChanged = () => {
    broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    syncCodexAppServer(auth, codexAppServer);
  };

  const server = createServer((request, response) => {
    void handleHttpRequest(request, response, auth, onAuthChanged, providers, clients);
  });
  serverRef = server;
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    clients.add(socket);
    send(socket, { type: "connected", daemon: daemonInfo(getServerPort(server), auth.getStatus()) });
    send(socket, { type: "auth.status", auth: auth.getStatus() });
    send(socket, { type: "provider.status", providers: getProviderStatuses(providers) });
    send(socket, { type: "runtime.status", status: readRuntimeStatus(startedAt, clients, controllers, codexAppServer) });
    send(socket, { type: "session.state", state: "idle" });
    replayRetainedMessages(socket, retainedMessages);

    socket.on("message", (raw) => {
      void handleMessage(
        raw.toString(),
        socket,
        controllers,
        retainedMessages,
        auth,
        clients,
        agentSession,
        codexAppServer,
        providers,
        getServerPort(server)
      );
    });

    socket.on("close", () => {
      clients.delete(socket);
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
  const runtimeStatusTimer = setInterval(() => {
    broadcast(clients, { type: "runtime.status", status: readRuntimeStatus(startedAt, clients, controllers, codexAppServer) });
  }, 5_000);

  return {
    port: getServerPort(server),
    close: async () => {
      clearInterval(runtimeStatusTimer);
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
  retainedMessages: Map<string, RetainedMessage>,
  auth: OAuthSession,
  clients: Set<WebSocket>,
  agentSession: AgentSessionState,
  codexAppServer: CodexAppServerBridge,
  providers: ProviderRegistry,
  daemonPort: number
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
    retainAndBroadcast(clients, retainedMessages, { type: "session.state", state: "cancelled", id: message.id });
    return;
  }

  if (message.type === "session.reset") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
    broadcast(clients, { type: "session.reset" });
    broadcast(clients, { type: "session.state", state: "idle" });
    return;
  }

  if (message.type === "session.branch") {
    resetRuntimeSession(controllers, retainedMessages, agentSession, codexAppServer);
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

  if (message.type === "provider.captureScreen") {
    void captureScreenFromHelper(message.description, message.crop, clients, daemonPort);
    return;
  }

  if (message.type !== "ask") {
    send(socket, { type: "error", message: "Unsupported daemon message." });
    return;
  }

  const controller = new AbortController();
  controllers.set(message.id, controller);

  try {
    await prepareRegeneration(message, auth, codexAppServer);
    await runAgentStream(message, (event) => retainAndBroadcast(clients, retainedMessages, event), controller.signal, {
      ...auth.getProxyCredentials(),
      session: agentSession,
      codexAppServer,
      providers
    });
  } catch (error) {
    if (controller.signal.aborted) {
      retainAndBroadcast(clients, retainedMessages, { type: "session.state", state: "cancelled", id: message.id });
      return;
    }
    retainAndBroadcast(clients, retainedMessages, {
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : "Unknown daemon error."
    });
    retainAndBroadcast(clients, retainedMessages, { type: "session.state", state: "error", id: message.id });
  } finally {
    controllers.delete(message.id);
  }
}

async function captureScreenFromHelper(
  description: string | undefined,
  crop: ScreenCrop | undefined,
  clients: Set<WebSocket>,
  daemonPort: number
): Promise<void> {
  broadcast(clients, {
    type: "provider.capture",
    mode: "screen",
    state: "started",
    message: "screen capture started"
  });

  try {
    const result = await captureScreenSnapshot({ daemonPort, description, crop });
    broadcast(clients, {
      type: "provider.capture",
      mode: "screen",
      state: "completed",
      message: result.output || "screen capture completed"
    });
  } catch (error) {
    broadcast(clients, {
      type: "provider.capture",
      mode: "screen",
      state: "error",
      message: error instanceof Error ? error.message : "Screen capture failed."
    });
  }
}

function resetAgentSession(agentSession: AgentSessionState): void {
  agentSession.codexThreadId = undefined;
  agentSession.proxySessionId = undefined;
}

function resetRuntimeSession(
  controllers: Map<string, AbortController>,
  retainedMessages: Map<string, RetainedMessage>,
  agentSession: AgentSessionState,
  codexAppServer: CodexAppServerBridge
): void {
  for (const controller of controllers.values()) {
    controller.abort();
  }
  controllers.clear();
  retainedMessages.clear();
  resetAgentSession(agentSession);
  codexAppServer.resetThread();
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
  onAuthChanged: () => void,
  providers: ProviderRegistry,
  clients: Set<WebSocket>
): Promise<void> {
  if (!request.url) {
    response.writeHead(404).end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
  if (request.method === "OPTIONS" && isProviderSnapshotPath(url.pathname)) {
    response
      .writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "content-type"
      })
      .end();
    return;
  }

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

  if (request.method === "POST" && url.pathname === "/providers/dom/snapshot") {
    try {
      const snapshot = providers.setDomSnapshot(JSON.parse(await readRequestBody(request, 128 * 1024)));
      writeJsonResponse(response, 200, { ok: true, snapshot });
      broadcast(clients, { type: "provider.status", providers: getProviderStatuses(providers) });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid DOM snapshot."
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/providers/dom/snapshot") {
    writeJsonResponse(response, 200, { ok: true, snapshot: providers.getDomSnapshot() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/providers/screen/snapshot") {
    try {
      const snapshot = providers.setScreenSnapshot(JSON.parse(await readRequestBody(request, 2 * 1024 * 1024)));
      writeJsonResponse(response, 200, { ok: true, snapshot: summarizeScreenSnapshot(snapshot) });
      broadcast(clients, { type: "provider.status", providers: getProviderStatuses(providers) });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid screen snapshot."
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/providers/screen/snapshot") {
    const snapshot = providers.getScreenSnapshot();
    writeJsonResponse(response, 200, { ok: true, snapshot: snapshot ? summarizeScreenSnapshot(snapshot) : null });
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

async function readRequestBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function isProviderSnapshotPath(pathname: string): boolean {
  return pathname === "/providers/dom/snapshot" || pathname === "/providers/screen/snapshot";
}

function summarizeScreenSnapshot(snapshot: ScreenSnapshot): Omit<ScreenSnapshot, "imageDataUrl"> & {
  imageDataUrlLength: number;
} {
  return {
    source: snapshot.source,
    title: snapshot.title,
    description: snapshot.description,
    ocrText: snapshot.ocrText,
    imageHash: snapshot.imageHash,
    imageChanged: snapshot.imageChanged,
    imageDiffRatio: snapshot.imageDiffRatio,
    imageDiffThreshold: snapshot.imageDiffThreshold,
    imageMeaningfullyChanged: snapshot.imageMeaningfullyChanged,
    imageDataUrlLength: snapshot.imageDataUrl.length,
    capturedAt: snapshot.capturedAt
  };
}

async function prepareRegeneration(
  message: Extract<ClientMessage, { type: "ask" }>,
  auth: OAuthSession,
  codexAppServer: CodexAppServerBridge
): Promise<void> {
  const dropTurns = Math.floor(message.regenerate?.dropTurns ?? 0);
  if (dropTurns < 1) {
    return;
  }

  const status = auth.getStatus();
  if (status.mode === "codex" && status.authenticated && process.env.CODEX_WIDGET_CODEX_RUNTIME !== "exec") {
    await codexAppServer.rollbackThread(dropTurns);
  }
}

function broadcast(clients: Set<WebSocket>, event: ServerEvent): void {
  for (const client of clients) {
    send(client, event);
  }
}

function retainAndBroadcast(
  clients: Set<WebSocket>,
  retainedMessages: Map<string, RetainedMessage>,
  event: ServerEvent
): void {
  retainServerEvent(retainedMessages, event);
  broadcast(clients, event);
}

function retainServerEvent(retainedMessages: Map<string, RetainedMessage>, event: ServerEvent): void {
  if (event.type === "message.delta") {
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: `${current?.text ?? ""}${event.text}`,
      status: current?.status === "tooling" ? "tooling" : "streaming",
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "message.completed") {
    retainMessage(retainedMessages, {
      id: event.id,
      text: event.text,
      status: "done",
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "session.state" && event.id) {
    const status = sessionStateToSnapshotStatus(event.state);
    if (!status) {
      return;
    }
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: current?.text ?? "",
      status,
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "tool.started" || event.type === "tool.completed") {
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: current?.text ?? "",
      status: event.type === "tool.started" ? "tooling" : "streaming",
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "error" && event.id) {
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: current?.text ?? "",
      status: "error",
      updatedAt: Date.now()
    });
  }
}

function sessionStateToSnapshotStatus(state: Extract<ServerEvent, { type: "session.state" }>["state"]): MessageSnapshotStatus | undefined {
  if (state === "idle") {
    return undefined;
  }
  if (state === "thinking" || state === "tooling" || state === "streaming" || state === "cancelled" || state === "error") {
    return state;
  }
  return undefined;
}

function retainMessage(retainedMessages: Map<string, RetainedMessage>, message: RetainedMessage): void {
  retainedMessages.set(message.id, message);
  if (retainedMessages.size <= MAX_RETAINED_MESSAGES) {
    return;
  }

  const oldest = [...retainedMessages.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0];
  if (oldest) {
    retainedMessages.delete(oldest.id);
  }
}

function replayRetainedMessages(socket: WebSocket, retainedMessages: Map<string, RetainedMessage>): void {
  for (const message of [...retainedMessages.values()].sort((left, right) => left.updatedAt - right.updatedAt)) {
    send(socket, {
      type: "message.snapshot",
      id: message.id,
      text: message.text,
      status: message.status
    });
  }
}

function writeJsonResponse(response: ServerResponse, status: number, body: unknown): void {
  response
    .writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type"
    })
    .end(JSON.stringify(body));
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

function readRuntimeStatus(
  startedAt: number,
  clients: Set<WebSocket>,
  controllers: Map<string, AbortController>,
  codexAppServer: CodexAppServerBridge
): RuntimeStatus {
  return {
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    clients: clients.size,
    activeRequests: controllers.size,
    codexAppServer: codexAppServer.getStatus()
  };
}
