import type { BrowserObserveInput } from "../../types.js";

export type PlaywrightApi = Pick<typeof import("@playwright/test"), "chromium">;
export type Browser = Awaited<ReturnType<PlaywrightApi["chromium"]["launch"]>>;
export type Page = Awaited<ReturnType<Browser["newPage"]>>;
export type PlaywrightPageSession = {
  browser: Browser;
  page: Page;
  persistent: boolean;
  close: () => Promise<void>;
};

const persistentSessions = new Map<string, { browser: Browser; page: Page; loadedKey?: string }>();

export async function safeLoadPlaywright(): Promise<PlaywrightApi | undefined> {
  try {
    const api = await import("@playwright/test");
    return { chromium: api.chromium };
  } catch {
    return undefined;
  }
}

export async function openPlaywrightPage(input: BrowserObserveInput): Promise<PlaywrightPageSession> {
  const api = await safeLoadPlaywright();
  if (!api) {
    throw new Error("@playwright/test is unavailable.");
  }
  const state = readProviderState(input.providerState);
  if (shouldUsePersistentPlaywrightSession(input)) {
    const key = input.session.id;
    let session = persistentSessions.get(key);
    if (!session) {
      const browser = await api.chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      session = { browser, page };
      persistentSessions.set(key, session);
    }
    session.loadedKey = await loadPlaywrightPage(session.page, input, state, session.loadedKey);
    return {
      browser: session.browser,
      page: session.page,
      persistent: true,
      close: async () => {}
    };
  }

  const browser = await api.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await loadPlaywrightPage(page, input, state);
  return {
    browser,
    page,
    persistent: false,
    close: async () => {
      await browser.close();
    }
  };
}

export async function closePlaywrightBrowserSession(sessionId: string): Promise<boolean> {
  const session = persistentSessions.get(sessionId);
  if (!session) {
    return false;
  }
  persistentSessions.delete(sessionId);
  await session.browser.close();
  return true;
}

async function loadPlaywrightPage(
  page: Page,
  input: BrowserObserveInput,
  state: { url?: string; html?: string },
  loadedKey?: string
): Promise<string> {
  const url = state.url || input.session.source.url;
  const desiredKey = state.html
    ? `html:${state.html.length}:${state.html.slice(0, 80)}`
    : url
      ? `url:${url}`
      : "default";
  if (loadedKey === desiredKey) {
    return desiredKey;
  }
  if (state.html) {
    await page.setContent(state.html, { waitUntil: "domcontentloaded" });
  } else if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } else {
    await page.setContent("<!doctype html><title>Browser Action</title><main>No URL configured.</main>", { waitUntil: "domcontentloaded" });
  }
  return desiredKey;
}

function shouldUsePersistentPlaywrightSession(input: BrowserObserveInput): boolean {
  return input.session.source.kind === "controlled_browser" && /^computer-session-browser-action:/.test(input.session.id);
}

function readProviderState(value: unknown): { url?: string; html?: string } {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    url: typeof record.url === "string" ? record.url : undefined,
    html: typeof record.html === "string" ? record.html : undefined
  };
}
