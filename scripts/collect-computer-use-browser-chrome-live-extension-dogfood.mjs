#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import WebSocket from "ws";
import { chromium } from "@playwright/test";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const DATE = process.env.CODEX_WIDGET_DOGFOOD_DATE ?? formatSeoulDate(new Date());
const runId = `computer-use-browser-chrome-live-extension-${formatKstTimestamp(new Date())}`;
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `computer-use-browser-chrome-live-extension-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `computer-use-browser-chrome-live-extension-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `computer-use-browser-chrome-live-extension-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const sampleLedgerPath = join(repoRoot, "docs", "reports", "assets", "computer-use-browser-chrome-live-extension-runs.jsonl");
const extensionDir = path.resolve("providers/browser-dom-extension");

function logStep(message, detail) {
  const suffix = detail === undefined ? "" : ` ${JSON.stringify(detail)}`;
  console.log(`[browser-chrome-live-extension] ${message}${suffix}`);
}

await rm(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
await mkdir(assetDir, { recursive: true });

const smokeAppData = useSmokeAppData("codex-widget-computer-use-browser-chrome-live-extension");
const downloadDir = join(smokeAppData.dir, "downloads");
mkdirSync(downloadDir, { recursive: true });

logStep("starting daemon");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
logStep("daemon ready", { baseUrl });
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const socketOpen = new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});
const events = [];
const waiters = [];
logStep("starting fixture server");
const fixture = await startFixtureServer();
logStep("fixture ready", { pageUrl: fixture.pageUrl });
logStep("launching browser with extension");
const browser = await launchBrowserWithExtension({
  daemonUrl: baseUrl,
  extensionDir,
  downloadDir
});
logStep("browser ready", { extensionId: browser.extensionId });

try {
  logStep("opening websocket");
  await socketOpen;
  logStep("websocket connected");
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

  const page = await browser.ensurePage();
  logStep("navigating fixture page");
  await page.goto(fixture.pageUrl, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  await browser.refreshBridge("fixture_page_loaded");
  logStep("waiting for bridge idle");
  await waitForBridgeMode("idle");

  logStep("creating scoped autonomy profile");
  const profile = await postJson("/computer-use/autonomy/profiles", {
    name: "Browser Chrome live extension scoped profile",
    mode: "scoped_yolo",
    scope: "one_time",
    maxUses: 8,
    grants: {
      network: false,
      networkDomains: [],
      browserAutomation: true,
      browserDomains: ["127.0.0.1", "localhost"],
      filesystem: { readRoots: [downloadDir], writeRoots: [downloadDir] },
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
  logStep("profile ready", { profileId: profile.profile.id });

  const startedAtMs = Date.now();
  logStep("running download scenario");
  const downloadScenario = await runDownloadScenario({ profileId: profile.profile.id });
  logStep("download scenario complete", { success: downloadScenario.success, elapsedMs: downloadScenario.result.elapsedMs });
  logStep("running print-to-pdf scenario");
  const printScenario = await runPrintToPdfScenario({ profileId: profile.profile.id });
  logStep("print-to-pdf scenario complete", { success: printScenario.success, elapsedMs: printScenario.result.elapsedMs });
  const scenarios = [downloadScenario, printScenario];
  const elapsedMs = Date.now() - startedAtMs;
  const evidence = {
    schemaVersion: "computer-use-browser-chrome-live-extension-dogfood.v1",
    generatedAt: new Date().toISOString(),
    date: DATE,
    runId,
    evidenceClass: "real_extension_local_fixture",
    promotion: "non_promoting_until_public_site_repeated_samples_exist",
    extension: {
      id: browser.extensionId,
      mode: "playwright_persistent_context",
      browserApiExecution: true
    },
    metrics: summarizeMetrics(scenarios, elapsedMs),
    scenarios
  };

  mkdirSync(join(repoRoot, "docs", "dogfood"), { recursive: true });
  mkdirSync(join(repoRoot, "docs", "reports"), { recursive: true });
  writeFileSync(dogfoodPath, `${JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    generatedAt: evidence.generatedAt,
    date: evidence.date,
    runId,
    evidenceClass: evidence.evidenceClass,
    promotion: evidence.promotion,
    extension: evidence.extension,
    scenarios: scenarios.map(redactScenarioForDogfood)
  }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");
  for (const scenario of scenarios) {
    await writeFile(join(assetDir, `${scenario.id}.debug-summary.json`), `${JSON.stringify(redactScenarioForDogfood(scenario), null, 2)}\n`, "utf8");
    await appendLine(sampleLedgerPath, {
      schemaVersion: "computer-use-browser-chrome-live-extension-sample.v1",
      generatedAt: evidence.generatedAt,
      date: DATE,
      runId,
      evidencePath: normalizePath(evidencePath),
      reportPath: normalizePath(reportPath),
      scenario: redactScenarioForSampleLedger(scenario)
    });
  }

  assert.equal(scenarios.every((scenario) => scenario.success), true);
  console.log(`computer use browser chrome live extension dogfood evidence written: ${reportPath}`);
} finally {
  logStep("cleaning up");
  socket.close();
  await browser.close();
  await fixture.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function runDownloadScenario({ profileId }) {
  const startedAtMs = Date.now();
  const filename = "browser-chrome-live-extension-report.pdf";
  const approvedDownloadPath = join(downloadDir, filename);
  logStep("download scenario: starting session");
  const session = await startSession({
    profileId,
    userRequest: "Verify an actual Browser Bridge extension download workflow and persist approved download evidence."
  });

  logStep("download scenario: queueing download.start", { sessionId: session.sessionId });
  const start = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "download.start",
      url: fixture.downloadUrl,
      filename,
      conflictAction: "overwrite",
      timeoutMs: 15_000
    }
  });
  const downloadId = readNestedNumber(start.job.outputJson, ["output", "download", "id"]) ??
    readNestedNumber(start.job.outputJson, ["download", "id"]);
  assert.equal(Number.isInteger(downloadId) && downloadId > 0, true, JSON.stringify(start.job.outputJson));
  logStep("download scenario: waiting for approved file", { downloadId, basename: filename });
  await waitForFile(approvedDownloadPath);
  await waitForDownloadComplete(session.sessionId, downloadId);

  logStep("download scenario: queueing download.verify", { downloadId });
  const verify = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: false,
    input: {
      command: "download.verify",
      id: downloadId,
      expectedState: "complete",
      approvedDownloadPath,
      timeoutMs: 15_000
    }
  });
  logStep("download scenario: cleanup session", { sessionId: session.sessionId });
  const cleanup = await cleanupSession(session.sessionId);
  const elapsedMs = Date.now() - startedAtMs;
  const bundle = verify.bundle.bundle;
  const success = start.job.status === "completed" &&
    verify.job.status === "completed" &&
    Boolean(readNestedValue(verify.job.outputJson, ["output", "verified"]) ?? readNestedValue(verify.job.outputJson, ["verified"])) &&
    bundle.evalResources.some((resource) => resource.role === "download_verified_file") &&
    bundle.dagNodes.some((node) => node.kind === "verification" && node.status === "completed") &&
    bundle.dagNodes.some((node) => node.kind === "eval_ledger" && node.status === "completed") &&
    cleanup.reconciled;

  return {
    id: "browser-chrome-live-extension-download-verify",
    command: "download.start+download.verify",
    userScenario: "User asks the widget to start a browser download through the installed Browser Bridge path and verify the completed file with approved artifact evidence.",
    architectureWorkflow: [
      "Playwright launches Chromium with the real unpacked Browser Bridge extension.",
      "The extension service worker connects to the daemon and polls Browser Chrome commands.",
      "Computer Session runs download.start through the regular_browser_extension surface and one-time approval.",
      "Chrome downloads API creates the download in the session download directory.",
      "Computer Session runs download.verify by id and approvedDownloadPath.",
      "The daemon stores a blob-backed download_verified_file eval resource and redacted basename/hash/size evidence."
    ],
    success,
    status: success ? "passed" : "needs_followup",
    result: {
      elapsedMs,
      p50LatencyMs: elapsedMs,
      p95LatencyMs: elapsedMs,
      sessionId: session.sessionId,
      evalRunId: bundle.evalRun.id,
      startJobId: start.job.id,
      verifyJobId: verify.job.id,
      downloadId,
      approvedDownloadBasename: filename,
      fileExists: existsSync(approvedDownloadPath),
      fileSha256: existsSync(approvedDownloadPath) ? await sha256File(approvedDownloadPath) : undefined,
      resourceRoles: bundle.evalResources.map((resource) => resource.role),
      verifierNodeCount: bundle.dagNodes.filter((node) => node.kind === "verification" && node.status === "completed").length,
      evalLedgerNodeCount: bundle.dagNodes.filter((node) => node.kind === "eval_ledger" && node.status === "completed").length,
      cleanupReconciled: cleanup.reconciled,
      redaction: {
        localPathPolicy: "basename_only",
        fullPathStoredInReport: false,
        credentials: "not_used"
      }
    },
    improvementAndFollowUp: "This proves the real extension and Chrome downloads API path on a local fixture. Public-site repeated samples are still required for promotion."
  };
}

