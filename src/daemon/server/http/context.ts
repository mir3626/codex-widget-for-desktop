import type { WebSocket } from "ws";
import type { OAuthSession } from "../../oauth.js";
import type { BrowserActionSessionManager } from "../../browser-action/index.js";
import type { BrowserChromeCommandBridge } from "../../browser-chrome/index.js";
import type { BrowserPerceptionService } from "../../browser-perception/index.js";
import type { ProviderRegistry } from "../../providers/providerRegistry.js";
import type { SemanticMemoryStore } from "../../semantic-interface/index.js";
import type { StorageService } from "../../storage/storage.js";
import type { CapabilityRuntime } from "../../capability-runtime/index.js";
import type { BrowserActionCommandWaiter } from "../browser-action/commandWaiters.js";
import type { BrowserExtensionBridgeStore } from "../browser-bridge/store.js";

export type HttpRouteContext = {
  auth: OAuthSession;
  onAuthChanged: () => void;
  providers: ProviderRegistry;
  browserPerception: BrowserPerceptionService;
  browserActions: BrowserActionSessionManager;
  browserChromeCommands: BrowserChromeCommandBridge;
  browserExtensionBridge: BrowserExtensionBridgeStore;
  clients: Set<WebSocket>;
  storage: StorageService;
  capabilityRuntime: CapabilityRuntime;
  semanticMemory: SemanticMemoryStore;
  browserActionCommandWaiters: Map<string, BrowserActionCommandWaiter>;
};
