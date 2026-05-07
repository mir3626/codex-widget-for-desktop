import type { BrowserAction } from "./types.js";

export function inferBrowserActionFromText(text: string): BrowserAction | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  if (/스크롤|scroll/i.test(normalized)) {
    return { type: "scroll", direction: /up|위로/i.test(normalized) ? "up" : "down", amount: "medium" };
  }
  if (/새로고침|reload|refresh/i.test(normalized)) {
    return { type: "reload" };
  }
  if (/뒤로|back/i.test(normalized)) {
    return { type: "back" };
  }
  if (/앞으로|forward/i.test(normalized)) {
    return { type: "forward" };
  }
  return { type: "read", reason: normalized.slice(0, 240) };
}
