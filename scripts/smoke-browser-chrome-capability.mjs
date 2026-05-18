import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-browser-chrome-capability-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const extensionRuntimeId = "abcdefghijklmnopabcdefghijklmnop";
const extensionOrigin = `chrome-extension://${extensionRuntimeId}`;
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
const waiters = [];

try {
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
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

  await postExtensionHeartbeat();
  send({
    type: "ask",
    id: "prompt-browser-chrome-first-tab",
    text: "첫번째 탭으로 전환해줘",
    mode: "browser"
  });
  const tabActivateQueued = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId === "browser-chrome-tab-activate-prompt-browser-chrome-first-tab" &&
      event.status === "browser_chrome_command_queued",
    "prompt tab activation queued"
  );
  const tabActivateCommand = await pollBrowserBridgeCommand();
  assertEqual(tabActivateCommand?.kind, "browser_chrome", "prompt tab activation command kind");
  assertEqual(tabActivateCommand?.requestId, tabActivateQueued.detail?.requestId, "prompt tab activation request id");
  assertEqual(tabActivateCommand?.command, "tab.activate", "prompt tab activation command");
  assertEqual(tabActivateCommand?.payload?.index, 0, "prompt tab activation zero-based index");
  assertEqual(tabActivateCommand?.payload?.ordinal, 1, "prompt tab activation user ordinal");
  await postBrowserChromeResult(tabActivateCommand.requestId, {
    tab: { id: 1, windowId: 1, index: 0, title: "First", url: "https://example.test/first", active: true },
    requested: { index: 0, ordinal: 1 }
  }, { verification: "tab_activated", backgroundControl: true, nativeInput: false, hotkey: false });
  const tabActivateAnswer = await waitFor((event) => event.type === "message.completed" && event.id === "prompt-browser-chrome-first-tab", "prompt tab activation answer");
  if (!tabActivateAnswer.text.includes("첫번째 탭")) {
    throw new Error(`Prompt tab activation answer should mention the requested tab: ${tabActivateAnswer.text}`);
  }

  send({
    type: "capability.start",
    requestId: "browser-chrome-list",
    job: {
      id: "browser-chrome-list-job",
      kind: "browser_chrome",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { command: "bookmark.list" },
      timeoutMs: 10_000
    }
  });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-list-job" && event.status === "running", "browser chrome list running");
  const listCommand = await pollBrowserBridgeCommand();
  assertEqual(listCommand?.kind, "browser_chrome", "list command kind");
  assertEqual(listCommand?.command, "bookmark.list", "list command");
  await postBrowserChromeResult(listCommand.requestId, {
    tree: [{ id: "0", title: "Bookmarks", children: [{ id: "1", title: "Example", url: "https://example.test/" }] }]
  }, { verification: "bookmark_tree_read" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-list-job" && event.status === "completed", "browser chrome list completed");

  await expectApprovalThenComplete({
    requestId: "browser-chrome-tab-activate",
    jobId: "browser-chrome-tab-activate-job",
    input: { command: "tab.activate", index: 0, ordinal: 1, focusWindow: true },
    expectedCommand: "tab.activate",
    output: {
      tab: { id: 1, windowId: 1, index: 0, title: "First", url: "https://example.test/first", active: true },
      requested: { tabId: 1, index: 0, ordinal: 1, windowId: 1 }
    },
    metadata: { verification: "tab_activated", backgroundControl: true, nativeInput: false, hotkey: false }
  });

  send({
    type: "capability.start",
    requestId: "browser-chrome-create",
    job: {
      id: "browser-chrome-create-job",
      kind: "browser_chrome",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: {
        command: "bookmark.create",
        title: "Capability Smoke",
        url: "https://example.test/capability"
      },
      timeoutMs: 10_000
    }
  });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-create-job" && event.status === "awaiting_approval", "browser chrome create awaiting approval");
  send({ type: "capability.approve", requestId: "approve-browser-chrome-create", jobId: "browser-chrome-create-job" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-create-job" && event.status === "running", "browser chrome create running");
  const createCommand = await pollBrowserBridgeCommand();
  assertEqual(createCommand?.kind, "browser_chrome", "create command kind");
  assertEqual(createCommand?.command, "bookmark.create", "create command");
  assertEqual(createCommand?.payload?.title, "Capability Smoke", "create title");
  assertEqual(createCommand?.payload?.url, "https://example.test/capability", "create url");
  await postBrowserChromeResult(createCommand.requestId, {
    bookmark: { id: "smoke-bookmark", title: "Capability Smoke", url: "https://example.test/capability" }
  }, { verification: "bookmark_created", bookmarkId: "smoke-bookmark" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-create-job" && event.status === "completed", "browser chrome create completed");
  const stored = await fetchCapabilityJob("browser-chrome-create-job");
  assertEqual(stored.job.kind, "browser_chrome", "stored create kind");
  assertEqual(stored.job.status, "completed", "stored create status");
  assertEqual(stored.job.outputJson?.output?.bookmark?.id, "smoke-bookmark", "stored create output");
  assertEqual(stored.job.outputJson?.capabilityVerification?.status, "passed", "stored create verification status");
  assertEqual(stored.job.outputJson?.capabilityVerification?.class, "browser_chrome_effect", "stored create verification class");
  assertEqual(stored.diagnostics?.kind, "browser_chrome", "stored create diagnostics kind");

  send({
    type: "capability.start",
    requestId: "browser-chrome-tab-groups",
    job: {
      id: "browser-chrome-tab-groups-job",
      kind: "browser_chrome",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { command: "tab_group.list" },
      timeoutMs: 10_000
    }
  });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-tab-groups-job" && event.status === "running", "tab group list running");
  const tabGroupCommand = await pollBrowserBridgeCommand();
  assertEqual(tabGroupCommand?.command, "tab_group.list", "tab group list command");
  await postBrowserChromeResult(tabGroupCommand.requestId, {
    groups: [{ id: 10, title: "Codex Run", color: "green", collapsed: false, tabIds: [1] }]
  }, { verification: "tab_groups_read" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-tab-groups-job" && event.status === "completed", "tab group list completed");

  await expectApprovalThenComplete({
    requestId: "browser-chrome-tab-group-claim",
    jobId: "browser-chrome-tab-group-claim-job",
    input: { command: "tab_group.claim", tabIds: [1], runId: "run-smoke", threadId: "thread-smoke", color: "green" },
    expectedCommand: "tab_group.claim",
    output: {
      group: { id: 10, title: "Codex run-smoke", color: "green", collapsed: false, tabIds: [1] },
      claim: { owner: "run-smoke", runId: "run-smoke", threadId: "thread-smoke" }
    },
    metadata: { verification: "tab_group_claimed", groupId: 10, owner: "run-smoke" }
  });

  send({
    type: "capability.start",
    requestId: "browser-chrome-download-verify",
    job: {
      id: "browser-chrome-download-verify-job",
      kind: "browser_chrome",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { command: "download.verify", id: 7, expectedState: "complete" },
      timeoutMs: 10_000
    }
  });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-download-verify-job" && event.status === "running", "download verify running");
  const downloadVerifyCommand = await pollBrowserBridgeCommand();
  assertEqual(downloadVerifyCommand?.command, "download.verify", "download verify command");
  await postBrowserChromeResult(downloadVerifyCommand.requestId, {
    verified: true,
    downloads: [{ id: 7, url: "https://example.test/report.pdf", filename: "report.pdf", filenameRedacted: true, state: "complete" }],
    expectedState: "complete"
  }, { verification: "download_verified" });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-download-verify-job" && event.status === "completed", "download verify completed");

  await expectApprovalThenComplete({
    requestId: "browser-chrome-download-start",
    jobId: "browser-chrome-download-start-job",
    input: { command: "download.start", url: "https://example.test/report.pdf", filename: "codex/report.pdf" },
    expectedCommand: "download.start",
    output: { download: { id: 7, url: "https://example.test/report.pdf", filename: "report.pdf", filenameRedacted: true, state: "in_progress" } },
    metadata: { verification: "download_started", downloadId: 7 }
  });

  const historyJob = await expectApprovalThenComplete({
    requestId: "browser-chrome-history-search",
    jobId: "browser-chrome-history-search-job",
    input: { command: "history.search", text: "openai", maxResults: 5 },
    expectedCommand: "history.search",
    output: {
      items: [{ id: "1", title: "OpenAI", origin: "https://openai.com", url: "https://openai.com/[redacted]", pathRedacted: true }],
      redaction: "url_path_redacted"
    },
    metadata: { verification: "history_search_redacted", risk: "high", approval: "one_time" }
  });
  assertEqual(historyJob.job.outputJson?.metadata?.risk, "high", "history risk metadata");
  assertEqual(historyJob.job.outputJson?.output?.items?.[0]?.pathRedacted, true, "history path redacted");

  await expectApprovalThenComplete({
    requestId: "browser-chrome-debugger-inspect",
    jobId: "browser-chrome-debugger-inspect-job",
    input: { command: "debugger.inspect" },
    expectedCommand: "debugger.inspect",
    output: { inspection: { title: "Example", readyState: "complete", inputCount: 1 } },
    metadata: { verification: "debugger_inspected", risk: "high", approval: "one_time" }
  });

  await expectApprovalThenComplete({
    requestId: "browser-chrome-debugger-screenshot",
    jobId: "browser-chrome-debugger-screenshot-job",
    input: { command: "debugger.screenshot" },
    expectedCommand: "debugger.screenshot",
    output: { screenshot: { format: "png", byteLength: 1024, sha256: "png123", dataOmitted: true } },
    metadata: { verification: "debugger_screenshot_captured", risk: "high", approval: "one_time" }
  });

  await expectApprovalThenComplete({
    requestId: "browser-chrome-debugger-print-pdf",
    jobId: "browser-chrome-debugger-print-pdf-job",
    input: { command: "debugger.print_to_pdf", printBackground: true },
    expectedCommand: "debugger.print_to_pdf",
    output: { pdf: { format: "pdf", byteLength: 1024, sha256: "abc123", dataOmitted: true } },
    metadata: { verification: "debugger_pdf_printed", risk: "high", approval: "one_time" }
  });

  send({
    type: "capability.start",
    requestId: "browser-chrome-permission-get",
    job: {
      id: "browser-chrome-permission-get-job",
      kind: "browser_chrome",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: { command: "permission.get", type: "camera", url: "https://example.test/camera" },
      timeoutMs: 10_000
    }
  });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-permission-get-job" && event.status === "running", "permission get running");
  const permissionGetCommand = await pollBrowserBridgeCommand();
  assertEqual(permissionGetCommand?.command, "permission.get", "permission get command");
  await postBrowserChromeResult(permissionGetCommand.requestId, {
    permission: { type: "camera", origin: "https://example.test", primaryPattern: "https://example.test/*", setting: "ask", pathRedacted: true }
  }, { verification: "browser_permission_read", risk: "read_only", popupWorkflow: "content_settings_api", nativePopupClick: false });
  await waitFor((event) => event.type === "capability.job" && event.jobId === "browser-chrome-permission-get-job" && event.status === "completed", "permission get completed");

  const permissionSetJob = await expectApprovalThenComplete({
    requestId: "browser-chrome-permission-set",
    jobId: "browser-chrome-permission-set-job",
    input: { command: "permission.set", type: "camera", url: "https://example.test/camera", setting: "allow" },
    expectedCommand: "permission.set",
    output: {
      permission: { type: "camera", origin: "https://example.test", primaryPattern: "https://example.test/*", requestedSetting: "allow", verifiedSetting: "allow", pathRedacted: true }
    },
    metadata: { verification: "browser_permission_setting_applied", risk: "high", approval: "one_time", popupWorkflow: "content_settings_api", nativePopupClick: false }
  });
  assertEqual(permissionSetJob.job.outputJson?.output?.permission?.pathRedacted, true, "permission output path redacted");
  assertEqual(permissionSetJob.job.inputJson?.url?.pathRedacted, true, "permission input path redacted");

  const uploadSetFilesJob = await expectApprovalThenComplete({
    requestId: "browser-chrome-file-upload-set-files",
    jobId: "browser-chrome-file-upload-set-files-job",
    input: { command: "file_upload.set_files", selector: "input[type='file']", approvedFilePaths: ["C:\\Users\\Tony\\Documents\\example.pdf"] },
    expectedCommand: "file_upload.set_files",
    output: {
      status: "files_selected",
      selector: "input[type='file']",
      inputIndex: 0,
      files: [{ basename: "example.pdf", pathRedacted: true }]
    },
    metadata: { verification: "file_upload_files_selected", risk: "high", approval: "one_time", fileCount: 1 }
  });
  assertEqual(uploadSetFilesJob.job.inputJson?.approvedFilePaths?.[0]?.pathRedacted, true, "file upload persisted path redacted");
  assertEqual(uploadSetFilesJob.job.outputJson?.output?.files?.[0]?.pathRedacted, true, "file upload output path redacted");

  const uploadBlockedJob = await expectApprovalThenComplete({
    requestId: "browser-chrome-file-upload-blocked",
    jobId: "browser-chrome-file-upload-blocked-job",
    input: { command: "file_upload.blocked" },
    expectedCommand: "file_upload.blocked",
    output: {
      status: "blocked",
      blocker: "file_upload_requires_explicit_file_grant_and_native_picker",
      reason: "Local file selection requires explicit grants."
    },
    metadata: { verification: "file_upload_blocked_by_policy", safetyBoundary: "local_file_disclosure" }
  });
  assertEqual(uploadBlockedJob.job.status, "completed", "file upload blocked is completed with explanation");

  console.log(`browser chrome capability smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function pollBrowserBridgeCommand() {
  const url = new URL(`${baseUrl}/browser-action/extension/poll`);
  url.searchParams.set("permission", "allowed");
  url.searchParams.set("tabId", "1");
  url.searchParams.set("windowId", "1");
  url.searchParams.set("url", "https://example.test/");
  url.searchParams.set("title", "Example");
  const response = await fetch(url, {
    headers: { Origin: extensionOrigin }
  });
  if (!response.ok) {
    throw new Error(`Browser bridge poll failed (${response.status}).`);
  }
  const payload = await response.json();
  return payload.command ?? null;
}

async function postBrowserChromeResult(requestId, output, metadata) {
  const response = await fetch(`${baseUrl}/browser-action/extension/browser-chrome-result`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: extensionOrigin },
    body: JSON.stringify({ requestId, ok: true, output, metadata })
  });
  if (!response.ok) {
    throw new Error(`Browser Chrome result POST failed (${response.status}).`);
  }
}

async function postExtensionHeartbeat() {
  const response = await fetch(`${baseUrl}/browser-action/extension/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: extensionOrigin },
    body: JSON.stringify({
      extensionRuntimeId,
      connected: true,
      mode: "idle",
      updatedAt: new Date().toISOString(),
      activeTab: {
        tabId: 1,
        windowId: 1,
        url: "https://example.test/",
        title: "Example",
        permission: "allowed"
      }
    })
  });
  if (!response.ok) {
    throw new Error(`Browser Bridge heartbeat failed (${response.status}).`);
  }
}

async function fetchCapabilityJob(jobId) {
  const response = await fetch(`${baseUrl}/capabilities/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    throw new Error(`Capability job GET failed (${response.status}).`);
  }
  return await response.json();
}

async function expectApprovalThenComplete(input) {
  send({
    type: "capability.start",
    requestId: input.requestId,
    job: {
      id: input.jobId,
      kind: "browser_chrome",
      priority: "interactive",
      requestedBy: "direct_ui",
      input: input.input,
      timeoutMs: 10_000
    }
  });
  await waitFor((event) => event.type === "capability.job" && event.jobId === input.jobId && event.status === "awaiting_approval", `${input.expectedCommand} awaiting approval`);
  send({ type: "capability.approve", requestId: `approve-${input.jobId}`, jobId: input.jobId });
  await waitFor((event) => event.type === "capability.job" && event.jobId === input.jobId && event.status === "running", `${input.expectedCommand} running`);
  const command = await pollBrowserBridgeCommand();
  assertEqual(command?.command, input.expectedCommand, `${input.expectedCommand} command`);
  await postBrowserChromeResult(command.requestId, input.output, input.metadata);
  await waitFor((event) => event.type === "capability.job" && event.jobId === input.jobId && event.status === "completed", `${input.expectedCommand} completed`);
  return await fetchCapabilityJob(input.jobId);
}

function send(message) {
  socket.send(JSON.stringify(message));
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
        reject(new Error(`Timed out waiting for ${label}. Events: ${events.map((event) => `${event.type}:${event.status ?? ""}`).join(", ")}`));
      }, timeoutMs)
    };
    waiters.push(waiter);
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
