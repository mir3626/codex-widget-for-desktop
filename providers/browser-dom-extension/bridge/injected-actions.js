export async function executeBrowserActionInPage(command) {
  const action = command?.action ?? {};
  const target = command?.target ?? action.target;

  try {
    if (action.type === "read") {
      return { ok: true, after: collectSnapshot() };
    }

    if (action.type === "evaluate") {
      const element = target ? resolveTarget(target) : null;
      const timeoutMs = Math.max(1, Math.min(Number(action.timeoutMs || 1000), 5000));
      const resultLimitBytes = Math.max(1, Math.min(Number(action.resultLimitBytes || 16384), 65536));
      const value = await Promise.race([
        Promise.resolve().then(async () => {
          const fn = new Function("target", "action", `"use strict"; return (async () => {\n${String(action.code ?? "")}\n})()`);
          return await fn(element, action);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Evaluate timed out.")), timeoutMs))
      ]);
      const resultPreview = JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item).slice(0, resultLimitBytes);
      return {
        ok: true,
        after: collectSnapshot(),
        metadata: {
          resultPreview,
          resultLimitBytes
        }
      };
    }

    if (action.type === "navigate") {
      if (!action.url) {
        throw new Error("Navigate action requires a URL.");
      }
      location.href = action.url;
      return { ok: true, after: collectSnapshot() };
    }

    if (action.type === "back") {
      history.back();
      return { ok: true, after: collectSnapshot(), metadata: { method: "history.back", fallbackPageNavigation: true } };
    }

    if (action.type === "forward") {
      history.forward();
      return { ok: true, after: collectSnapshot(), metadata: { method: "history.forward", fallbackPageNavigation: true } };
    }

    if (action.type === "reload") {
      location.reload();
      return { ok: true, after: collectSnapshot(), metadata: { method: "location.reload", fallbackPageNavigation: true } };
    }

    if (action.type === "scroll") {
      const element = resolveTarget(target) || (action.target ? resolveTarget(action.target) : null);
      const delta = readScrollDelta(action);
      if (element) {
        element.scrollBy(delta.x, delta.y);
      } else {
        window.scrollBy(delta.x, delta.y);
      }
      return { ok: true, after: collectSnapshot() };
    }

    const resolution = resolveTargetWithMethod(target);
    const element = resolution.element;
    if (!element) {
      throw new Error("Browser Action target element was not found.");
    }

    if (action.type === "click") {
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      return { ok: true, after: collectSnapshot(), metadata: { targetResolutionMethod: resolution.method } };
    }

    if (action.type === "type") {
      writeElementText(element, action.text ?? "", Boolean(action.clearFirst));
      if (action.submit) {
        const form = element.closest("form");
        if (form) {
          form.requestSubmit ? form.requestSubmit() : form.submit();
        } else {
          element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
        }
      }
      return { ok: true, after: collectSnapshot(), metadata: { targetResolutionMethod: resolution.method } };
    }

    if (action.type === "select") {
      if (!(element instanceof HTMLSelectElement)) {
        throw new Error("Select action target is not a select element.");
      }
      element.value = action.value ?? "";
      dispatchInputEvents(element);
      return { ok: true, after: collectSnapshot(), metadata: { targetResolutionMethod: resolution.method } };
    }

    if (action.type === "check") {
      if (!("checked" in element)) {
        throw new Error("Check action target is not checkable.");
      }
      element.checked = Boolean(action.checked);
      dispatchInputEvents(element);
      return { ok: true, after: collectSnapshot(), metadata: { targetResolutionMethod: resolution.method } };
    }

    throw new Error(`Unsupported Browser Action type: ${action.type}`);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      after: collectSnapshot()
    };
  }

  function resolveTarget(candidate) {
    return resolveTargetWithMethod(candidate).element;
  }

  function resolveTargetWithMethod(candidate) {
    if (!candidate) {
      return { element: null, method: "none" };
    }
    if (candidate.selector) {
      const selected = document.querySelector(candidate.selector);
      if (selected instanceof HTMLElement) {
        return { element: selected, method: "dom.querySelector" };
      }
    }
    if (candidate.kind === "selector" && candidate.selector) {
      const selected = document.querySelector(candidate.selector);
      if (selected instanceof HTMLElement) {
        return { element: selected, method: "dom.querySelector" };
      }
    }
    if (candidate.kind === "focused") {
      return { element: document.activeElement instanceof HTMLElement ? document.activeElement : null, method: "document.activeElement" };
    }
    if (candidate.kind === "bbox" && candidate.bbox) {
      const centerX = candidate.bbox.x + candidate.bbox.w / 2;
      const centerY = candidate.bbox.y + candidate.bbox.h / 2;
      const element = document.elementFromPoint(centerX, centerY);
      return { element: element instanceof HTMLElement ? element : null, method: "document.elementFromPoint" };
    }
    const text = candidate.kind === "text" ? candidate.text : candidate.text || candidate.label || candidate.ariaLabel;
    if (text) {
      const normalized = normalizeText(text).toLowerCase();
      const element = Array.from(document.querySelectorAll("a,button,input,textarea,select,[role],[aria-label],[title],[contenteditable='true'],[onclick],[tabindex]"))
        .find((element) => {
          const haystack = normalizeText([
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
            element.getAttribute("placeholder"),
            element.textContent,
            "value" in element ? element.value : ""
          ].filter(Boolean).join(" ")).toLowerCase();
          return haystack.includes(normalized);
        }) ?? null;
      return { element, method: "dom.textMatch" };
    }
    return { element: null, method: "none" };
  }

  function writeElementText(element, text, clearFirst) {
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (clearFirst) {
        element.value = "";
      }
      element.value = clearFirst ? text : `${element.value}${text}`;
      dispatchInputEvents(element);
      return;
    }
    if (element.isContentEditable) {
      if (clearFirst) {
        element.textContent = "";
      }
      element.textContent = clearFirst ? text : `${element.textContent ?? ""}${text}`;
      dispatchInputEvents(element);
      return;
    }
    throw new Error("Type action target is not editable.");
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function readScrollDelta(scrollAction) {
    const amount = scrollAction.amount;
    const pixels = typeof amount === "number"
      ? amount
      : amount === "small"
        ? 240
        : amount === "large"
          ? 960
          : 520;
    if (scrollAction.direction === "up") {
      return { x: 0, y: -pixels };
    }
    if (scrollAction.direction === "left") {
      return { x: -pixels, y: 0 };
    }
    if (scrollAction.direction === "right") {
      return { x: pixels, y: 0 };
    }
    return { x: 0, y: pixels };
  }

  function collectSnapshot() {
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
      elements: collectElements()
    };
  }

  function collectElements() {
    return Array.from(document.querySelectorAll("a[href],button,input,textarea,select,option,summary,label,[role],[aria-label],[title],[contenteditable='true'],[data-testid],[onclick],[tabindex]"))
      .filter((element) => element instanceof HTMLElement)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          id: `el-${index + 1}`,
          role: readBasicRole(element),
          tagName: element.tagName.toLowerCase(),
          label: normalizeText(element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || element.textContent || "").slice(0, 500) || undefined,
          text: normalizeText(element.innerText || element.textContent || "").slice(0, 500) || undefined,
          value: isSensitiveInput(element) ? undefined : readValue(element),
          selector: buildBasicSelector(element),
          bbox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          visible: rect.width > 0 && rect.height > 0,
          enabled: !element.matches(":disabled,[aria-disabled='true']"),
          editable: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element.isContentEditable,
          checked: "checked" in element ? Boolean(element.checked) : undefined,
          selected: "selected" in element ? Boolean(element.selected) : undefined,
          href: element instanceof HTMLAnchorElement ? element.href || undefined : undefined,
          inputType: element instanceof HTMLInputElement ? element.type.toLowerCase() : undefined,
          confidence: 0.8,
          riskHints: []
        };
      })
      .sort(compareSnapshotElements)
      .slice(0, 220);
  }

  function compareSnapshotElements(left, right) {
    const visibleDelta = Number(Boolean(right.visible)) - Number(Boolean(left.visible));
    if (visibleDelta !== 0) {
      return visibleDelta;
    }
    const leftInteractive = isActionableSnapshotElement(left);
    const rightInteractive = isActionableSnapshotElement(right);
    const interactiveDelta = Number(rightInteractive) - Number(leftInteractive);
    if (interactiveDelta !== 0) {
      return interactiveDelta;
    }
    const leftY = Number(left.bbox?.y ?? 0);
    const rightY = Number(right.bbox?.y ?? 0);
    return leftY - rightY;
  }

  function isActionableSnapshotElement(element) {
    const role = String(element.role ?? "").toLowerCase();
    const tagName = String(element.tagName ?? "").toLowerCase();
    return Boolean(element.href) ||
      Boolean(element.editable) ||
      ["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "option", "menuitem", "tab", "switch"].includes(role) ||
      ["a", "button", "input", "textarea", "select", "option", "summary", "label"].includes(tagName);
  }

  function readValue(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return normalizeText(element.value).slice(0, 500) || undefined;
    }
    return undefined;
  }

  function readBasicRole(element) {
    const explicit = element.getAttribute("role");
    if (explicit) {
      return explicit;
    }
    const tagName = element.tagName.toLowerCase();
    if (tagName === "a" || element instanceof HTMLAnchorElement) {
      return "link";
    }
    if (tagName === "button" || tagName === "summary" || element.getAttribute("onclick") || element.hasAttribute("tabindex")) {
      return "button";
    }
    if (tagName === "textarea") {
      return "textbox";
    }
    if (tagName === "select") {
      return "combobox";
    }
    if (tagName === "input") {
      const type = element.getAttribute("type")?.toLowerCase() || "text";
      if (type === "checkbox") {
        return "checkbox";
      }
      if (type === "radio") {
        return "radio";
      }
      if (["button", "submit", "reset"].includes(type)) {
        return "button";
      }
      return "textbox";
    }
    return undefined;
  }

  function isSensitiveInput(element) {
    return element instanceof HTMLInputElement && element.type.toLowerCase() === "password";
  }

  function buildBasicSelector(element) {
    if (element.id) {
      return `#${element.id.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
    }
    const testId = element.getAttribute("data-testid");
    if (testId) {
      return `${element.tagName.toLowerCase()}[data-testid="${String(testId).replace(/"/g, "\\\"")}"]`;
    }
    const aria = element.getAttribute("aria-label");
    if (aria) {
      return `${element.tagName.toLowerCase()}[aria-label="${String(aria).replace(/"/g, "\\\"")}"]`;
    }
    return element.tagName.toLowerCase();
  }

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }
}
