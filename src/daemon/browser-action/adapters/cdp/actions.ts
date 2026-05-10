import { inspectEvaluateCode } from "../../evaluatePolicy.js";
import type { BrowserAction, BrowserExecuteInput } from "../../types.js";
import type { CdpClient } from "./client.js";
import { evaluateCdp } from "./client.js";

export async function executeCdpAction(
  client: CdpClient,
  input: BrowserExecuteInput
): Promise<{ ok: boolean; error?: string; metadata?: Record<string, unknown> }> {
  if (input.action.type === "read") {
    return { ok: true };
  }
  if (input.action.type === "navigate") {
    await client.send("Page.navigate", { url: input.action.url });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { ok: true };
  }
  if (input.action.type === "back" || input.action.type === "forward" || input.action.type === "reload") {
    const browserAction = input.action.type === "back"
      ? "history.back()"
      : input.action.type === "forward"
        ? "history.forward()"
        : "location.reload()";
    await evaluateCdp(client, `(() => { ${browserAction}; return true; })()`);
    return { ok: true };
  }
  if (input.action.type === "evaluate") {
    return executeCdpEvaluateAction(client, input);
  }
  const expression = executeDomActionExpression(input.action, input.target?.selector);
  return await evaluateCdp<{ ok: boolean; error?: string }>(client, expression);
}

async function executeCdpEvaluateAction(
  client: CdpClient,
  input: BrowserExecuteInput
): Promise<{ ok: boolean; error?: string; metadata?: Record<string, unknown> }> {
  if (input.action.type !== "evaluate") {
    return { ok: false, error: "CDP evaluate helper received a non-evaluate action." };
  }
  const guard = inspectEvaluateCode(input.action);
  if (!guard.ok) {
    return { ok: false, error: guard.reason, metadata: { codeHash: guard.codeHash } };
  }
  const expression = `(() => {
    const target = ${JSON.stringify(input.target?.selector ?? "")} ? document.querySelector(${JSON.stringify(input.target?.selector ?? "")}) : document.activeElement;
    const fn = new Function("target", "return (async () => {\\n${escapeForNewFunction(input.action.code)}\\n})()");
    return Promise.resolve(fn(target)).then((value) => JSON.stringify(value).slice(0, ${guard.resultLimitBytes}));
  })()`;
  const value = await evaluateCdp<string>(client, expression);
  return { ok: true, metadata: { codeHash: guard.codeHash, resultPreview: value } };
}

function executeDomActionExpression(action: BrowserAction, selector?: string): string {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const selector = ${JSON.stringify(selector ?? "")};
    try {
      const target = selector ? document.querySelector(selector) : null;
      if (action.type === "scroll") {
        const pixels = typeof action.amount === "number" ? action.amount : action.amount === "small" ? 240 : action.amount === "large" ? 960 : 520;
        const x = action.direction === "left" ? -pixels : action.direction === "right" ? pixels : 0;
        const y = action.direction === "up" ? -pixels : action.direction === "down" ? pixels : 0;
        (target || window).scrollBy(x, y);
        return { ok: true };
      }
      if (!target) return { ok: false, error: "CDP action requires a selector-backed target." };
      if (action.type === "click") {
        target.scrollIntoView({ block: "center", inline: "center" });
        target.click();
        return { ok: true };
      }
      if (action.type === "type") {
        target.focus();
        if (!("value" in target) && !target.isContentEditable) return { ok: false, error: "Target is not editable." };
        if ("value" in target) target.value = action.clearFirst ? action.text : String(target.value || "") + action.text;
        else target.textContent = action.clearFirst ? action.text : String(target.textContent || "") + action.text;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      if (action.type === "select") {
        if (!(target instanceof HTMLSelectElement)) return { ok: false, error: "Target is not a select element." };
        target.value = action.value;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      if (action.type === "check") {
        if (!("checked" in target)) return { ok: false, error: "Target is not checkable." };
        target.checked = Boolean(action.checked);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      return { ok: false, error: "Unsupported CDP action type: " + action.type };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  })()`;
}

function escapeForNewFunction(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(/\n/g, "\\n");
}
