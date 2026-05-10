import type { ClientMessage } from "../../../../shared/protocol.js";
import type { BrowserActionMessageContext } from "./context.js";
import { handleBrowserActionExecuteMessage } from "./executeMessage.js";
import { handleBrowserActionObserveMessage } from "./observeMessage.js";
import { handleBrowserActionPlanMessage } from "./planMessage.js";

type BrowserActionExecutionHandler = (
  message: ClientMessage,
  context: BrowserActionMessageContext
) => Promise<boolean>;

const executionHandlers: BrowserActionExecutionHandler[] = [
  handleBrowserActionObserveMessage,
  handleBrowserActionExecuteMessage,
  handleBrowserActionPlanMessage
];

export async function handleBrowserActionExecutionMessage(
  message: ClientMessage,
  context: BrowserActionMessageContext
): Promise<boolean> {
  for (const handler of executionHandlers) {
    if (await handler(message, context)) {
      return true;
    }
  }
  return false;
}
