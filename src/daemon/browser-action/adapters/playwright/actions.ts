import { inspectEvaluateCode } from "../../evaluatePolicy.js";
import type { BrowserExecuteInput } from "../../types.js";
import type { Page } from "./runtime.js";

export async function executeOnPlaywrightPage(
  page: Page,
  input: BrowserExecuteInput
): Promise<{ ok: boolean; error?: string; metadata?: Record<string, unknown> }> {
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
      return executePlaywrightEvaluateAction(page, input);
    }
    return await executeElementAction(page, input);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Playwright action failed." };
  }
}

async function executePlaywrightEvaluateAction(
  page: Page,
  input: BrowserExecuteInput
): Promise<{ ok: boolean; error?: string; metadata?: Record<string, unknown> }> {
  if (input.action.type !== "evaluate") {
    return { ok: false, error: "Playwright evaluate helper received a non-evaluate action." };
  }
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
      selector: input.target?.selector,
      resultLimitBytes: guard.resultLimitBytes
    }
  );
  return { ok: true, metadata: { codeHash: guard.codeHash, resultPreview: value } };
}

async function executeElementAction(
  page: Page,
  input: BrowserExecuteInput
): Promise<{ ok: boolean; error?: string }> {
  const locator = input.target?.selector ? page.locator(input.target.selector).first() : undefined;
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
}

function readScrollDelta(amount: "small" | "medium" | "large" | number | undefined, direction: string): { x: number; y: number } {
  const pixels = typeof amount === "number" ? amount : amount === "small" ? 240 : amount === "large" ? 960 : 520;
  if (direction === "up") return { x: 0, y: -pixels };
  if (direction === "left") return { x: -pixels, y: 0 };
  if (direction === "right") return { x: pixels, y: 0 };
  return { x: 0, y: pixels };
}