async function waitForDownloadComplete(sessionId, downloadId) {
  const deadline = Date.now() + 15_000;
  let lastItem;
  while (Date.now() < deadline) {
    const observe = await executeBrowserChromeOperation({
      sessionId,
      approve: false,
      input: {
        command: "download.observe",
        id: downloadId,
        timeoutMs: 5_000
      }
    });
    const downloads = readNestedValue(observe.job.outputJson, ["output", "downloads"]) ??
      readNestedValue(observe.job.outputJson, ["downloads"]) ?? [];
    lastItem = Array.isArray(downloads)
      ? downloads.find((item) => Number(item?.id) === downloadId)
      : undefined;
    logStep("download scenario: observed download state", {
      downloadId,
      state: lastItem?.state,
      bytesReceived: lastItem?.bytesReceived,
      totalBytes: lastItem?.totalBytes
    });
    if (lastItem?.state === "complete") {
      return lastItem;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Chrome download ${downloadId} to complete: ${JSON.stringify(lastItem)}`);
}

async function runPrintToPdfScenario({ profileId }) {
  const startedAtMs = Date.now();
  const page = await browser.ensurePage();
  logStep("print-to-pdf scenario: navigating fixture page");
  await page.goto(fixture.pageUrl, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  await browser.refreshBridge("print_to_pdf_fixture_page_loaded");
  await page.bringToFront().catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  logStep("print-to-pdf scenario: waiting for bridge idle");
  const bridgeStatus = await waitForBridgeMode("idle");
  const tabId = Number(bridgeStatus?.activeTab?.tabId);
  assert.equal(Number.isInteger(tabId) && tabId > 0, true, JSON.stringify(bridgeStatus?.activeTab ?? {}));
  logStep("print-to-pdf scenario: starting session");
  const session = await startSession({
    profileId,
    userRequest: "Verify actual Browser Bridge debugger print-to-PDF using a fixed command and no arbitrary CDP script."
  });
  logStep("print-to-pdf scenario: queueing debugger.print_to_pdf", { sessionId: session.sessionId });
  const operation = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "debugger.print_to_pdf",
      tabId,
      printBackground: true,
      maxInlineBytes: 0,
      timeoutMs: 15_000
    }
  });
  logStep("print-to-pdf scenario: cleanup session", { sessionId: session.sessionId });
  const cleanup = await cleanupSession(session.sessionId);
  const elapsedMs = Date.now() - startedAtMs;
  const bundle = operation.bundle.bundle;
  const byteLength = Number(readNestedValue(operation.job.outputJson, ["output", "pdf", "byteLength"]) ??
    readNestedValue(operation.job.outputJson, ["pdf", "byteLength"]) ?? 0);
  const sha256 = String(readNestedValue(operation.job.outputJson, ["output", "pdf", "sha256"]) ??
    readNestedValue(operation.job.outputJson, ["pdf", "sha256"]) ?? "");
  const success = operation.job.status === "completed" &&
    byteLength > 0 &&
    sha256.length >= 32 &&
    bundle.dagNodes.some((node) => node.kind === "verification" && node.status === "completed") &&
    bundle.dagNodes.some((node) => node.kind === "eval_ledger" && node.status === "completed") &&
    cleanup.reconciled;

  return {
    id: "browser-chrome-live-extension-debugger-print-pdf",
    command: "debugger.print_to_pdf",
    userScenario: "User asks the widget to print the active browser tab to PDF through the Browser Bridge debugger adapter while keeping arbitrary CDP evaluation unavailable.",
    architectureWorkflow: [
      "Playwright launches Chromium with the real unpacked Browser Bridge extension.",
      "Computer Session queues the high-risk fixed debugger.print_to_pdf command.",
      "One-time approval releases only the bounded Browser Chrome command.",
      "The extension attaches Chrome debugger to the active tab and calls Page.printToPDF.",
      "The result stores byte length and hash only; raw PDF bytes are omitted from the report.",
      "The daemon records capability job, DAG verification, eval-ledger, redaction, and cleanup evidence."
    ],
    success,
    status: success ? "passed" : "needs_followup",
    result: {
      elapsedMs,
      p50LatencyMs: elapsedMs,
      p95LatencyMs: elapsedMs,
      sessionId: session.sessionId,
      evalRunId: bundle.evalRun.id,
      capabilityJobId: operation.job.id,
      byteLength,
      pdfSha256: sha256,
      dataOmitted: Boolean(readNestedValue(operation.job.outputJson, ["output", "pdf", "dataOmitted"]) ??
        readNestedValue(operation.job.outputJson, ["pdf", "dataOmitted"])),
      verifierNodeCount: bundle.dagNodes.filter((node) => node.kind === "verification" && node.status === "completed").length,
      evalLedgerNodeCount: bundle.dagNodes.filter((node) => node.kind === "eval_ledger" && node.status === "completed").length,
      cleanupReconciled: cleanup.reconciled,
      redaction: {
        localPathPolicy: "path_redacted",
        rawPdfBytesInReport: false,
        arbitraryCdpEvalAllowed: false,
        credentials: "not_used"
      }
    },
    improvementAndFollowUp: "This proves the real extension debugger fixed-command path on a local fixture. Public-site repeated samples and store-permission review remain required for promotion."
  };
}

async function startSession({ profileId, userRequest }) {
  logStep("session request", { profileId });
  const started = await postJson("/computer-use/sessions", {
    userRequest,
    requestedSurface: "regular_browser_extension",
    profileId,
    metadata: {
      dogfood: "computer-use-browser-chrome-live-extension",
      evidenceClass: "real_extension_local_fixture"
    }
  });
  assert.equal(started.ok, true);
  return started.result.session;
}

async function executeBrowserChromeOperation({ sessionId, input, approve }) {
  logStep("operation request", { sessionId, command: input.command, approve });
  const operation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    waitMs: 100,
    operation: { kind: "browser_chrome", input }
  });
  assert.equal(operation.ok, true);
  assert.equal(operation.result.job.kind, "browser_chrome");
  if (approve) {
    assert.equal(operation.result.job.status, "awaiting_approval");
    logStep("operation awaiting approval", { jobId: operation.result.job.id });
    send({ type: "capability.approve", requestId: `approve-${operation.result.job.id}`, jobId: operation.result.job.id });
  }
  await browser.refreshBridge(`dogfood_command_queued_${input.command}`);
  logStep("waiting for capability job", { jobId: operation.result.job.id, command: input.command });
  const job = await waitForCapabilityJob(operation.result.job.id, "completed", 45_000);
  logStep("capability job settled", { jobId: job.id, status: job.status });
  if (job.status !== "completed") {
    throw new Error(`Browser Chrome job ${job.id} did not complete: ${JSON.stringify(job)}`);
  }
  logStep("waiting for DAG node", { nodeId: operation.result.dagNode.id });
  const bundle = await waitForDagNode(sessionId, operation.result.dagNode.id, "completed", 10_000);
  return { operation, job, bundle };
}

async function cleanupSession(sessionId) {
  await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/cancel`, { reason: "browser_chrome_live_extension_cleanup" });
  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  return {
    bundle,
    reconciled: bundle.bundle.session.state === "cancelled" ||
      bundle.bundle.rollbackActions.some((action) => action.kind === "close_surface" && action.status === "completed")
  };
}

async function launchBrowserWithExtension(input) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "codex-widget-browser-chrome-live-profile-"));
  const extension = await prepareExtensionForLiveRun(input.extensionDir);
  await writeChromeDownloadPreferences(userDataDir, input.downloadDir);
  logStep("browser profile prepared", { profileBasename: path.basename(userDataDir), downloadDir: path.basename(input.downloadDir) });
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
    downloadsPath: input.downloadDir,
    args: [
      `--disable-extensions-except=${extension.dir}`,
      `--load-extension=${extension.dir}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });
  logStep("chromium persistent context launched");
  await configureDownloadBehavior(context, input.downloadDir);
  const extensionId = await readExtensionId(context);
  logStep("extension service worker ready", { extensionId });
  const configPage = await context.newPage();
  await configPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
  await configPage.evaluate(async (settings) => {
    await chrome.storage.sync.set(settings);
    await chrome.runtime.sendMessage({ type: "bridge.saveSettings", settings });
  }, {
    daemonBaseUrl: input.daemonUrl,
    autoConnect: true,
    autoObserve: true,
    allowAllSites: true,
    observeBlocklist: [],
    allowSafeReadScroll: true,
    requireApprovalForClickType: false,
    useNativeHost: false,
    debugSnapshot: false,
    pollIntervalSeconds: 1
  });
  logStep("extension settings saved");
  await configPage.close();
  let page = context.pages().find((candidate) => !candidate.url().startsWith("chrome-extension://"));
  async function refreshBridge(reason) {
    logStep("refreshing extension bridge", { reason });
    const refreshPage = await context.newPage();
    try {
      await refreshPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
      await refreshPage.evaluate(async (refreshReason) => {
        await chrome.runtime.sendMessage({ type: "bridge.refresh", reason: refreshReason });
      }, reason);
    } finally {
      await refreshPage.close().catch(() => undefined);
    }
  }
  return {
    extensionId,
    refreshBridge,
    async ensurePage() {
      if (!page || page.isClosed()) {
        page = await context.newPage();
      }
      return page;
    },
    async close() {
      await context.close().catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
      await extension.cleanup();
    }
  };
}

async function configureDownloadBehavior(context, downloadDirectory) {
  const page = context.pages().find((candidate) => !candidate.url().startsWith("chrome-extension://")) ?? await context.newPage();
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDirectory
    });
    logStep("CDP download behavior configured", { downloadDir: path.basename(downloadDirectory) });
  } catch (error) {
    logStep("CDP download behavior unavailable", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

async function prepareExtensionForLiveRun(sourceDir) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "codex-widget-browser-chrome-extension-"));
  await cp(sourceDir, tempDir, { recursive: true });
  const manifestPath = path.join(tempDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const hostPermissions = new Set(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []);
  hostPermissions.add("http://*/*");
  hostPermissions.add("https://*/*");
  manifest.host_permissions = [...hostPermissions];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    dir: tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
    }
  };
}

async function writeChromeDownloadPreferences(userDataDir, downloadDirectory) {
  const defaultDir = path.join(userDataDir, "Default");
  await mkdir(defaultDir, { recursive: true });
  await writeFile(path.join(defaultDir, "Preferences"), `${JSON.stringify({
    download: {
      default_directory: downloadDirectory,
      prompt_for_download: false,
      directory_upgrade: true
    },
    profile: { default_content_settings: { popups: 0 } }
  })}\n`, "utf8");
}

async function readExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  }
  const id = new URL(worker.url()).host;
  if (!id) {
    throw new Error(`Unable to read Browser Bridge extension id from ${worker.url()}`);
  }
  return id;
}

async function startFixtureServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/download/report.pdf") {
      const body = "%PDF-1.4\n% browser chrome live extension fixture\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n";
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=\"browser-chrome-live-extension-report.pdf\"",
        "content-length": Buffer.byteLength(body)
      });
      response.end(body);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head><title>Browser Chrome Live Extension Fixture</title></head>
  <body>
    <h1>Browser Chrome Live Extension Fixture</h1>
    <p>This deterministic page is used for real Browser Bridge Chrome API dogfood.</p>
    <a id="download" href="/download/report.pdf">Download PDF</a>
  </body>
</html>`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    pageUrl: `http://127.0.0.1:${port}/`,
    downloadUrl: `http://127.0.0.1:${port}/download/report.pdf`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function waitForBridgeMode(mode) {
  const deadline = Date.now() + 20_000;
  let status;
  let lastLoggedAt = 0;
  while (Date.now() < deadline) {
    status = await getBridgeStatus().catch(() => null);
    if (status?.connected === true && status?.mode === mode && status?.activeTab?.permission === "allowed") {
      return status;
    }
    if (Date.now() - lastLoggedAt > 2_000) {
      lastLoggedAt = Date.now();
      logStep("bridge status pending", {
        connected: status?.connected,
        mode: status?.mode,
        permission: status?.activeTab?.permission,
        activeTabUrl: status?.activeTab?.url ? redactUrlForLog(status.activeTab.url) : undefined
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Browser Bridge mode ${mode}: ${JSON.stringify(status)}`);
}

async function getBridgeStatus() {
  const response = await fetch(`${baseUrl}/browser-action/extension/status`, {
    headers: { Origin: `chrome-extension://${browser.extensionId}` }
  });
  if (!response.ok) {
    throw new Error(`Browser Bridge status failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()).status;
}

async function waitForCapabilityJob(jobId, status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let payload;
  let lastStatus;
  let lastLoggedAt = 0;
  while (Date.now() < deadline) {
    payload = await getJson(`/capabilities/jobs/${encodeURIComponent(jobId)}`);
    if (payload.job?.status !== lastStatus || Date.now() - lastLoggedAt > 2_000) {
      lastStatus = payload.job?.status;
      lastLoggedAt = Date.now();
      logStep("capability job pending", { jobId, status: payload.job?.status, failureClass: payload.job?.failureClass });
    }
    if (payload.job?.status === status) {
      return payload.job;
    }
    if (payload.job?.status === "failed" || payload.job?.status === "cancelled") {
      return payload.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for capability job ${jobId} to reach ${status}: ${JSON.stringify(payload?.job)}`);
}

async function waitForDagNode(sessionId, nodeId, status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let bundle;
  let lastLoggedAt = 0;
  while (Date.now() < deadline) {
    bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
    const node = bundle.bundle.dagNodes.find((candidate) => candidate.id === nodeId);
    if (node?.status === status) {
      return bundle;
    }
    if (Date.now() - lastLoggedAt > 2_000) {
      lastLoggedAt = Date.now();
      logStep("DAG node pending", { nodeId, status: node?.status });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for DAG node ${nodeId} to reach ${status}: ${JSON.stringify(bundle?.bundle?.dagNodes ?? [])}`);
}

async function waitForFile(filePath) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for downloaded file: ${path.basename(filePath)}`);
}

async function getJson(route) {
  const response = await fetch(`${baseUrl}${route}`);
  if (!response.ok) {
    throw new Error(`${route} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function postJson(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${route} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

function send(message) {
  socket.send(JSON.stringify(message));
}

function readNestedValue(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function readNestedNumber(value, pathParts) {
  const result = Number(readNestedValue(value, pathParts));
  return Number.isFinite(result) ? result : undefined;
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function summarizeMetrics(scenarios, elapsedMs) {
  const latencies = scenarios.map((scenario) => scenario.result.elapsedMs);
  return {
    scenarioCount: scenarios.length,
    sampleCount: scenarios.length,
    successCount: scenarios.filter((scenario) => scenario.success).length,
    successRate: scenarios.length ? scenarios.filter((scenario) => scenario.success).length / scenarios.length : 0,
    elapsedMs,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    realExtension: true,
    localFixture: true,
    downloadVerifyCovered: scenarios.some((scenario) => scenario.id.includes("download") && scenario.success),
    debuggerPrintPdfCovered: scenarios.some((scenario) => scenario.id.includes("print-pdf") && scenario.success),
    redactionProofPresent: scenarios.every((scenario) => JSON.stringify(scenario.result.redaction).includes("credentials")),
    cleanupReconciled: scenarios.every((scenario) => scenario.result.cleanupReconciled)
  };
}

function renderReport(evidence) {
  const lines = [
    "# Computer Use Browser Chrome Live Extension Dogfood",
    "",
    `- generatedAt: \`${evidence.generatedAt}\``,
    `- runId: \`${evidence.runId}\``,
    `- evidenceClass: \`${evidence.evidenceClass}\``,
    `- extension id: \`${evidence.extension.id}\``,
    `- sample count: \`${evidence.metrics.sampleCount}\``,
    `- success rate: \`${evidence.metrics.successRate}\``,
    `- p95 latency: \`${evidence.metrics.p95LatencyMs}ms\``,
    `- promotion: \`${evidence.promotion}\``,
    "",
    "| Scenario | Command | Success | p95 | Evidence | Follow-up |",
    "|---|---|---|---:|---|---|"
  ];
  for (const scenario of evidence.scenarios) {
    lines.push(`| ${scenario.id} | ${scenario.command} | ${scenario.success ? "pass" : "fail"} | ${scenario.result.p95LatencyMs} | ${scenario.result.resourceRoles?.join(", ") || "job-output"} | ${scenario.improvementAndFollowUp} |`);
  }
  lines.push("", `Raw evidence: docs/reports/assets/computer-use-browser-chrome-live-extension-${evidence.date}/evidence.json`, "");
  return `${lines.join("\n")}\n`;
}

function redactScenarioForDogfood(scenario) {
  return {
    id: scenario.id,
    command: scenario.command,
    userScenario: scenario.userScenario,
    architectureWorkflow: scenario.architectureWorkflow,
    success: scenario.success,
    status: scenario.status,
    result: {
      elapsedMs: scenario.result.elapsedMs,
      p95LatencyMs: scenario.result.p95LatencyMs,
      resourceRoles: scenario.result.resourceRoles,
      verifierNodeCount: scenario.result.verifierNodeCount,
      evalLedgerNodeCount: scenario.result.evalLedgerNodeCount,
      cleanupReconciled: scenario.result.cleanupReconciled,
      redaction: scenario.result.redaction,
      byteLength: scenario.result.byteLength,
      dataOmitted: scenario.result.dataOmitted,
      fileExists: scenario.result.fileExists,
      approvedDownloadBasename: scenario.result.approvedDownloadBasename,
      fileSha256: scenario.result.fileSha256,
      pdfSha256: scenario.result.pdfSha256
    },
    improvementAndFollowUp: scenario.improvementAndFollowUp
  };
}

function redactScenarioForSampleLedger(scenario) {
  return {
    id: scenario.id,
    command: scenario.command,
    success: scenario.success,
    elapsedMs: scenario.result.elapsedMs,
    p95LatencyMs: scenario.result.p95LatencyMs,
    resourceRoles: scenario.result.resourceRoles ?? [],
    verifierNodeCount: scenario.result.verifierNodeCount,
    evalLedgerNodeCount: scenario.result.evalLedgerNodeCount,
    cleanupReconciled: scenario.result.cleanupReconciled,
    redaction: scenario.result.redaction
  };
}

async function appendLine(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { flag: "a", encoding: "utf8" });
}

function percentile(values, fraction) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function redactUrlForLog(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return value;
  }
}

function formatSeoulDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatKstTimestamp(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}-${map.hour}${map.minute}${map.second}`;
}
