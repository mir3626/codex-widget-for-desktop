import type { BrowserActionResult } from "../../browser-action/index.js";

export type BrowserActionCommandWaiter = {
  resolve: (result: BrowserActionResult | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function waitForBrowserActionCommandResult(input: {
  requestId: string;
  waiters: Map<string, BrowserActionCommandWaiter>;
  timeoutMs: number;
}): Promise<BrowserActionResult | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      input.waiters.delete(input.requestId);
      resolve(undefined);
    }, input.timeoutMs);
    input.waiters.set(input.requestId, {
      timer,
      resolve: (result) => {
        clearTimeout(timer);
        input.waiters.delete(input.requestId);
        resolve(result);
      }
    });
  });
}

export function resolveBrowserActionCommandWaiter(
  waiters: Map<string, BrowserActionCommandWaiter>,
  requestId: string,
  result: BrowserActionResult
): void {
  const waiter = waiters.get(requestId);
  if (!waiter) {
    return;
  }
  waiter.resolve(result);
}

export function clearBrowserActionCommandWaiters(waiters: Map<string, BrowserActionCommandWaiter>): void {
  for (const waiter of waiters.values()) {
    clearTimeout(waiter.timer);
    waiter.resolve(undefined);
  }
  waiters.clear();
}
