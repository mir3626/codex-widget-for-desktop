import type { CapabilityJobSummary } from "../../shared/protocol.js";

export type BrowserChromeCommandName =
  | "bookmark.list"
  | "bookmark.create"
  | "bookmark.update"
  | "bookmark.remove"
  | "bookmark.open";

export type BrowserChromeBridgeCommand = {
  kind: "browser_chrome";
  requestId: string;
  jobId: string;
  transactionId: string;
  command: BrowserChromeCommandName;
  payload: Record<string, unknown>;
  createdAt: string;
  deadlineAt: string;
  deliveredAt?: string;
  deliveryAttempts?: number;
};

export type BrowserChromeBridgeResult = {
  requestId: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
};

type PendingBrowserChromeCommand = {
  command: BrowserChromeBridgeCommand;
  resolve: (result: BrowserChromeBridgeResult) => void;
  timeout: NodeJS.Timeout;
};

const REDELIVERY_WAIT_MS = 750;

export class BrowserChromeCommandBridge {
  private pending: PendingBrowserChromeCommand[] = [];

  run(input: {
    job: CapabilityJobSummary;
    command: BrowserChromeCommandName;
    payload: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<BrowserChromeBridgeResult> {
    const requestId = `browser-chrome:${input.job.id}`;
    const existing = this.pending.find((item) => item.command.requestId === requestId);
    if (existing) {
      return new Promise((resolve) => {
        const previousResolve = existing.resolve;
        existing.resolve = (result) => {
          previousResolve(result);
          resolve(result);
        };
      });
    }

    return new Promise((resolve) => {
      const finish = (result: BrowserChromeBridgeResult) => {
        const index = this.pending.findIndex((item) => item.command.requestId === requestId);
        if (index >= 0) {
          const [pending] = this.pending.splice(index, 1);
          clearTimeout(pending.timeout);
        }
        input.signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const timeout = setTimeout(() => {
        finish({
          requestId,
          ok: false,
          error: "Browser Chrome command timed out before the Browser Bridge returned a result.",
          metadata: { reason: "timeout" }
        });
      }, input.job.timeoutMs);
      const onAbort = () => {
        finish({
          requestId,
          ok: false,
          error: "Browser Chrome command cancelled.",
          metadata: { reason: "cancelled" }
        });
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.push({
        command: {
          kind: "browser_chrome",
          requestId,
          jobId: input.job.id,
          transactionId: input.job.transactionId,
          command: input.command,
          payload: input.payload,
          createdAt: new Date().toISOString(),
          deadlineAt: input.job.deadlineAt
        },
        resolve: finish,
        timeout
      });
    });
  }

  poll(): BrowserChromeBridgeCommand | undefined {
    const now = Date.now();
    for (let index = 0; index < this.pending.length; index += 1) {
      const pending = this.pending[index];
      if (Date.parse(pending.command.deadlineAt) <= now) {
        pending.resolve({
          requestId: pending.command.requestId,
          ok: false,
          error: "Browser Chrome command expired before delivery.",
          metadata: { reason: "expired" }
        });
        index -= 1;
        continue;
      }
      const deliveredAt = pending.command.deliveredAt ? Date.parse(pending.command.deliveredAt) : 0;
      if (deliveredAt && now - deliveredAt < REDELIVERY_WAIT_MS) {
        continue;
      }
      pending.command.deliveredAt = new Date(now).toISOString();
      pending.command.deliveryAttempts = (pending.command.deliveryAttempts ?? 0) + 1;
      return pending.command;
    }
    return undefined;
  }

  complete(input: BrowserChromeBridgeResult): boolean {
    const pending = this.pending.find((item) => item.command.requestId === input.requestId);
    if (!pending) {
      return false;
    }
    pending.resolve(input);
    return true;
  }

  cancelAll(reason = "daemon_shutdown"): void {
    for (const pending of [...this.pending]) {
      pending.resolve({
        requestId: pending.command.requestId,
        ok: false,
        error: `Browser Chrome command cancelled: ${reason}`,
        metadata: { reason }
      });
    }
  }
}

export function readBrowserChromeCommand(input: unknown): { command: BrowserChromeCommandName; payload: Record<string, unknown> } {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const command = isBrowserChromeCommandName(record.command) ? record.command : "bookmark.list";
  const payload = record.payload && typeof record.payload === "object" ? record.payload as Record<string, unknown> : record;
  return { command, payload: sanitizeBrowserChromePayload(payload) };
}

function isBrowserChromeCommandName(value: unknown): value is BrowserChromeCommandName {
  return value === "bookmark.list" ||
    value === "bookmark.create" ||
    value === "bookmark.update" ||
    value === "bookmark.remove" ||
    value === "bookmark.open";
}

function sanitizeBrowserChromePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/password|token|cookie|credential|payment|card|secret/i.test(key)) {
      output[key] = "[redacted]";
    } else if (typeof value === "string") {
      output[key] = value.slice(0, 2048);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      output[key] = value;
    } else if (Array.isArray(value)) {
      output[key] = value.slice(0, 100);
    } else if (value && typeof value === "object") {
      output[key] = sanitizeBrowserChromePayload(value as Record<string, unknown>);
    }
  }
  return output;
}
