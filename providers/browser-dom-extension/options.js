const DEFAULT_DAEMON_BASE_URL = "http://127.0.0.1:4128";

const input = document.querySelector("#daemon-url");
const saveButton = document.querySelector("#save");
const resetButton = document.querySelector("#reset");
const status = document.querySelector("#status");

void loadOptions();

saveButton.addEventListener("click", () => {
  void saveOptions();
});

resetButton.addEventListener("click", () => {
  input.value = DEFAULT_DAEMON_BASE_URL;
  void saveOptions("Default URL restored.");
});

async function loadOptions() {
  const stored = await readStorage({ daemonBaseUrl: DEFAULT_DAEMON_BASE_URL, daemonUrl: DEFAULT_DAEMON_BASE_URL });
  input.value = normalizeDaemonBaseUrl(stored.daemonBaseUrl ?? stored.daemonUrl);
}

async function saveOptions(message = "Saved.") {
  const normalized = normalizeDaemonBaseUrl(input.value);
  if (normalized !== input.value.trim()) {
    setStatus("Saved normalized local daemon base URL.");
    input.value = normalized;
  }

  await writeStorage({ daemonBaseUrl: normalized, daemonUrl: `${normalized}/providers/dom/snapshot` });
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

function normalizeDaemonBaseUrl(value) {
  if (typeof value !== "string") {
    return DEFAULT_DAEMON_BASE_URL;
  }

  try {
    const url = new URL(value.trim());
    const isLocalHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const isHttp = url.protocol === "http:";
    if (isLocalHost && isHttp) {
      url.pathname = "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // Fall through to the safe local default.
  }

  return DEFAULT_DAEMON_BASE_URL;
}

function setStatus(message) {
  status.textContent = message;
}
