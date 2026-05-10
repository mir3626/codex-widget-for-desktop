import type { ClientMessage } from "../../../shared/protocol.js";
import type { MessageRouterContext } from "./context.js";
import { handleVisionContextCompleteMessage } from "./visionContextCompleteMessage.js";
import { handleVisionContextLifecycleMessage } from "./visionContextLifecycleMessages.js";

type VisionContextMessageHandler = (
  message: ClientMessage,
  context: MessageRouterContext
) => Promise<boolean>;

const visionContextHandlers: VisionContextMessageHandler[] = [
  handleVisionContextLifecycleMessage,
  handleVisionContextCompleteMessage
];

export async function handleVisionContextMessage(message: ClientMessage, context: MessageRouterContext): Promise<boolean> {
  for (const handler of visionContextHandlers) {
    if (await handler(message, context)) {
      return true;
    }
  }
  return false;
}
