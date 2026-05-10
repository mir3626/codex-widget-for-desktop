import type { WebSocket } from "ws";
import type { BrowserActionSessionManager } from "../../../browser-action/index.js";
import type { ProviderRegistry } from "../../../providers/providerRegistry.js";
import type { StorageService } from "../../../storage/storage.js";

export type BrowserActionMessageContext = {
  socket: WebSocket;
  clients: Set<WebSocket>;
  storage: StorageService;
  providers: ProviderRegistry;
  browserActions: BrowserActionSessionManager;
};
