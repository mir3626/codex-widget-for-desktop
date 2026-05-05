const DEFAULT_DAEMON_DOM_SNAPSHOT_URL = "http://127.0.0.1:4128/providers/dom/snapshot";

const input = document.querySelector("#daemon-url");
const saveButton = document.querySelector("#save");
const resetButton = document.querySelector("#reset");
const status = document.querySelector("#status");

void loadOptions();

saveButton.addEventListener("click", () => {
  void saveOptions();
});

resetButton.addEventListener("click", () => {
  input.value = DEFAULT_DAEMON_DOM_SNAPSHOT_URL;
  void saveOptions("Default URL restored.");
});

async function loadOptions() {
  const stored = await readStorage({ daemonUrl: DEFAULT_DAEMON_DOM_SNAPSHOT_URL });
  input.value = normalizeDaemonSnapshotUrl(stored.daemonUrl);
}

async function saveOptions(message = "Saved.") {
  const normalized = normalizeDaemonSnapshotUrl(input.value);
  if (normalized !== input.value.trim()) {
    setStatus("Use a local HTTP URL ending in /providers/dom/snapshot.");
    input.value = normalized;
    return;
  }

  await writeStorage({ daemonUrl: normalized });
  setStatus(message);
}

function readStorage(defaults) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaults, resolve);
  });
}

function writeStorage(values) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(values, resolve);
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

function setStatus(message) {
  status.textContent = message;
}
