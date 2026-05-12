import WebSocket from "ws";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const evidenceDate = process.env.WINDOWS_COMPUTER_USE_DOGFOOD_DATE || new Date().toISOString().slice(0, 10);
const reportPath = join("docs", "reports", `windows-computer-use-high-risk-dogfood-${evidenceDate}.md`);
const assetDir = join("docs", "reports", "assets", `windows-computer-use-high-risk-dogfood-${evidenceDate}`);
const jsonPath = join(assetDir, "evidence.json");

await mkdir(assetDir, { recursive: true });

const smokeAppData = useSmokeAppData("codex-widget-windows-computer-use-dogfood");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
const waiters = [];

try {
  await waitForSocketOpen(socket);
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

  const scenarios = [];
  scenarios.push(await runWindowsThemeReadScenario());
  scenarios.push(await runBrowserBookmarkCrudScenario());
  scenarios.push(await runTerminalCredentialBlockScenario());

  const evidence = {
    date: evidenceDate,
    daemonPort: daemon.port,
    matrix: "docs/plans/windows-computer-use-high-risk-dogfood-matrix.md",
    scenarios,
    acceptance: {
      safeBaselineOnly: true,
      realWindowsSettingMutation: false,
      allExecutedScenariosPassed: scenarios.every((scenario) => scenario.status === "passed" || scenario.status === "skipped"),
      capabilityDetailsCaptured: scenarios.flatMap((scenario) => scenario.capabilityJobs ?? []).length > 0,
      credentialLikeTerminalBlockedBeforePersistence: scenarios.some((scenario) => scenario.id === "terminal.credential.blocked" && scenario.status === "passed")
    }
  };

  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderReport(evidence), "utf8");
  console.log(`windows computer-use dogfood evidence written: ${reportPath}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function runWindowsThemeReadScenario() {
  const scenario = {
    id: "settings.theme.read",
    surface: "Windows Settings",
    risk: "read_only",
    status: "skipped",
    notes: [],
    capabilityJobs: []
  };
  if (process.platform !== "win32") {
    scenario.notes.push("Skipped because this scenario is Windows-only.");
    return scenario;
  }

  const personalizeKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
  const command = `reg query ${personalizeKey}`;
  const jobId = `dogfood-settings-theme-read-${Date.now()}`;
  send({
    type: "capability.start",
    requestId: `${jobId}-start`,
    job: {
      id: jobId,
      kind: "terminal",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { command },
      timeoutMs: 15_000
    }
  });
  await waitFor((event) => event.type === "capability.job" && event.jobId === jobId && event.status === "awaiting_approval", "theme read awaiting approval");
  send({ type: "capability.approve", requestId: `${jobId}-approve`, jobId });
  await waitFor((event) => event.type === "capability.job" && event.jobId === jobId && event.status === "completed", "theme read completed", 20_000);
  const detail = await fetchCapabilityJob(jobId);
  const stdout = String(detail.job?.outputJson?.stdout ?? "").trim();
  scenario.status = stdout ? "passed" : "failed";
  scenario.theme = parseRegistryTheme(stdout);
  scenario.capabilityJobs.push(compactCapabilityDetail(detail));
  scenario.notes.push("Read current theme state only; no Windows setting was changed.");
  return scenario;
}

async function runBrowserBookmarkCrudScenario() {
  const scenario = {
    id: "browser.bookmark.crud",
    surface: "Browser Chrome",
    risk: "reversible_side_effect",
    status: "failed",
    notes: ["Uses simulated Browser Bridge command/result exchange against the daemon command bridge."],
    capabilityJobs: [],
    transcript: []
  };
  const bookmark = {
    id: `dogfood-bookmark-${Date.now()}`,
    title: "Codex Capability Dogfood",
    updatedTitle: "Codex Capability Dogfood Updated",
    url: "https://example.test/codex-capability-dogfood",
    updatedUrl: "https://example.test/codex-capability-dogfood-updated"
  };

  await runBrowserChromeStep({
    scenario,
    jobId: "dogfood-browser-bookmark-list",
    requestId: "dogfood-browser-bookmark-list",
    input: { command: "bookmark.list" },
    expectedCommand: "bookmark.list",
    output: { tree: [{ id: "0", title: "Bookmarks", children: [] }] },
    metadata: { verification: "bookmark_tree_read", mode: "dogfood_simulated_bridge" },
    approval: false
  });
  await runBrowserChromeStep({
    scenario,
    jobId: "dogfood-browser-bookmark-create",
    requestId: "dogfood-browser-bookmark-create",
    input: { command: "bookmark.create", title: bookmark.title, url: bookmark.url },
    expectedCommand: "bookmark.create",
    output: { bookmark: { id: bookmark.id, title: bookmark.title, url: bookmark.url } },
    metadata: { verification: "bookmark_created", bookmarkId: bookmark.id, mode: "dogfood_simulated_bridge" },
    approval: true
  });
  await runBrowserChromeStep({
    scenario,
    jobId: "dogfood-browser-bookmark-update",
    requestId: "dogfood-browser-bookmark-update",
    input: { command: "bookmark.update", id: bookmark.id, title: bookmark.updatedTitle, url: bookmark.updatedUrl },
    expectedCommand: "bookmark.update",
    output: { bookmark: { id: bookmark.id, title: bookmark.updatedTitle, url: bookmark.updatedUrl } },
    metadata: { verification: "bookmark_updated", bookmarkId: bookmark.id, mode: "dogfood_simulated_bridge" },
    approval: true
  });
  await runBrowserChromeStep({
    scenario,
    jobId: "dogfood-browser-bookmark-open",
    requestId: "dogfood-browser-bookmark-open",
    input: { command: "bookmark.open", id: bookmark.id },
    expectedCommand: "bookmark.open",
    output: { bookmark: { id: bookmark.id, title: bookmark.updatedTitle, url: bookmark.updatedUrl }, tab: { id: 1, windowId: 1, url: bookmark.updatedUrl } },
    metadata: { verification: "bookmark_opened", bookmarkId: bookmark.id, mode: "dogfood_simulated_bridge" },
    approval: true
  });
  await runBrowserChromeStep({
    scenario,
    jobId: "dogfood-browser-bookmark-remove",
    requestId: "dogfood-browser-bookmark-remove",
    input: { command: "bookmark.remove", id: bookmark.id },
    expectedCommand: "bookmark.remove",
    output: { removed: true, id: bookmark.id },
    metadata: { verification: "bookmark_removed", bookmarkId: bookmark.id, mode: "dogfood_simulated_bridge" },
    approval: true
  });

  scenario.status = scenario.capabilityJobs.every((job) => job.status === "completed") ? "passed" : "failed";
  scenario.rollback = { removedBookmarkId: bookmark.id };
  return scenario;
}

async function runTerminalCredentialBlockScenario() {
  const jobId = `dogfood-terminal-credential-block-${Date.now()}`;
  const requestId = `${jobId}-start`;
  send({
    type: "capability.start",
    requestId,
    job: {
      id: jobId,
      kind: "terminal",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { command: "echo token=abc123" },
      timeoutMs: 10_000
    }
  });
  const error = await waitFor((event) => event.type === "error" && event.id === requestId, "credential terminal block");
  const jobs = await fetchCapabilityJobs();
  const persisted = jobs.jobs.some((job) => job.id === jobId);
  return {
    id: "terminal.credential.blocked",
    surface: "Terminal",
    risk: "credential_sensitive",
    status: !persisted && /credential-like/.test(error.message) ? "passed" : "failed",
    blockedMessage: error.message,
    persisted,
    notes: ["Credential-like terminal command should be rejected before capability job persistence."]
  };
}

async function runBrowserChromeStep(input) {
  send({
    type: "capability.start",
    requestId: input.requestId,
    job: {
      id: input.jobId,
      kind: "browser_chrome",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: input.input,
      timeoutMs: 12_000
    }
  });

  if (input.approval) {
    await waitFor((event) => event.type === "capability.job" && event.jobId === input.jobId && event.status === "awaiting_approval", `${input.jobId} awaiting approval`);
    send({ type: "capability.approve", requestId: `${input.requestId}-approve`, jobId: input.jobId });
  }
  await waitFor((event) => event.type === "capability.job" && event.jobId === input.jobId && event.status === "running", `${input.jobId} running`);
  const command = await pollBrowserBridgeCommand();
  assertEqual(command?.command, input.expectedCommand, `${input.jobId} command`);
  await postBrowserChromeResult(command.requestId, input.output, input.metadata);
  await waitFor((event) => event.type === "capability.job" && event.jobId === input.jobId && event.status === "completed", `${input.jobId} completed`);
  const detail = await fetchCapabilityJob(input.jobId);
  input.scenario.capabilityJobs.push(compactCapabilityDetail(detail));
  input.scenario.transcript.push({
    jobId: input.jobId,
    command: input.expectedCommand,
    approvalRequired: input.approval,
    verification: detail.job?.outputJson?.capabilityVerification?.status,
    outputVerification: detail.job?.outputJson?.output?.metadata?.verification
  });
}

async function pollBrowserBridgeCommand() {
  const url = new URL(`${baseUrl}/browser-action/extension/poll`);
  url.searchParams.set("permission", "allowed");
  url.searchParams.set("tabId", "1");
  url.searchParams.set("windowId", "1");
  url.searchParams.set("url", "https://example.test/");
  url.searchParams.set("title", "Dogfood Fixture");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Browser bridge poll failed (${response.status}).`);
  }
  const payload = await response.json();
  if (!payload.command) {
    throw new Error("Browser bridge poll returned no command.");
  }
  return payload.command;
}

