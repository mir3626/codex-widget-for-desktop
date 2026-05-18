#!/usr/bin/env node
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-browser-chrome-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const extensionRuntimeId = "abcdefghijklmnopabcdefghijklmnop";
const extensionOrigin = `chrome-extension://${extensionRuntimeId}`;
const downloadPath = join(smokeAppData.dir, "report.pdf");
writeFileSync(downloadPath, "%PDF-1.4\n% download verification fixture\n", "utf8");
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
  const profile = await postJson("/computer-use/autonomy/profiles", {
    name: "Browser Chrome download evidence smoke",
    mode: "scoped_yolo",
    scope: "one_time",
    maxUses: 1,
    grants: {
      network: false,
      networkDomains: [],
      browserAutomation: true,
      browserDomains: ["example.test"],
      filesystem: { readRoots: [smokeAppData.dir], writeRoots: [smokeAppData.dir] },
      commands: { allowPrefixes: [], denyPatterns: ["password", "token", "secret", "cookie", "rm -rf", "format"] },
      packageInstall: false,
      osMutation: false,
      generatedToolMaterialization: false,
      generatedToolExecution: false,
      generatedCode: false,
      credentialAccess: "never",
      riskClasses: ["read_only", "high_risk"],
      maxRuntimeMs: 30000,
      maxOutputBytes: 2097152,
      maxIterations: 1
    }
  });
  assert.equal(profile.ok, true);

  const started = await postJson("/computer-use/sessions", {
    userRequest: "현재 브라우저의 탭 그룹과 기록 상태를 점검해줘",
    requestedSurface: "regular_browser_extension",
    profileId: profile.profile.id,
    metadata: { requiresBrowserChrome: true }
  });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.selectedSurface.kind, "regular_browser_extension");
  const sessionId = started.result.session.sessionId;

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "tab_group.list", timeoutMs: 10_000 },
    expectedCommand: "tab_group.list",
    output: {
      groups: [{ id: 9, title: "Codex Session", color: "green", collapsed: false, tabIds: [1, 2] }]
    },
    metadata: { verification: "computer_session_tab_groups_read" }
  });

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "tab_group.create", tabIds: [1], title: "Codex Run", color: "green", timeoutMs: 10_000 },
    expectedCommand: "tab_group.create",
    output: {
      group: { id: 10, title: "Codex Run", color: "green", collapsed: false, tabIds: [1] }
    },
    metadata: { verification: "computer_session_tab_group_created" },
    approve: true
  });

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "tab_group.claim", groupId: 10, runId: "run-smoke", threadId: "thread-smoke", title: "Codex Claimed", color: "blue", timeoutMs: 10_000 },
    expectedCommand: "tab_group.claim",
    output: {
      group: { id: 10, title: "Codex Claimed", color: "blue", collapsed: false, tabIds: [1] },
      claim: { owner: "run-smoke", runId: "run-smoke", threadId: "thread-smoke" }
    },
    metadata: { verification: "computer_session_tab_group_claimed" },
    approve: true
  });

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "tab_group.update", groupId: 10, title: "Codex Updated", collapsed: true, timeoutMs: 10_000 },
    expectedCommand: "tab_group.update",
    output: {
      group: { id: 10, title: "Codex Updated", color: "blue", collapsed: true, tabIds: [1] }
    },
    metadata: { verification: "computer_session_tab_group_updated" },
    approve: true
  });

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "tab_group.release", tabIds: [1], timeoutMs: 10_000 },
    expectedCommand: "tab_group.release",
    output: {
      releasedTabIds: [1]
    },
    metadata: { verification: "computer_session_tab_group_released" },
    approve: true
  });

  const bookmarks = await executeBrowserChromeOperation({
    sessionId,
    input: { command: "bookmark.list", timeoutMs: 10_000 },
    expectedCommand: "bookmark.list",
    output: {
      bookmarks: [{ id: "b1", title: "OpenAI", url: "https://openai.com/" }]
    },
    metadata: { verification: "computer_session_bookmarks_read" }
  });
  assert.equal(bookmarks.job.outputJson?.output?.bookmarks?.[0]?.title, "OpenAI");

  const createdBookmark = await executeBrowserChromeOperation({
    sessionId,
    input: { command: "bookmark.create", title: "Codex docs", url: "https://platform.openai.com/docs/codex", timeoutMs: 10_000 },
    expectedCommand: "bookmark.create",
    output: {
      bookmark: { id: "b2", title: "Codex docs", url: "https://platform.openai.com/docs/codex" },
      created: true
    },
    metadata: { verification: "computer_session_bookmark_created", approval: "one_time" },
    approve: true
  });
  assert.equal(createdBookmark.job.outputJson?.output?.created, true);

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "bookmark.update", id: "b2", title: "Codex docs updated", url: "https://platform.openai.com/docs/codex", timeoutMs: 10_000 },
    expectedCommand: "bookmark.update",
    output: {
      bookmark: { id: "b2", title: "Codex docs updated", url: "https://platform.openai.com/docs/codex" },
      updated: true
    },
    metadata: { verification: "computer_session_bookmark_updated", approval: "one_time" },
    approve: true
  });

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "bookmark.open", id: "b2", timeoutMs: 10_000 },
    expectedCommand: "bookmark.open",
    output: {
      bookmark: { id: "b2", title: "Codex docs updated", url: "https://platform.openai.com/docs/codex" },
      tab: { id: 1, windowId: 1, url: "https://platform.openai.com/docs/codex" }
    },
    metadata: { verification: "computer_session_bookmark_opened", approval: "one_time" },
    approve: true
  });

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "bookmark.remove", id: "b2", timeoutMs: 10_000 },
    expectedCommand: "bookmark.remove",
    output: {
      removed: true,
      id: "b2"
    },
    metadata: { verification: "computer_session_bookmark_removed", approval: "one_time" },
    approve: true
  });

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "download.search", query: "report", timeoutMs: 10_000 },
    expectedCommand: "download.search",
    output: {
      downloads: [{ id: 5, url: "https://example.test/report.pdf", filename: "report.pdf", filenameRedacted: true, state: "complete" }]
    },
    metadata: { verification: "computer_session_downloads_read" }
  });

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "download.observe", id: 5, timeoutMs: 10_000 },
    expectedCommand: "download.observe",
    output: {
      downloads: [{ id: 5, url: "https://example.test/report.pdf", filename: "report.pdf", filenameRedacted: true, state: "complete", receivedBytes: 42 }]
    },
    metadata: { verification: "computer_session_download_observed" }
  });

  const download = await executeBrowserChromeOperation({
    sessionId,
    input: { command: "download.verify", id: 5, expectedState: "complete", approvedDownloadPath: downloadPath, timeoutMs: 10_000 },
    expectedCommand: "download.verify",
    output: {
      verified: true,
      downloads: [{ id: 5, url: "https://example.test/report.pdf", filename: "report.pdf", filenameRedacted: true, state: "complete" }],
      expectedState: "complete"
    },
    metadata: { verification: "computer_session_download_verified" }
  });
  assert.equal(download.job.outputJson?.output?.verified, true);

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "download.start", url: "https://example.test/report.pdf", filename: "codex/report.pdf", timeoutMs: 10_000 },
    expectedCommand: "download.start",
    output: {
      download: { id: 6, url: "https://example.test/report.pdf", filename: "codex/report.pdf", filenameRedacted: true, state: "in_progress" }
    },
    metadata: { verification: "computer_session_download_started", approval: "one_time" },
    approve: true
  });

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "download.cancel", id: 6, timeoutMs: 10_000 },
    expectedCommand: "download.cancel",
    output: {
      download: { id: 6, url: "https://example.test/report.pdf", filename: "codex/report.pdf", filenameRedacted: true, state: "interrupted" }
    },
    metadata: { verification: "computer_session_download_cancelled", approval: "one_time" },
    approve: true
  });

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "download.erase", id: 6, timeoutMs: 10_000 },
    expectedCommand: "download.erase",
    output: {
      erasedIds: [6]
    },
    metadata: { verification: "computer_session_download_erased", approval: "one_time" },
    approve: true
  });

  const history = await executeBrowserChromeOperation({
    sessionId,
    input: { command: "history.search", text: "openai", maxResults: 3, timeoutMs: 10_000 },
    expectedCommand: "history.search",
    output: {
      items: [{ id: "h1", title: "OpenAI", origin: "https://openai.com", url: "https://openai.com/[redacted]", pathRedacted: true }],
      redaction: "url_path_redacted"
    },
    metadata: { verification: "computer_session_history_redacted", risk: "high", approval: "one_time" },
    approve: true
  });
  assert.equal(history.job.outputJson?.output?.items?.[0]?.pathRedacted, true);

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "history.open", url: "https://openai.com/", timeoutMs: 10_000 },
    expectedCommand: "history.open",
    output: {
      tab: { id: 1, windowId: 1, url: "https://openai.com/" }
    },
    metadata: { verification: "computer_session_history_opened", risk: "high", approval: "one_time" },
    approve: true
  });

  const debuggerInspect = await executeBrowserChromeOperation({
    sessionId,
    input: { command: "debugger.inspect", timeoutMs: 10_000 },
    expectedCommand: "debugger.inspect",
    output: {
      inspected: true,
      url: "https://example.test/",
      title: "Example",
      documentState: "complete",
      redaction: "dom_metadata_only"
    },
    metadata: { verification: "computer_session_debugger_inspected", risk: "high", approval: "one_time" },
    approve: true
  });
  assert.equal(debuggerInspect.job.outputJson?.output?.inspected, true);

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "debugger.screenshot", timeoutMs: 10_000 },
    expectedCommand: "debugger.screenshot",
    output: {
      screenshot: { format: "png", byteLength: 1024, sha256: "png123", dataOmitted: true }
    },
    metadata: { verification: "computer_session_debugger_screenshot_captured", risk: "high", approval: "one_time" },
    approve: true
  });

  const printPdf = await executeBrowserChromeOperation({
    sessionId,
    input: { command: "debugger.print_to_pdf", printBackground: true, timeoutMs: 10_000 },
    expectedCommand: "debugger.print_to_pdf",
    output: {
      pdf: { format: "pdf", byteLength: 2048, sha256: "def456", dataOmitted: true }
    },
    metadata: { verification: "computer_session_debugger_pdf_printed", risk: "high", approval: "one_time" },
    approve: true
  });
  assert.equal(printPdf.job.outputJson?.output?.pdf?.format, "pdf");

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "permission.get", type: "camera", url: "https://example.test/camera", timeoutMs: 10_000 },
    expectedCommand: "permission.get",
    output: {
      permission: { type: "camera", origin: "https://example.test", primaryPattern: "https://example.test/*", setting: "ask", pathRedacted: true }
    },
    metadata: { verification: "computer_session_browser_permission_read", risk: "read_only", popupWorkflow: "content_settings_api", nativePopupClick: false }
  });

  const permissionSet = await executeBrowserChromeOperation({
    sessionId,
    input: { command: "permission.set", type: "camera", url: "https://example.test/camera", setting: "allow", timeoutMs: 10_000 },
    expectedCommand: "permission.set",
    output: {
      permission: { type: "camera", origin: "https://example.test", primaryPattern: "https://example.test/*", requestedSetting: "allow", verifiedSetting: "allow", pathRedacted: true }
    },
    metadata: { verification: "computer_session_browser_permission_setting_applied", risk: "high", approval: "one_time", popupWorkflow: "content_settings_api", nativePopupClick: false },
    approve: true
  });
  assert.equal(permissionSet.job.outputJson?.output?.permission?.verifiedSetting, "allow");
  assert.equal(permissionSet.job.inputJson?.url?.pathRedacted, true);

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "file_upload.inspect", selector: "input[type='file']", timeoutMs: 10_000 },
    expectedCommand: "file_upload.inspect",
    output: {
      tabId: 1,
      inputs: [{ index: 0, selector: "input[type='file']", multiple: false }],
      uploadStatus: "inspect_only"
    },
    metadata: { verification: "computer_session_file_upload_inputs_inspected", risk: "high", approval: "one_time" },
    approve: true
  });

  const fileUpload = await executeBrowserChromeOperation({
    sessionId,
    input: {
      command: "file_upload.set_files",
      selector: "input[type='file']",
      approvedFilePaths: ["C:\\Users\\Tony\\Documents\\example.pdf"],
      timeoutMs: 10_000
    },
    expectedCommand: "file_upload.set_files",
    output: {
      selected: true,
      selector: "input[type='file']",
      files: [{ basename: "example.pdf", pathRedacted: true }]
    },
    metadata: { verification: "computer_session_file_upload_set", risk: "high", approval: "one_time" },
    approve: true
  });
  assert.equal(fileUpload.job.outputJson?.output?.files?.[0]?.pathRedacted, true);

  await executeBrowserChromeOperation({
    sessionId,
    input: { command: "file_upload.clear", selector: "input[type='file']", timeoutMs: 10_000 },
    expectedCommand: "file_upload.clear",
    output: {
      status: "files_cleared",
      selector: "input[type='file']",
      inputIndex: 0
    },
    metadata: { verification: "computer_session_file_upload_cleared", risk: "high", approval: "one_time" },
    approve: true
  });

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.bundle.dagNodes.filter((node) => node.capabilityKind === "browser_chrome" && node.status === "completed").length >= 26, true);
  assert.equal(bundle.bundle.capabilityJobs.filter((job) => job.kind === "browser_chrome" && job.status === "completed").length >= 26, true);
  assert.equal(
    bundle.bundle.evalResources.some((resource) => resource.role === "download_verified_file"),
    true,
    JSON.stringify({
      evalResources: bundle.bundle.evalResources,
      downloadObservations: bundle.bundle.observations.filter((observation) =>
        observation.source === "browser_chrome_download_verify" ||
        observation.metadata?.downloadEvidenceCount !== undefined
      ),
      downloadJobs: bundle.bundle.capabilityJobs.filter((job) =>
        job.kind === "browser_chrome" &&
        (job.inputJson?.command === "download.verify" || job.outputJson?.output?.verified === true)
      ),
      downloadDagNodes: bundle.bundle.dagNodes.filter((node) =>
        node.capabilityKind === "browser_chrome" &&
        (node.input?.capabilityInput?.command === "download.verify" || node.output?.output?.verified === true)
      )
    }, null, 2)
  );
  assert.equal(bundle.bundle.observations.some((observation) =>
    observation.kind === "file" &&
    observation.source === "browser_chrome_download_verify" &&
    observation.resourceIds?.some((resource) => resource.role === "download_verified_file")
  ), true);

  await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/cancel`, { reason: "browser_chrome_session_smoke_cleanup" });
  console.log(`computer use browser chrome smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function executeBrowserChromeOperation(input) {
  const operation = await postJson(`/computer-use/sessions/${encodeURIComponent(input.sessionId)}/operations`, {
    waitMs: 100,
    operation: {
      kind: "browser_chrome",
      input: input.input
    }
  });
  assert.equal(operation.ok, true);
  assert.equal(operation.result.job.kind, "browser_chrome");
  if (input.approve) {
    assert.equal(operation.result.job.status, "awaiting_approval");
    send({ type: "capability.approve", requestId: `approve-${operation.result.job.id}`, jobId: operation.result.job.id });
    await waitFor((event) => event.type === "capability.job" && event.jobId === operation.result.job.id && event.status === "running", `${input.expectedCommand} running`);
  } else {
    assert.equal(operation.result.job.status, "running");
  }
  const command = await pollBrowserBridgeCommand();
  assert.equal(command?.kind, "browser_chrome");
  assert.equal(command?.command, input.expectedCommand);
  assert.equal(command?.jobId, operation.result.job.id);
  await postBrowserChromeResult(command.requestId, input.output, input.metadata);
  await waitFor((event) => event.type === "capability.job" && event.jobId === operation.result.job.id && event.status === "completed", `${input.expectedCommand} completed`);
  const job = await getJson(`/capabilities/jobs/${encodeURIComponent(operation.result.job.id)}`);
  assert.equal(job.job.status, "completed");
  const bundle = await waitForDagNode(input.sessionId, operation.result.dagNode.id, "completed");
  const node = bundle.bundle.dagNodes.find((candidate) => candidate.id === operation.result.dagNode.id);
  assert.equal(node?.capabilityJobId, operation.result.job.id);
  assertFollowupDagNodes(bundle, operation.result.dagNode.id, operation.result.job.id);
  return job;
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
    throw new Error(`Browser Bridge poll failed (${response.status}): ${await response.text()}`);
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
    throw new Error(`Browser Chrome result POST failed (${response.status}): ${await response.text()}`);
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
    throw new Error(`Browser Bridge heartbeat failed (${response.status}): ${await response.text()}`);
  }
}

async function waitForDagNode(sessionId, nodeId, status) {
  const deadline = Date.now() + 5000;
  let bundle;
  while (Date.now() < deadline) {
    bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
    const node = bundle.bundle.dagNodes.find((candidate) => candidate.id === nodeId);
    if (node?.status === status) {
      return bundle;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for DAG node ${nodeId} to reach ${status}: ${JSON.stringify(bundle?.bundle?.dagNodes ?? [], null, 2)}`);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
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

function assertFollowupDagNodes(bundle, actionNodeId, jobId) {
  const verification = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:verification`);
  const ledger = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:eval_ledger`);
  assert.equal(verification?.kind, "verification");
  assert.equal(verification?.status, "completed");
  assert.equal(verification?.capabilityJobId, jobId);
  assert.equal(ledger?.kind, "eval_ledger");
  assert.equal(ledger?.status, "completed");
  assert.equal(ledger?.capabilityJobId, jobId);
}
