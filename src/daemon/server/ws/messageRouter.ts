import type { ClientMessage } from "../../../shared/protocol.js";
import { runAskMessage } from "../ask/runAskMessage.js";
import { handleBrowserActionMessage } from "../browser-action/messageHandler.js";
import { send } from "../events.js";
import { handleAuthMessage } from "./authMessages.js";
import { handleBrowserBridgeMessage } from "./browserBridgeMessages.js";
import { handleCapabilityMessage } from "./capabilityMessages.js";
import { handleDebugFeedbackMessage } from "./debugFeedbackMessages.js";
import type { MessageRouterContext } from "./context.js";
import { handleInteractionMessage } from "./interactionMessages.js";
import { handleProviderMessage } from "./providerMessages.js";
import { handleSessionMessage } from "./sessionMessages.js";
import { handleTerminalMessage } from "./terminalMessages.js";
import { handleVisionContextMessage } from "./visionContextMessages.js";

type MessageHandler = (message: ClientMessage, context: MessageRouterContext) => Promise<boolean>;

const messageHandlers: MessageHandler[] = [
  handleAuthMessage,
  handleBrowserBridgeMessage,
  handleSessionMessage,
  handleDebugFeedbackMessage,
  handleInteractionMessage,
  handleCapabilityMessage,
  handleProviderMessage,
  handleVisionContextMessage,
  async (message, context) =>
    handleBrowserActionMessage({
      message,
      socket: context.socket,
      clients: context.clients,
      storage: context.storage,
      providers: context.providers,
      browserPerception: context.browserPerception,
      browserActions: context.browserActions,
      browserExtensionBridge: context.browserExtensionBridge
    }),
  handleTerminalMessage
];

export async function handleMessage(raw: string, context: MessageRouterContext): Promise<void> {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    send(context.socket, { type: "error", message: "Invalid daemon message." });
    return;
  }

  if (message.type === "ping") {
    send(context.socket, { type: "pong" });
    return;
  }

  for (const handler of messageHandlers) {
    if (await handler(message, context)) {
      return;
    }
  }

  if (message.type !== "ask") {
    send(context.socket, { type: "error", message: "Unsupported daemon message." });
    return;
  }

  await runAskMessage({
    message,
    controllers: context.controllers,
    retainedMessages: context.retainedMessages,
    toolOutputBuffers: context.toolOutputBuffers,
    auth: context.auth,
    clients: context.clients,
    requestSessions: context.requestSessions,
    storage: context.storage,
    agentSession: context.agentSession,
    codexAppServer: context.codexAppServer,
    providers: context.providers,
    browserPerception: context.browserPerception,
    browserActions: context.browserActions,
    browserChromeCommands: context.browserChromeCommands,
    browserExtensionBridge: context.browserExtensionBridge,
    semanticClarifications: context.semanticClarifications,
    browserActionCommandWaiters: context.browserActionCommandWaiters
  });
}