async function postBrowserChromeResult(requestId, output, metadata) {
  const response = await fetch(`${baseUrl}/browser-action/extension/browser-chrome-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, ok: true, output, metadata })
  });
  if (!response.ok) {
    throw new Error(`Browser Chrome result POST failed (${response.status}).`);
  }
}

async function fetchCapabilityJob(jobId) {
  const response = await fetch(`${baseUrl}/capabilities/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    throw new Error(`Capability job GET failed (${response.status}).`);
  }
  return await response.json();
}

async function fetchCapabilityJobs() {
  const response = await fetch(`${baseUrl}/capabilities/jobs?limit=100`);
  if (!response.ok) {
    throw new Error(`Capability jobs GET failed (${response.status}).`);
  }
  return await response.json();
}

function compactCapabilityDetail(detail) {
  return {
    id: detail.job?.id,
    kind: detail.job?.kind,
    status: detail.job?.status,
    priority: detail.job?.priority,
    requestedBy: detail.job?.requestedBy,
    verification: detail.job?.outputJson?.capabilityVerification,
    diagnostics: detail.diagnostics,
    resources: Array.isArray(detail.resources) ? detail.resources.length : 0,
    locks: Array.isArray(detail.locks) ? detail.locks.length : 0,
    lastError: detail.job?.lastError
  };
}

