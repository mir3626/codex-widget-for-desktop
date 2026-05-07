import { buildBrowserObservation } from "../browserObservation.js";
import { inspectEvaluateCode } from "../evaluatePolicy.js";
import type { BrowserActionAdapter, BrowserActionExecutionResult, BrowserExecuteInput, BrowserObservation, BrowserObserveInput } from "../types.js";

type PlaywrightApi = Pick<typeof import("@playwright/test"), "chromium">;
type Browser = Awaited<ReturnType<PlaywrightApi["chromium"]["launch"]>>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;

export const playwrightAdapter: BrowserActionAdapter = {
  id: "playwright",
  label: "Playwright controlled browser",
  capabilities: ["observe_dom", "screenshot", "click", "type", "select", "scroll", "navigate", "tab_control", "evaluate"],
  async isAvailable() {
    return Boolean(await safeLoadPlaywright());
  },
  async getStatus() {
    const api = await safeLoadPlaywright();
    if (!api) {
      return {
        id: "playwright",
        label: "Playwright controlled browser",
        state: "unavailable",
        capabilities: playwrightAdapter.capabilities,
        detail: "@playwright/test is not installed or cannot be loaded.",
        checkedAt: new Date().toISOString()
      };
    }
    return {
      id: "playwright",
      label: "Playwright controlled browser",
      state: "ready",
      capabilities: playwrightAdapter.capabilities,
      detail: "Playwright can launch a controlled Chromium browser.",
      checkedAt: new Date().toISOString(),
      diagnostics: { executablePath: api.chromium.executablePath() }
    };
  },
  async observe(input) {
    const pageSession = await openPlaywrightPage(input);
    try {
      const snapshot = await collectSnapshot(pageSession.page);
      return buildBrowserObservation({ source: input.session.source, snapshot });
    } finally {
      await pageSession.browser.close();
    }
  },
  async execute(input) {
    const pageSession = await openPlaywrightPage({ session: input.session, providerState: { url: input.observation.url } });
    try {
      const before = await collectSnapshot(pageSession.page);
      if (input.action.type === "screenshot") {
        const buffer = await pageSession.page.screenshot({ fullPage: Boolean(input.action.fullPage), type: "png" });
        const after = await collectSnapshot(pageSession.page);
        after.screenshot = { dataUrl: `data:image/png;base64,${buffer.toString("base64")}`, title: "Playwright screenshot" };
        return { requestId: "playwright", adapterId: "playwright", ok: true, before, after };
      }
      const actionResult = await executeOnPlaywrightPage(pageSession.page, input);
      const after = await collectSnapshot(pageSession.page);
      return {
        requestId: "playwright",
        adapterId: "playwright",
        ok: actionResult.ok,
        before,
        after,
        error: actionResult.error,
        metadata: actionResult.metadata
      };
    } finally {
      await pageSession.browser.close();
    }
  }
};

async function safeLoadPlaywright(): Promise<PlaywrightApi | undefined> {
  try {
    const api = await import("@playwright/test");
    return { chromium: api.chromium };
  } catch {
    return undefined;
  }
}

