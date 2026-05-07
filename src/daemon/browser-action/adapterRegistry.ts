import { cdpAdapter, extensionAdapter, nativeDesktopAdapter, playwrightAdapter } from "./adapters/index.js";
import type {
  BrowserActionAdapter,
  BrowserActionAdapterStatus,
  BrowserActionSession,
  BrowserExecuteInput,
  BrowserActionExecutionResult,
  BrowserObserveInput,
  BrowserObservation
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 12_000;

export class BrowserActionAdapterRegistry {
  private adapters: BrowserActionAdapter[];

  constructor(adapters: BrowserActionAdapter[] = [extensionAdapter, playwrightAdapter, cdpAdapter, nativeDesktopAdapter]) {
    this.adapters = adapters;
  }

  list(): BrowserActionAdapter[] {
    return [...this.adapters];
  }

  get(id: string): BrowserActionAdapter | undefined {
    return this.adapters.find((adapter) => adapter.id === id);
  }

  async statuses(session: BrowserActionSession): Promise<BrowserActionAdapterStatus[]> {
    return Promise.all(this.adapters.map((adapter) => readAdapterStatus(adapter, session)));
  }

  async select(input: { session: BrowserActionSession; preferredAdapterId?: string }): Promise<BrowserActionAdapter | undefined> {
    const candidates = input.preferredAdapterId
      ? this.adapters.filter((adapter) => adapter.id === input.preferredAdapterId)
      : this.adapters;
    for (const adapter of candidates) {
      if (await adapter.isAvailable({ session: input.session })) {
        return adapter;
      }
    }
    return undefined;
  }
}

export async function observeWithAdapter(input: {
  adapter: BrowserActionAdapter;
  observeInput: BrowserObserveInput;
  timeoutMs?: number;
}): Promise<BrowserObservation> {
  return withBrowserActionTimeout(
    input.adapter.observe(input.observeInput),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    `${input.adapter.label} observe timed out.`
  );
}

export async function executeWithAdapter(input: {
  adapter: BrowserActionAdapter;
  executeInput: BrowserExecuteInput;
  timeoutMs?: number;
}): Promise<BrowserActionExecutionResult> {
  const result = await withBrowserActionTimeout(
    input.adapter.execute(input.executeInput),
    input.timeoutMs ?? input.executeInput.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    `${input.adapter.label} execute timed out.`
  );
  return { ...result, adapterId: result.adapterId ?? input.adapter.id };
}

export async function readAdapterStatus(adapter: BrowserActionAdapter, session: BrowserActionSession): Promise<BrowserActionAdapterStatus> {
  const checkedAt = new Date().toISOString();
  try {
    if (adapter.getStatus) {
      return await adapter.getStatus({ session });
    }
    const available = await adapter.isAvailable({ session });
    return {
      id: adapter.id,
      label: adapter.label,
      state: available ? "ready" : "unavailable",
      capabilities: adapter.capabilities,
      detail: available ? "Adapter is available." : "Adapter is not available in this environment.",
      checkedAt
    };
  } catch (error) {
    return {
      id: adapter.id,
      label: adapter.label,
      state: "error",
      capabilities: adapter.capabilities,
      detail: error instanceof Error ? error.message : "Adapter status check failed.",
      checkedAt
    };
  }
}

export function withBrowserActionTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs));
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
