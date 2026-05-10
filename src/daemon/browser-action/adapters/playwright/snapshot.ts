import type { Page } from "./runtime.js";

export async function collectPlaywrightSnapshot(page: Page): Promise<Record<string, unknown>> {
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
