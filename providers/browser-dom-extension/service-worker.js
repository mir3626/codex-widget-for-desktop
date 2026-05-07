const DEFAULT_DAEMON_DOM_SNAPSHOT_URL = "http://127.0.0.1:4128/providers/dom/snapshot";
const DEFAULT_BROWSER_ACTION_POLL_PATH = "/browser-action/extension/poll";
const DEFAULT_BROWSER_ACTION_RESULT_PATH = "/browser-action/extension/result";
const NATIVE_HOST_NAME = "com.mir3626.codex_widget_dom";
const BADGE_RESET_MS = 1600;

chrome.action.onClicked.addListener((tab) => {
  void sendActiveTabSnapshot(tab);
});

async function sendActiveTabSnapshot(tab) {
  if (!tab.id) {
    return;
  }

  try {
    setBadge(tab.id, "...", "#64748b");
    const snapshot = await readSnapshotFromTab(tab.id);
    const daemonUrl = await readDaemonSnapshotUrl();
    const nativeResult = await trySendNativeSnapshot(snapshot, daemonUrl);
    if (!nativeResult.ok) {
      await postSnapshotToDaemon(snapshot, daemonUrl);
    }
    await pollAndExecuteBrowserAction(tab, daemonUrl);
    setBadge(tab.id, "OK", "#0f766e");
  } catch (error) {
    console.error("[Codex Widget] DOM snapshot failed", error);
    setBadge(tab.id, "ERR", "#b91c1c");
  }
}

async function trySendNativeSnapshot(snapshot, daemonUrl) {
  try {
    const response = await sendNativeMessage({
      type: "domSnapshot",
      daemonUrl,
      snapshot
    });
    if (response?.ok === true) {
      return { ok: true };
    }
    return { ok: false, error: response?.error ?? "Native host did not accept the snapshot." };
  } catch (error) {
    console.debug("[Codex Widget] Native messaging unavailable; falling back to HTTP.", error);
    return { ok: false, error };
  }
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

async function postSnapshotToDaemon(snapshot, daemonUrl) {
  const response = await fetch(daemonUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot)
  });

  if (!response.ok) {
    throw new Error(`Daemon rejected DOM snapshot (${response.status}).`);
  }
}

