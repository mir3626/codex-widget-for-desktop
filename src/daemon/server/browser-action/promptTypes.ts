import type { WebSocket } from "ws";
import type { BrowserActionSessionManager } from "../../browser-action/index.js";
import type { ProviderRegistry } from "../../providers/providerRegistry.js";
import type { StorageService } from "../../storage/storage.js";
import type { ClientMessage, ServerEvent } from "../../../shared/protocol.js";
import type { BrowserExtensionBridgeStore } from "../browser-bridge/store.js";
import type { BrowserActionCommandWaiter } from "./commandWaiters.js";
import type { PendingSemanticClarification } from "./clarification.js";

export type BrowserActionPromptInput = {
  message: Extract<ClientMessage, { type: "ask" }>;
  sessionId: string;
  emit: (event: ServerEvent) => void;
  clients: Set<WebSocket>;
  storage: StorageService;
  providers: ProviderRegistry;
  browserActions: BrowserActionSessionManager;
  browserExtensionBridge: BrowserExtensionBridgeStore;
  semanticClarifications: Map<string, PendingSemanticClarification>;
  browserActionCommandWaiters: Map<string, BrowserActionCommandWaiter>;
};
