import type { BrowserAction, BrowserElement, BrowserQueuedCommand } from "./types.js";

export function createBrowserQueuedCommand(input: {
  requestId: string;
  actionSessionId: string;
  resultId: string;
  adapterId?: string;
  action: BrowserAction;
  target?: BrowserElement;
  expectedSource?: BrowserQueuedCommand["expectedSource"];
  timeoutMs?: number;
  expiresInMs?: number;
}): BrowserQueuedCommand {
  const createdAt = new Date();
  const expiresInMs = Math.max(1000, input.expiresInMs ?? input.timeoutMs ?? 30_000);
  return {
    requestId: input.requestId,
    actionSessionId: input.actionSessionId,
    resultId: input.resultId,
    adapterId: input.adapterId,
    action: input.action,
    target: input.target,
    expectedSource: input.expectedSource,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + expiresInMs).toISOString()
  };
}
