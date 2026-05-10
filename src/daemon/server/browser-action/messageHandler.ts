import type { WebSocket } from "ws";
import type { BrowserActionSessionManager } from "../../browser-action/index.js";
import type { BrowserPerceptionService } from "../../browser-perception/index.js";
import type { ProviderRegistry } from "../../providers/providerRegistry.js";
import type { StorageService } from "../../storage/storage.js";
import type { BrowserExtensionBridgeStore } from "../browser-bridge/store.js";
import type { ClientMessage } from "../../../shared/protocol.js";
import type { BrowserActionMessageContext } from "./messages/context.js";
import { handleBrowserActionDirectCommandMessage } from "./messages/directCommandMessages.js";
import { handleBrowserActionExecutionMessage } from "./messages/executionMessages.js";
import { handleBrowserActionPolicyMessage } from "./messages/policyMessages.js";
import { handleBrowserActionSessionMessage } from "./messages/sessionMessages.js";

type BrowserActionMessageHandler = (
  message: ClientMessage,
  context: BrowserActionMessageContext
) => Promise<boolean>;

const browserActionMessageHandlers: BrowserActionMessageHandler[] = [
  handleBrowserActionSessionMessage,
  handleBrowserActionDirectCommandMessage,
  handleBrowserActionExecutionMessage,
  handleBrowserActionPolicyMessage
];

export async function handleBrowserActionMessage(input: {
  message: ClientMessage;
  socket: WebSocket;
  clients: Set<WebSocket>;
  storage: StorageService;
  providers: ProviderRegistry;
  browserPerception: BrowserPerceptionService;
  browserActions: BrowserActionSessionManager;
  browserExtensionBridge?: BrowserExtensionBridgeStore;
}): Promise<boolean> {
  const context: BrowserActionMessageContext = {
    socket: input.socket,
    clients: input.clients,
    storage: input.storage,
    providers: input.providers,
    browserPerception: input.browserPerception,
    browserActions: input.browserActions,
    browserExtensionBridge: input.browserExtensionBridge
  };
  for (const handler of browserActionMessageHandlers) {
    if (await handler(input.message, context)) {
      return true;
    }
  }
  return false;
}
