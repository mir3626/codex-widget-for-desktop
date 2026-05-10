import type { BrowserObserveInput } from "../../types.js";

export type PlaywrightApi = Pick<typeof import("@playwright/test"), "chromium">;
export type Browser = Awaited<ReturnType<PlaywrightApi["chromium"]["launch"]>>;
export type Page = Awaited<ReturnType<Browser["newPage"]>>;

export async function safeLoadPlaywright(): Promise<PlaywrightApi | undefined> {
  try {
    const api = await import("@playwright/test");
    return { chromium: api.chromium };
  } catch {
    return undefined;
  }
}

export async function openPlaywrightPage(input: BrowserObserveInput): Promise<{ browser: Browser; page: Page }> {
  const api = await safeLoadPlaywright();
  if (!api) {
    throw new Error("@playwright/test is unavailable.");
  }
  const browser = await api.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const state = readProviderState(input.providerState);
  const url = state.url || input.session.source.url;
  if (state.html) {
    await page.setContent(state.html, { waitUntil: "domcontentloaded" });
  } else if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } else {
    await page.setContent("<!doctype html><title>Browser Action</title><main>No URL configured.</main>", { waitUntil: "domcontentloaded" });
  }
  return { browser, page };
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
