const DAEMON_DOM_SNAPSHOT_URL = "http://127.0.0.1:4128/providers/dom/snapshot";
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
    const response = await fetch(DAEMON_DOM_SNAPSHOT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot)
    });

    if (!response.ok) {
      throw new Error(`Daemon rejected DOM snapshot (${response.status}).`);
    }
    setBadge(tab.id, "OK", "#0f766e");
  } catch (error) {
    console.error("[Codex Widget] DOM snapshot failed", error);
    setBadge(tab.id, "ERR", "#b91c1c");
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
