export function collectSnapshotExpression(): string {
  return `(() => {
    const elements = Array.from(document.querySelectorAll("a[href],button,input,textarea,select,option,summary,label,[role],[aria-label],[title],[contenteditable='true'],[data-testid]"))
      .filter((element) => element instanceof HTMLElement)
      .slice(0, 220)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const input = element instanceof HTMLInputElement ? element : undefined;
        const selector = element.id ? "#" + CSS.escape(element.id) : element.getAttribute("data-testid") ? element.tagName.toLowerCase() + "[data-testid=\\"" + element.getAttribute("data-testid").replace(/"/g, "\\\\\\"") + "\\"]" : element.tagName.toLowerCase();
        return {
          id: element.id || element.getAttribute("data-testid") || "el-" + (index + 1),
          role: element.getAttribute("role") || undefined,
          tagName: element.tagName.toLowerCase(),
          label: String(element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 500) || undefined,
          text: String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 500) || undefined,
          value: input && !/password|hidden|token|secret|card|cc/.test(input.type.toLowerCase()) ? String(input.value || "").slice(0, 500) : undefined,
          selector,
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
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio, scrollX: window.scrollX, scrollY: window.scrollY },
      focusedElementId: undefined,
      selection: window.getSelection() ? window.getSelection().toString() : "",
      text: String(document.body && document.body.innerText || "").slice(0, 20000),
      elements
    };
  })()`;
}
