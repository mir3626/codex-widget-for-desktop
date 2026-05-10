export function collectDomSnapshot() {
  const MAX_ELEMENTS = 220;
  const MAX_TEXT = 20_000;

  const selection = window.getSelection()?.toString() ?? "";
  const bodyText = document.body?.innerText ?? "";
  const elements = collectInteractiveElements(MAX_ELEMENTS);
  const interactiveText = elements
    .slice(0, 160)
    .map((element) => {
      const label = [
        element.tagName,
        element.role,
        element.label,
        element.title,
        element.text
      ]
        .filter(Boolean)
        .join(" | ");
      return label.slice(0, 500);
    })
    .filter(Boolean)
    .join("\n");

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
    focusedElementId: readStableElementId(document.activeElement, -1),
    selection,
    text: [bodyText, interactiveText ? `Interactive elements:\n${interactiveText}` : ""]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, MAX_TEXT),
    elements
  };

  function collectInteractiveElements(limit) {
    const selector = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "option",
      "summary",
      "label",
      "[role]",
      "[aria-label]",
      "[title]",
      "[contenteditable='true']",
      "[data-testid]",
      "[onclick]",
      "[tabindex]"
    ].join(",");
    return Array.from(document.querySelectorAll(selector))
      .filter((element) => element instanceof HTMLElement)
      .map((element, index) => serializeElement(element, index))
      .filter((element) => element.visible || Boolean(element.label || element.text || element.selector))
      .sort(compareSnapshotElements)
      .slice(0, limit);
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

  function serializeElement(element, index) {
    const bbox = readRect(element);
    const role = readRole(element);
    const inputType = element instanceof HTMLInputElement ? element.type.toLowerCase() : undefined;
    const sensitive = isSensitiveInput(element);
    const label = readElementLabel(element);
    const text = readElementText(element);
    const value = sensitive ? undefined : readElementValue(element);
    const selector = buildSelector(element);
    return {
      id: readStableElementId(element, index),
      role,
      tagName: element.tagName.toLowerCase(),
      label,
      text,
      value,
      placeholder: "placeholder" in element ? element.placeholder || undefined : undefined,
      ariaLabel: element.getAttribute("aria-label") || undefined,
      title: element.getAttribute("title") || undefined,
      selector,
      bbox,
      visible: isVisible(element, bbox),
      enabled: !element.matches(":disabled,[aria-disabled='true']"),
      editable: isEditable(element),
      checked: "checked" in element ? Boolean(element.checked) : undefined,
      selected: "selected" in element ? Boolean(element.selected) : undefined,
      href: element instanceof HTMLAnchorElement ? element.href || undefined : undefined,
      inputType,
      confidence: selector ? 0.95 : 0.7,
      riskHints: readRiskHints(element, label, text, inputType)
    };
  }

  function readStableElementId(element, index) {
    if (!(element instanceof HTMLElement)) {
      return undefined;
    }
    const seed = [
      buildSelector(element),
      readRole(element),
      element.tagName.toLowerCase(),
      readElementLabel(element),
      readElementText(element),
      element.getAttribute("href"),
      index >= 0 ? String(index) : "focused"
    ]
      .filter(Boolean)
      .join("|");
    return `el-${hashString(seed).slice(0, 12)}`;
  }

  function readRole(element) {
    const explicit = element.getAttribute("role");
    if (explicit) {
      return explicit;
    }
    const tag = element.tagName.toLowerCase();
    if (tag === "a" && element.getAttribute("href")) {
      return "link";
    }
    if (tag === "button" || tag === "summary") {
      return "button";
    }
    if (tag === "textarea") {
      return "textbox";
    }
    if (tag === "select") {
      return "combobox";
    }
    if (tag === "option") {
      return "option";
    }
    if (tag === "input") {
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
    if (element.getAttribute("onclick") || element.hasAttribute("tabindex")) {
      return "button";
    }
    return undefined;
  }

  function readElementLabel(element) {
    const aria = element.getAttribute("aria-label");
    if (aria) {
      return normalizeText(aria);
    }
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      if (text.trim()) {
        return normalizeText(text);
      }
    }
    if ("labels" in element && element.labels?.length) {
      const text = Array.from(element.labels).map((label) => label.textContent ?? "").join(" ");
      if (text.trim()) {
        return normalizeText(text);
      }
    }
    const title = element.getAttribute("title");
    if (title) {
      return normalizeText(title);
    }
    const placeholder = "placeholder" in element ? element.placeholder : "";
    if (placeholder) {
      return normalizeText(placeholder);
    }
    return readElementText(element);
  }

  function readElementText(element) {
    return normalizeText(element.innerText || element.textContent || "").slice(0, 500) || undefined;
  }

  function readElementValue(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return normalizeText(element.value).slice(0, 500) || undefined;
    }
    return undefined;
  }

  function isSensitiveInput(element) {
    if (!(element instanceof HTMLInputElement)) {
      return false;
    }
    const type = element.type.toLowerCase();
    const name = `${element.name} ${element.id} ${element.autocomplete}`.toLowerCase();
    return type === "password" || /password|token|secret|payment|card|cvv|cvc|otp|2fa/.test(name);
  }

  function isEditable(element) {
    return element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element.isContentEditable;
  }

  function readRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    };
  }

  function isVisible(element, bbox) {
    const style = window.getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0 &&
      bbox.w > 0 &&
      bbox.h > 0;
  }

  function readRiskHints(element, label, text, inputType) {
    const value = `${label ?? ""} ${text ?? ""} ${element.getAttribute("name") ?? ""} ${element.id ?? ""} ${inputType ?? ""}`.toLowerCase();
    const hints = new Set();
    if (/password|token|secret|otp|2fa|login|sign in|auth/.test(value)) {
      hints.add("auth");
    }
    if (/password|token|secret|otp|2fa/.test(value)) {
      hints.add("password");
    }
    if (/card|payment|pay|purchase|checkout|cvv|cvc|billing/.test(value)) {
      hints.add("payment");
    }
    if (/delete|remove|destroy|discard|erase/.test(value)) {
      hints.add("delete");
    }
    if (/submit|send|post|publish|share|save/.test(value) || inputType === "submit") {
      hints.add("submit");
    }
    if (inputType === "file" || /upload|attach file/.test(value)) {
      hints.add("file_upload");
    }
    if (/download|export/.test(value)) {
      hints.add("download");
    }
    return Array.from(hints);
  }

  function buildSelector(element) {
    if (!(element instanceof Element)) {
      return undefined;
    }
    if (element.id) {
      return `#${cssEscape(element.id)}`;
    }
    for (const attr of ["data-testid", "data-test", "aria-label", "name"]) {
      const value = element.getAttribute(attr);
      if (value) {
        return `${element.tagName.toLowerCase()}[${attr}="${escapeAttribute(value)}"]`;
      }
    }
    if (element instanceof HTMLAnchorElement && element.getAttribute("href")) {
      return `a[href="${escapeAttribute(element.getAttribute("href"))}"]`;
    }
    const path = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement && path.length < 5) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) {
        path.unshift(tag);
        break;
      }
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      const nth = sameTag.indexOf(current) + 1;
      path.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${nth})` : tag);
      current = parent;
    }
    return path.length ? path.join(" > ") : undefined;
  }

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function escapeAttribute(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}

export { executeBrowserActionInPage } from "./injected-actions.js";
