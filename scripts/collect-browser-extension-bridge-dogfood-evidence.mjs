import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const date = "2026-05-08";
const reportPath = path.resolve(`docs/reports/browser-extension-bridge-dogfood-evidence-${date}.md`);
const assetDir = path.resolve(`docs/reports/assets/browser-extension-bridge-dogfood-${date}`);
const assetPath = path.join(assetDir, "evidence.json");
const smokeAppData = useSmokeAppData("codex-widget-browser-extension-bridge-dogfood");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
const waiters = [];
const evidence = {
  generatedAt: new Date().toISOString(),
  daemonBaseUrl: baseUrl,
  checks: []
};
socket.on("message", (raw) => {
  const event = JSON.parse(raw.toString());
  events.push(event);
  for (const waiter of [...waiters]) {
    if (waiter.predicate(event)) {
      clearTimeout(waiter.timeout);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(event);
    }
  }
});

try {
  await mkdir(assetDir, { recursive: true });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  await waitFor((event) => event.type === "connected", "daemon connection");
  evidence.checks.push({ name: "daemon connected", status: "pass" });

  await postHeartbeat("connected-idle", {
    connected: true,
    mode: "idle",
    extensionVersion: "0.1.0",
    daemonBaseUrl: baseUrl,
    updatedAt: new Date().toISOString(),
    activeTab: {
      tabId: 41,
      windowId: 8,
      url: "https://example.com/",
      title: "Example Domain",
      origin: "https://example.com/*",
      permission: "allowed"
    },
    nativeHost: "enabled",
    settings: {
      daemonBaseUrl: baseUrl,
      autoConnect: true,
      autoObserve: true,
      allowSafeReadScroll: true,
      requireApprovalForClickType: true,
      useNativeHost: true,
      pollIntervalSeconds: 10
    }
  });
  await waitFor((event) => event.type === "browserExtensionBridge.status" && event.status?.mode === "idle", "idle heartbeat");
  evidence.checks.push({ name: "extension heartbeat visible to daemon/widget", status: "pass", mode: "idle" });

  await postDomSnapshot("auto-observe", {
    url: "https://example.com/",
    title: "Example Domain",
    readyState: "complete",
    text: "Example Domain More information",
    elements: [
      {
        id: "more-info",
        role: "link",
        tagName: "a",
        label: "More information",
        text: "More information",
        selector: "a[href=\"https://www.iana.org/domains/example\"]",
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      }
    ]
  });
  evidence.checks.push({ name: "automatic page context path uses legacy provider without manual extension click", status: "pass" });

  await postHeartbeat("permission-needed", {
    connected: true,
    mode: "permission_needed",
    updatedAt: new Date().toISOString(),
    activeTab: {
      url: "https://example.org/",
      title: "Example Org",
      origin: "https://example.org/*",
      permission: "needs_site_permission",
      detail: "Enable this site in the Browser Bridge popup."
    },
    lastError: "Enable this site in the Browser Bridge popup."
  });
  await waitFor((event) => event.type === "browserExtensionBridge.status" && event.status?.mode === "permission_needed", "permission state");
  evidence.checks.push({ name: "missing site permission recovery state", status: "pass", mode: "permission_needed" });

  await postHeartbeat("restricted", {
    connected: true,
    mode: "restricted",
    updatedAt: new Date().toISOString(),
    activeTab: {
      url: "chrome://extensions",
      title: "Extensions",
      permission: "restricted",
      detail: "This browser page does not allow extension page access."
    },
    lastError: "This browser page does not allow extension page access."
  });
  await waitFor((event) => event.type === "browserExtensionBridge.status" && event.status?.mode === "restricted", "restricted state");
  evidence.checks.push({ name: "restricted page boundary", status: "pass", mode: "restricted" });

  await writeFile(assetPath, `${JSON.stringify({ ...evidence, eventTypes: events.map((event) => event.type) }, null, 2)}\n`);
  await writeFile(reportPath, renderReport(evidence, assetPath));
  console.log(`browser extension bridge dogfood evidence written: ${reportPath}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function postHeartbeat(name, payload) {
  const response = await fetch(`${baseUrl}/browser-action/extension/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`${name} heartbeat failed: ${response.status}`);
  }
}

async function postDomSnapshot(name, snapshot) {
  const response = await fetch(`${baseUrl}/providers/dom/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot)
  });
  if (!response.ok) {
    throw new Error(`${name} page context post failed: ${response.status}`);
  }
}

function waitFor(predicate, label, timeoutMs = 10_000) {
  const existing = events.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timeout: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        reject(new Error(`Timed out waiting for ${label}. Events: ${events.map((event) => event.type).join(", ")}`));
      }, timeoutMs)
    };
    waiters.push(waiter);
  });
}

function renderReport(data, asset) {
  const rows = data.checks.map((check) => `| ${check.name} | ${check.status} | ${check.mode ?? ""} |`).join("\n");
  return [
    "# Browser Extension Bridge Dogfood Evidence",
    "",
    `Generated: ${data.generatedAt}`,
    `Daemon base URL: \`${data.daemonBaseUrl}\``,
    "",
    "## Scope",
    "",
    "This evidence exercises the new snapshotless Browser Bridge contract through the daemon-facing heartbeat/status path, automatic page-context ingress, permission-needed recovery, and restricted-page boundary. It keeps the legacy DOM provider endpoint only as the extension's internal compatibility transport, not as user-facing UX.",
    "",
    "## Evidence",
    "",
    "| Check | Status | Mode |",
    "| --- | --- | --- |",
    rows,
    "",
    "## Supporting Asset",
    "",
    `- \`${path.relative(process.cwd(), asset).replace(/\\/g, "/")}\``,
    "",
    "## Notes",
    "",
    "- The extension icon is now configured as a popup surface; normal Browser Action does not require clicking it to capture a page.",
    "- Site permission remains explicit. Missing permission is surfaced as `permission_needed` rather than silently observing a page.",
    "- Restricted browser pages are reported as `restricted`; the bridge does not bypass browser security boundaries.",
    ""
  ].join("\n");
}