function send(message) {
  socket.send(JSON.stringify(message));
}

function waitForSocketOpen(target) {
  return new Promise((resolve, reject) => {
    target.once("open", resolve);
    target.once("error", reject);
  });
}

function waitFor(predicate, label, timeoutMs = 12_000) {
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
        reject(new Error(`Timed out waiting for ${label}. Events: ${events.map((event) => `${event.type}:${event.status ?? event.id ?? ""}`).join(", ")}`));
      }, timeoutMs)
    };
    waiters.push(waiter);
  });
}

function parseRegistryTheme(value) {
  return {
    AppsUseLightTheme: parseRegDword(value, "AppsUseLightTheme"),
    SystemUsesLightTheme: parseRegDword(value, "SystemUsesLightTheme"),
    rawPreview: value.slice(0, 500)
  };
}

function parseRegDword(value, name) {
  const match = new RegExp(`${name}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, "i").exec(value);
  return match ? Number.parseInt(match[1], 16) : null;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function renderReport(evidence) {
  const rows = evidence.scenarios.map((scenario) =>
    `| \`${scenario.id}\` | ${scenario.surface} | \`${scenario.risk}\` | ${scenario.status} | ${(scenario.notes ?? []).join(" ")} |`
  ).join("\n");
  const jobLines = evidence.scenarios
    .flatMap((scenario) => (scenario.capabilityJobs ?? []).map((job) => `- ${scenario.id}: \`${job.id}\` ${job.kind}/${job.status}, verification \`${job.verification?.status ?? "unknown"}\``))
    .join("\n");
  return `# Windows Computer-Use High-Risk Dogfood Evidence - ${evidence.date}

## Scope

- Matrix: \`${evidence.matrix}\`
- Daemon port: \`${evidence.daemonPort}\`
- Mode: safe baseline collector
- Real Windows setting mutation: ${evidence.acceptance.realWindowsSettingMutation ? "yes" : "no"}
- Supporting JSON: \`${jsonPath.replace(/\\/g, "/")}\`

## Scenario Results

| Scenario | Surface | Risk | Status | Notes |
| --- | --- | --- | --- | --- |
${rows}

## Capability Jobs

${jobLines || "- No capability jobs captured."}

## Acceptance

- Safe baseline only: ${evidence.acceptance.safeBaselineOnly ? "passed" : "failed"}
- Executed scenarios passed or skipped: ${evidence.acceptance.allExecutedScenariosPassed ? "passed" : "failed"}
- Capability details captured: ${evidence.acceptance.capabilityDetailsCaptured ? "passed" : "failed"}
- Credential-like terminal blocked before persistence: ${evidence.acceptance.credentialLikeTerminalBlockedBeforePersistence ? "passed" : "failed"}

## Notes

This collector intentionally avoids live Windows setting mutation. The next
expansion should enable reversible OS/app workflows one at a time with explicit
approval, before/after evidence, and rollback proof.
`;
}
