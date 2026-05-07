import type { BrowserAction, BrowserElement, BrowserQueuedCommand } from "./types.js";

export function createBrowserQueuedCommand(input: {
  requestId: string;
  actionSessionId: string;
  resultId: string;
  adapterId?: string;
  action: BrowserAction;
  target?: BrowserElement;
}): BrowserQueuedCommand {
  return {
    ...input,
    createdAt: new Date().toISOString()
  };
}