async function openPlaywrightPage(input: BrowserObserveInput): Promise<{ browser: Browser; page: Page }> {
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

async function executeOnPlaywrightPage(page: Page, input: BrowserExecuteInput): Promise<{ ok: boolean; error?: string; metadata?: Record<string, unknown> }> {
  const target = input.target;
  try {
    if (input.action.type === "read") {
      return { ok: true };
    }
    if (input.action.type === "navigate") {
      await page.goto(input.action.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      return { ok: true };
    }
    if (input.action.type === "back") {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 5_000 }).catch(() => null);
      return { ok: true };
    }
    if (input.action.type === "forward") {
      await page.goForward({ waitUntil: "domcontentloaded", timeout: 5_000 }).catch(() => null);
      return { ok: true };
    }
    if (input.action.type === "reload") {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
      return { ok: true };
    }
    if (input.action.type === "scroll") {
      const delta = readScrollDelta(input.action.amount, input.action.direction);
      await page.mouse.wheel(delta.x, delta.y);
      return { ok: true };
    }
    if (input.action.type === "evaluate") {
      const guard = inspectEvaluateCode(input.action);
      if (!guard.ok) {
        return { ok: false, error: guard.reason, metadata: { codeHash: guard.codeHash } };
      }
      const value = await page.evaluate(
        async ({ code, selector, resultLimitBytes }) => {
          const targetElement = selector ? document.querySelector(selector) : document.activeElement;
          const fn = new Function("target", `"use strict"; return (async () => {\n${code}\n})()`);
          const result = await fn(targetElement);
          return JSON.stringify(result, (_key, item) => typeof item === "bigint" ? String(item) : item).slice(0, resultLimitBytes);
        },
        {
          code: input.action.code,
          selector: target?.selector,
          resultLimitBytes: guard.resultLimitBytes
        }
      );
      return { ok: true, metadata: { codeHash: guard.codeHash, resultPreview: value } };
    }

    const locator = target?.selector ? page.locator(target.selector).first() : undefined;
    if (!locator) {
      return { ok: false, error: "Playwright execution requires a selector-backed target." };
    }
    if (input.action.type === "click") {
      await locator.click({ timeout: 5_000 });
      return { ok: true };
    }
    if (input.action.type === "type") {
      if (input.action.clearFirst) {
        await locator.fill(input.action.text, { timeout: 5_000 });
      } else {
        await locator.type(input.action.text, { timeout: 5_000 });
      }
      if (input.action.submit) {
        await locator.press("Enter", { timeout: 5_000 });
      }
      return { ok: true };
    }
    if (input.action.type === "select") {
      await locator.selectOption(input.action.value, { timeout: 5_000 });
      return { ok: true };
    }
    if (input.action.type === "check") {
      if (input.action.checked) {
        await locator.check({ timeout: 5_000 });
      } else {
        await locator.uncheck({ timeout: 5_000 });
      }
      return { ok: true };
    }
    return { ok: false, error: `Playwright does not support action type: ${input.action.type}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Playwright action failed." };
  }
}

async function collectSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("a[href],button,input,textarea,select,option,summary,label,[role],[aria-label],[title],[contenteditable='true'],[data-testid]"))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .slice(0, 220)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const input = element instanceof HTMLInputElement ? element : undefined;
        const sensitive = input ? /password|hidden|token|secret|card|cc/.test(input.type.toLowerCase()) : false;
        return {
          id: readStableId(element, index),
          role: element.getAttribute("role") || inferRole(element),
          tagName: element.tagName.toLowerCase(),
          label: normalizeText(element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || element.textContent || "").slice(0, 500) || undefined,
          text: normalizeText(element.innerText || element.textContent || "").slice(0, 500) || undefined,
          value: sensitive ? undefined : readValue(element),
          selector: buildSelector(element),
          bbox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          visible: rect.width > 0 && rect.height > 0,
          enabled: !element.matches(":disabled,[aria-disabled='true']"),
          editable: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element.isContentEditable,
          checked: "checked" in element ? Boolean(element.checked) : undefined,
          selected: "selected" in element ? Boolean(element.selected) : undefined,
          href: element instanceof HTMLAnchorElement ? element.href || undefined : undefined,
          inputType: input ? input.type.toLowerCase() : undefined,
          confidence: 0.9,
          riskHints: []
        };
      });
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      },
      focusedElementId: undefined,
      selection: window.getSelection()?.toString() ?? "",
      text: (document.body?.innerText ?? "").slice(0, 20_000),
      elements
    };

    function inferRole(element: HTMLElement): string | undefined {
      const tag = element.tagName.toLowerCase();
      if (tag === "a" && element.getAttribute("href")) return "link";
      if (tag === "button" || tag === "summary") return "button";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (tag === "input") {
        const type = element.getAttribute("type")?.toLowerCase() || "text";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (["button", "submit", "reset"].includes(type)) return "button";
        return "textbox";
      }
      return undefined;
    }

    function readStableId(element: HTMLElement, index: number): string {
      return element.id || element.getAttribute("data-testid") || `el-${index + 1}`;
    }

    function readValue(element: HTMLElement): string | undefined {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return normalizeText(element.value).slice(0, 500) || undefined;
      }
      return undefined;
    }

    function buildSelector(element: HTMLElement): string | undefined {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testId = element.getAttribute("data-testid");
      if (testId) return `${element.tagName.toLowerCase()}[data-testid="${testId.replace(/"/g, "\\\"")}"]`;
      const aria = element.getAttribute("aria-label");
      if (aria) return `${element.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, "\\\"")}"]`;
      return element.tagName.toLowerCase();
    }

    function normalizeText(value: unknown): string {
      return String(value ?? "").replace(/\s+/g, " ").trim();
    }
  });
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

function readScrollDelta(amount: "small" | "medium" | "large" | number | undefined, direction: string): { x: number; y: number } {
  const pixels = typeof amount === "number" ? amount : amount === "small" ? 240 : amount === "large" ? 960 : 520;
  if (direction === "up") return { x: 0, y: -pixels };
  if (direction === "left") return { x: -pixels, y: 0 };
  if (direction === "right") return { x: pixels, y: 0 };
  return { x: 0, y: pixels };
}