async function pollAndExecuteBrowserAction(tab, daemonUrl) {
  if (!tab.id) {
    return;
  }

  const pollUrl = resolveDaemonActionUrl(daemonUrl, DEFAULT_BROWSER_ACTION_POLL_PATH);
  const resultUrl = resolveDaemonActionUrl(daemonUrl, DEFAULT_BROWSER_ACTION_RESULT_PATH);
  const response = await fetch(pollUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Browser Action poll failed (${response.status}).`);
  }

  const payload = await response.json();
  const command = payload?.command;
  if (!command?.requestId || !command?.action) {
    return;
  }

  const before = await readSnapshotFromTab(tab.id);
  const result = await executeBrowserActionCommand(tab, command);
  const after = result.after ?? await safeReadSnapshotFromTab(tab.id);
  const post = await fetch(resultUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: command.requestId,
      ok: result.ok,
      before,
      after,
      error: result.error,
      metadata: result.metadata
    })
  });
  if (!post.ok) {
    throw new Error(`Browser Action result post failed (${post.status}).`);
  }
}

async function executeBrowserActionCommand(tab, command) {
  try {
    if (command.action?.type === "screenshot") {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const after = await safeReadSnapshotFromTab(tab.id);
      if (after) {
        after.screenshot = { dataUrl, title: "Visible tab screenshot" };
      }
      return { ok: true, after };
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: executeBrowserActionInPage,
      args: [command]
    });

    if (!injection?.result) {
      return { ok: false, error: "No Browser Action execution result was returned." };
    }
    return injection.result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      after: await safeReadSnapshotFromTab(tab.id)
    };
  }
}

async function safeReadSnapshotFromTab(tabId) {
  try {
    return await readSnapshotFromTab(tabId);
  } catch {
    return null;
  }
}

async function readSnapshotFromTab(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectDomSnapshot
  });

  if (!injection?.result) {
    throw new Error("No DOM snapshot was returned from the active tab.");
  }
  return injection.result;
}

function setBadge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });

  if (text !== "...") {
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: "" });
    }, BADGE_RESET_MS);
  }
}

async function readDaemonSnapshotUrl() {
  const stored = await readStorage({ daemonUrl: DEFAULT_DAEMON_DOM_SNAPSHOT_URL });
  return normalizeDaemonSnapshotUrl(stored.daemonUrl);
}

function readStorage(defaults) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaults, resolve);
  });
}

function normalizeDaemonSnapshotUrl(value) {
  if (typeof value !== "string") {
    return DEFAULT_DAEMON_DOM_SNAPSHOT_URL;
  }

  try {
    const url = new URL(value.trim());
    const isLocalHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const isHttp = url.protocol === "http:";
    if (isLocalHost && isHttp && url.pathname === "/providers/dom/snapshot") {
      return url.toString();
    }
  } catch {
    // Fall through to the safe local default.
  }

  return DEFAULT_DAEMON_DOM_SNAPSHOT_URL;
}

function resolveDaemonActionUrl(snapshotUrl, pathname) {
  try {
    const url = new URL(snapshotUrl);
    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    const fallback = new URL(DEFAULT_DAEMON_DOM_SNAPSHOT_URL);
    fallback.pathname = pathname;
    return fallback.toString();
  }
}

function collectDomSnapshot() {
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
      "[data-testid]"
    ].join(",");
    return Array.from(document.querySelectorAll(selector))
      .filter((element) => element instanceof HTMLElement)
      .map((element, index) => serializeElement(element, index))
      .filter((element) => element.visible || Boolean(element.label || element.text || element.selector))
      .slice(0, limit);
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

async function executeBrowserActionInPage(command) {
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
      return { ok: true, after: collectSnapshot() };
    }

    if (action.type === "forward") {
      history.forward();
      return { ok: true, after: collectSnapshot() };
    }

    if (action.type === "reload") {
      location.reload();
      return { ok: true, after: collectSnapshot() };
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

    const element = resolveTarget(target);
    if (!element) {
      throw new Error("Browser Action target element was not found.");
    }

    if (action.type === "click") {
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      return { ok: true, after: collectSnapshot() };
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
      return { ok: true, after: collectSnapshot() };
    }

    if (action.type === "select") {
      if (!(element instanceof HTMLSelectElement)) {
        throw new Error("Select action target is not a select element.");
      }
      element.value = action.value ?? "";
      dispatchInputEvents(element);
      return { ok: true, after: collectSnapshot() };
    }

    if (action.type === "check") {
      if (!("checked" in element)) {
        throw new Error("Check action target is not checkable.");
      }
      element.checked = Boolean(action.checked);
      dispatchInputEvents(element);
      return { ok: true, after: collectSnapshot() };
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
    if (!candidate) {
      return null;
    }
    if (candidate.selector) {
      const selected = document.querySelector(candidate.selector);
      if (selected instanceof HTMLElement) {
        return selected;
      }
    }
    if (candidate.kind === "selector" && candidate.selector) {
      const selected = document.querySelector(candidate.selector);
      if (selected instanceof HTMLElement) {
        return selected;
      }
    }
    if (candidate.kind === "focused") {
      return document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (candidate.kind === "bbox" && candidate.bbox) {
      const centerX = candidate.bbox.x + candidate.bbox.w / 2;
      const centerY = candidate.bbox.y + candidate.bbox.h / 2;
      return document.elementFromPoint(centerX, centerY);
    }
    const text = candidate.kind === "text" ? candidate.text : candidate.text || candidate.label || candidate.ariaLabel;
    if (text) {
      const normalized = normalizeText(text).toLowerCase();
      return Array.from(document.querySelectorAll("a,button,input,textarea,select,[role],[aria-label],[title],[contenteditable='true']"))
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
    }
    return null;
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
    return Array.from(document.querySelectorAll("a[href],button,input,textarea,select,option,summary,label,[role],[aria-label],[title],[contenteditable='true'],[data-testid]"))
      .filter((element) => element instanceof HTMLElement)
      .slice(0, 220)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          id: `el-${index + 1}`,
          role: element.getAttribute("role") || undefined,
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
      });
  }

  function readValue(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return normalizeText(element.value).slice(0, 500) || undefined;
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
