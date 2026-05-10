import type { WebSocket } from "ws";
import type { OAuthSession } from "../../oauth.js";
import type { BrowserActionSessionManager } from "../../browser-action/index.js";
import type { ProviderRegistry } from "../../providers/providerRegistry.js";
import type { SemanticMemoryStore } from "../../semantic-interface/index.js";
import type { StorageService } from "../../storage/storage.js";
import type { BrowserActionCommandWaiter } from "../browser-action/commandWaiters.js";
import type { BrowserExtensionBridgeStore } from "../browser-bridge/store.js";

export type HttpRouteContext = {
  auth: OAuthSession;
  onAuthChanged: () => void;
  providers: ProviderRegistry;
  browserActions: BrowserActionSessionManager;
  browserExtensionBridge: BrowserExtensionBridgeStore;
  clients: Set<WebSocket>;
  storage: StorageService;
  semanticMemory: SemanticMemoryStore;
  browserActionCommandWaiters: Map<string, BrowserActionCommandWaiter>;
};
