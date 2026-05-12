import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebSocket } from "ws";
import type { OAuthSession } from "../../oauth.js";
import type { BrowserActionSessionManager } from "../../browser-action/index.js";
import type { BrowserChromeCommandBridge } from "../../browser-chrome/index.js";
import type { BrowserPerceptionService } from "../../browser-perception/index.js";
import type { ProviderRegistry } from "../../providers/providerRegistry.js";
import type { SemanticMemoryStore } from "../../semantic-interface/index.js";
import type { StorageService } from "../../storage/storage.js";
import type { BrowserActionCommandWaiter } from "../browser-action/commandWaiters.js";
import type { BrowserExtensionBridgeStore } from "../browser-bridge/store.js";
import type { HttpRouteContext } from "./context.js";
import { handleBrowserBridgeRoute } from "./routes/browserBridgeRoutes.js";
import { handleCapabilityRoute } from "./routes/capabilityRoutes.js";
import { handleOAuthRoute } from "./routes/oauthRoutes.js";
import { handleProviderSnapshotRoute } from "./routes/providerSnapshotRoutes.js";
import { handleSemanticMemoryRoute } from "./routes/semanticMemoryRoutes.js";
import { handleStorageRoute } from "./routes/storageRoutes.js";

type HttpRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: HttpRouteContext
) => Promise<boolean>;

const routeHandlers: HttpRouteHandler[] = [
  handleCapabilityRoute,
  handleBrowserBridgeRoute,
  handleOAuthRoute,
  handleProviderSnapshotRoute,
  handleStorageRoute,
  handleSemanticMemoryRoute
];

export async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  auth: OAuthSession,
  onAuthChanged: () => void,
  providers: ProviderRegistry,
  browserPerception: BrowserPerceptionService,
  browserActions: BrowserActionSessionManager,
  browserChromeCommands: BrowserChromeCommandBridge,
  browserExtensionBridge: BrowserExtensionBridgeStore,
  clients: Set<WebSocket>,
  storage: StorageService,
  capabilityRuntime: import("../../capability-runtime/index.js").CapabilityRuntime,
  semanticMemory: SemanticMemoryStore,
  browserActionCommandWaiters: Map<string, BrowserActionCommandWaiter>
): Promise<void> {
  if (!request.url) {
    response.writeHead(404).end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
  if (request.method === "OPTIONS" && isCorsRoute(url.pathname)) {
    response
      .writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "content-type"
      })
      .end();
    return;
  }

  const context: HttpRouteContext = {
    auth,
    onAuthChanged,
    providers,
    browserPerception,
    browserActions,
    browserChromeCommands,
    browserExtensionBridge,
    clients,
    storage,
    capabilityRuntime,
    semanticMemory,
    browserActionCommandWaiters
  };

  for (const handler of routeHandlers) {
    if (await handler(request, response, url, context)) {
      return;
    }
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Codex widget daemon");
}

function isCorsRoute(pathname: string): boolean {
  return isProviderSnapshotPath(pathname) || isBrowserActionPath(pathname) || isSemanticMemoryPath(pathname) || isCapabilityPath(pathname);
}

function isProviderSnapshotPath(pathname: string): boolean {
  return pathname === "/providers/dom/snapshot" || pathname === "/providers/screen/snapshot";
}

function isBrowserActionPath(pathname: string): boolean {
  return pathname.startsWith("/browser-action/");
}

function isSemanticMemoryPath(pathname: string): boolean {
  return pathname.startsWith("/semantic-memory/");
}

function isCapabilityPath(pathname: string): boolean {
  return pathname.startsWith("/capabilities/");
}
