const DEFAULT_DAEMON_DOM_SNAPSHOT_URL = "http://127.0.0.1:4128/providers/dom/snapshot";
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

function collectDomSnapshot() {
  const selection = window.getSelection()?.toString() ?? "";
  const bodyText = document.body?.innerText ?? "";
  const interactiveText = Array.from(
    document.querySelectorAll("a, button, input, textarea, select, [role], [aria-label], [title]")
  )
    .slice(0, 160)
    .map((element) => {
      const label = [
        element.tagName.toLowerCase(),
        element.getAttribute("role"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.textContent?.trim()
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
    selection,
    text: [bodyText, interactiveText ? `Interactive elements:\n${interactiveText}` : ""]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 20_000)
  };
}
