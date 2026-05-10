import type { ClientMessage } from "../../../shared/protocol.js";
import { writeTerminalSessionInput } from "../../providers/terminalSessionProvider.js";
import { send } from "../events.js";
import type { MessageRouterContext } from "./context.js";

export async function handleTerminalMessage(message: ClientMessage, context: MessageRouterContext): Promise<boolean> {
  if (message.type !== "terminal.input") {
    return false;
  }

  try {
    if (typeof message.data !== "string" || message.data.length > 4096) {
      throw new Error("Terminal input is invalid or too large.");
    }
    writeTerminalSessionInput(message.data, message.label?.trim() || "input");
  } catch (error) {
    send(context.socket, {
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : "Unable to send terminal input."
    });
  }
  return true;
}
