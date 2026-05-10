import type { WebSocket } from "ws";
import type { BrowserActionSessionManager } from "../../../browser-action/index.js";
import type { BrowserPerceptionService } from "../../../browser-perception/index.js";
import type { ProviderRegistry } from "../../../providers/providerRegistry.js";
import type { StorageService } from "../../../storage/storage.js";
import type { BrowserExtensionBridgeStore } from "../../browser-bridge/store.js";

export type BrowserActionMessageContext = {
  socket: WebSocket;
  clients: Set<WebSocket>;
  storage: StorageService;
  providers: ProviderRegistry;
  browserPerception: BrowserPerceptionService;
  browserActions: BrowserActionSessionManager;
  browserExtensionBridge?: BrowserExtensionBridgeStore;
};
