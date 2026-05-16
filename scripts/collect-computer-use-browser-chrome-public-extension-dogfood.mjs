#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const runId = `computer-use-browser-chrome-public-extension-${formatKstTimestamp(new Date())}`;
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `computer-use-browser-chrome-public-extension-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `computer-use-browser-chrome-public-extension-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `computer-use-browser-chrome-public-extension-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const sampleLedgerPath = join(repoRoot, "docs", "reports", "assets", "computer-use-browser-chrome-public-extension-runs.jsonl");
const extensionDir = path.resolve("providers/browser-dom-extension");
const repeatCount = Number(process.env.CODEX_WIDGET_BROWSER_CHROME_PUBLIC_REPEAT ?? 2);
const PUBLIC_PRINT_URL = "https://example.com/";
const PUBLIC_DOWNLOAD_URL = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";
const PUBLIC_UPLOAD_URL = "https://the-internet.herokuapp.com/upload";
const PUBLIC_PRINT_HOST = "example.com";
const PUBLIC_DOWNLOAD_HOST = "www.w3.org";
const PUBLIC_UPLOAD_HOST = "the-internet.herokuapp.com";
const PUBLIC_PERMISSION_TYPES = ["camera", "microphone", "location"];

function logStep(message, detail) {
  const suffix = detail === undefined ? "" : ` ${JSON.stringify(detail)}`;
  console.log(`[browser-chrome-public-extension] ${message}${suffix}`);
}

await rm(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
await mkdir(assetDir, { recursive: true });

const smokeAppData = useSmokeAppData("codex-widget-computer-use-browser-chrome-public-extension");
const downloadDir = join(smokeAppData.dir, "downloads");
const uploadDir = join(smokeAppData.dir, "uploads");
mkdirSync(downloadDir, { recursive: true });
mkdirSync(uploadDir, { recursive: true });

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
  logStep("navigating public print page", { host: PUBLIC_PRINT_HOST });
  await page.goto(PUBLIC_PRINT_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  await browser.refreshBridge("public_page_loaded");
  logStep("waiting for bridge idle");
  await waitForBridgeMode("idle");

  logStep("running live profile-approval scenario");
  const profileApproval = await runProfileApprovalScenario();
  const profile = profileApproval.profile;
  logStep("profile ready", { profileId: profile.id });

  const startedAtMs = Date.now();
  const scenarios = [];
  for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
    logStep("running public download scenario", { iteration });
    const downloadScenario = await runDownloadScenario({ profileId: profile.id, iteration });
    logStep("public download scenario complete", { iteration, success: downloadScenario.success, elapsedMs: downloadScenario.result.elapsedMs });
    scenarios.push(downloadScenario);
  }
  for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
    logStep("running public print-to-pdf scenario", { iteration });
    const printScenario = await runPrintToPdfScenario({ profileId: profile.id, iteration });
    logStep("public print-to-pdf scenario complete", { iteration, success: printScenario.success, elapsedMs: printScenario.result.elapsedMs });
    scenarios.push(printScenario);
  }
  for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
    logStep("running public tab-group scenario", { iteration });
    const tabGroupScenario = await runTabGroupScenario({ profileId: profile.id, iteration });
    logStep("public tab-group scenario complete", { iteration, success: tabGroupScenario.success, elapsedMs: tabGroupScenario.result.elapsedMs });
    scenarios.push(tabGroupScenario);
  }
  for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
    logStep("running public history-search scenario", { iteration });
    const historyScenario = await runHistorySearchScenario({ profileId: profile.id, iteration });
    logStep("public history-search scenario complete", { iteration, success: historyScenario.success, elapsedMs: historyScenario.result.elapsedMs });
    scenarios.push(historyScenario);
  }
  for (const permissionType of PUBLIC_PERMISSION_TYPES) {
    for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
      logStep("running public permission-setting scenario", { iteration, permissionType });
      const permissionScenario = await runPermissionSettingScenario({ profileId: profile.id, iteration, permissionType });
      logStep("public permission-setting scenario complete", { iteration, permissionType, success: permissionScenario.success, elapsedMs: permissionScenario.result.elapsedMs });
      scenarios.push(permissionScenario);
    }
  }
  for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
    logStep("running public multi-tab tab-group scenario", { iteration });
    const multiTabScenario = await runMultiTabGroupScenario({ profileId: profile.id, iteration });
    logStep("public multi-tab tab-group scenario complete", { iteration, success: multiTabScenario.success, elapsedMs: multiTabScenario.result.elapsedMs });
    scenarios.push(multiTabScenario);
  }
  for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
    logStep("running public file-upload scenario", { iteration });
    const fileUploadScenario = await runFileUploadScenario({ profileId: profile.id, iteration });
    logStep("public file-upload scenario complete", { iteration, success: fileUploadScenario.success, elapsedMs: fileUploadScenario.result.elapsedMs });
    scenarios.push(fileUploadScenario);
  }
  const elapsedMs = Date.now() - startedAtMs;
  const evidence = {
    schemaVersion: "computer-use-browser-chrome-public-extension-dogfood.v1",
    generatedAt: new Date().toISOString(),
    date: DATE,
    runId,
    evidenceClass: "real_extension_public_site_repeated",
    promotion: "public_site_repeated_browser_chrome_extension_gate",
    extension: {
      id: browser.extensionId,
      mode: "playwright_persistent_context",
      browserApiExecution: true
    },
    publicTargets: {
      hosts: [PUBLIC_PRINT_HOST, PUBLIC_DOWNLOAD_HOST, PUBLIC_UPLOAD_HOST],
      urls: "hashed_only"
    },
    metrics: summarizeMetrics(scenarios, elapsedMs, profileApproval.evidence),
    profileApproval: profileApproval.evidence,
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
    profileApproval: redactProfileApproval(evidence.profileApproval),
    scenarios: scenarios.map(redactScenarioForDogfood)
  }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");
  for (const scenario of scenarios) {
    await writeFile(join(assetDir, `${scenario.id}.debug-summary.json`), `${JSON.stringify(redactScenarioForDogfood(scenario), null, 2)}\n`, "utf8");
    await appendLine(sampleLedgerPath, {
      schemaVersion: "computer-use-browser-chrome-public-extension-sample.v1",
      generatedAt: evidence.generatedAt,
      date: DATE,
      runId,
      evidencePath: normalizePath(evidencePath),
      reportPath: normalizePath(reportPath),
      scenario: redactScenarioForSampleLedger(scenario)
    });
  }

  assert.equal(scenarios.every((scenario) => scenario.success), true);
  console.log(`computer use browser chrome public extension dogfood evidence written: ${reportPath}`);
} finally {
  logStep("cleaning up");
  socket.close();
  await browser.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function runProfileApprovalScenario() {
  const startedAtMs = Date.now();
  const blocked = await postJson("/computer-use/sessions", {
    userRequest: "Use the current browser profile through Browser Bridge without a preselected permission profile.",
    requestedSurface: "regular_browser_extension",
    metadata: {
      dogfood: "computer-use-browser-chrome-public-extension",
      evidenceClass: "real_extension_public_site_repeated",
      requiresBrowserProfile: true
    }
  });
  assert.equal(blocked.ok, true);
  const blockedSession = blocked.result.session;
  assert.equal(blockedSession.state, "blocked");
  const blockedBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(blockedSession.sessionId)}/debug-bundle`);
  const missingRequirements = collectMissingRequirements(blockedBundle.bundle);
  const missingGrantTypes = [...new Set(missingRequirements.map((requirement) => requirement.type).filter(Boolean))].sort();

  const profilePayload = await postJson("/computer-use/autonomy/profiles", {
    name: "Browser Chrome public extension scoped profile",
    mode: "scoped_yolo",
    scope: "one_time",
    maxUses: 64,
    grants: {
      network: false,
      networkDomains: [],
      browserAutomation: true,
      browserDomains: [PUBLIC_PRINT_HOST, PUBLIC_DOWNLOAD_HOST, PUBLIC_UPLOAD_HOST, "w3.org"],
      filesystem: { readRoots: [downloadDir, uploadDir], writeRoots: [downloadDir] },
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
    },
    safetyBoundaries: ["browser_profile_access_explicit", "public_extension_dogfood_only"]
  });
  assert.equal(profilePayload.ok, true);
  assert.equal(profilePayload.profile.scope, "one_time");

  const attached = await postJson(`/computer-use/sessions/${encodeURIComponent(blockedSession.sessionId)}/profile`, {
    profileId: profilePayload.profile.id,
    source: "browser_chrome_public_extension_profile_approval_dogfood",
    reason: "Attach a narrow one-time Browser Chrome profile after an exact missing-grant block."
  });
  assert.equal(attached.ok, true);
  assert.equal(attached.session.profileId, profilePayload.profile.id);
  const attachedBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(blockedSession.sessionId)}/debug-bundle`);
  const attachedDecisionPresent = attachedBundle.bundle.safetyDecisions.some((decision) =>
    decision?.decision === "profile_attached" &&
    decision.profileId === profilePayload.profile.id &&
    decision.profileScope === "one_time" &&
    decision.source === "browser_chrome_public_extension_profile_approval_dogfood"
  );
  const evalRunId = attachedBundle.bundle.session?.evalRunId;
  const evalRunPayload = evalRunId
    ? await getJson(`/computer-use/eval/runs/${encodeURIComponent(evalRunId)}`)
    : { steps: [] };
  const attachedEvalStepPresent = Array.isArray(evalRunPayload.steps) &&
    evalRunPayload.steps.some((step) =>
      step.kind === "permission_profile_attached" &&
      step.status === "completed" &&
      step.output?.profileScope === "one_time"
    );
  const cleanup = await cleanupSession(blockedSession.sessionId);
  const elapsedMs = Date.now() - startedAtMs;
  const success = missingGrantTypes.includes("browser_automation") &&
    missingGrantTypes.includes("risk_class") &&
    attachedDecisionPresent &&
    attachedEvalStepPresent &&
    cleanup.reconciled;

  return {
    profile: profilePayload.profile,
    evidence: {
      id: "browser-chrome-public-extension-profile-approval",
      status: success ? "passed" : "needs_followup",
      success,
      elapsedMs,
      sourceHost: PUBLIC_PRINT_HOST,
      sourceUrlHash: sha256Text(PUBLIC_PRINT_URL),
      blockedSessionId: blockedSession.sessionId,
      attachedProfileId: profilePayload.profile.id,
      profileScope: profilePayload.profile.scope,
      profileMode: profilePayload.profile.mode,
      maxUses: profilePayload.profile.maxUses,
      missingGrantTypes,
      exactMissingGrantCount: missingRequirements.length,
      attachedDecisionPresent,
      attachedEvalStepPresent,
      cleanupReconciled: cleanup.reconciled,
      redaction: {
        blockedGrantEvidence: "types_only",
        profileGrantEvidence: "domains_and_roots_only",
        urls: "public_url_hash_only",
        credentials: "not_used"
      }
    }
  };
}

async function runDownloadScenario({ profileId, iteration }) {
  const startedAtMs = Date.now();
  const filename = `browser-chrome-public-extension-w3c-dummy-${iteration}.pdf`;
  const approvedDownloadPath = join(downloadDir, filename);
  logStep("public download scenario: starting session", { iteration });
  const session = await startSession({
    profileId,
    userRequest: "Verify an actual Browser Bridge extension download workflow against a public unauthenticated PDF and persist approved download evidence."
  });

  logStep("public download scenario: queueing download.start", { sessionId: session.sessionId, iteration });
  const start = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "download.start",
      url: PUBLIC_DOWNLOAD_URL,
      filename,
      conflictAction: "overwrite",
      timeoutMs: 30_000
    }
  });
  const downloadId = readNestedNumber(start.job.outputJson, ["output", "download", "id"]) ??
    readNestedNumber(start.job.outputJson, ["download", "id"]);
  assert.equal(Number.isInteger(downloadId) && downloadId > 0, true, JSON.stringify(start.job.outputJson));
  logStep("public download scenario: waiting for approved file", { downloadId, basename: filename });
  await waitForFile(approvedDownloadPath);
  await waitForDownloadComplete(session.sessionId, downloadId);

  logStep("public download scenario: queueing download.verify", { downloadId });
  const verify = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: false,
    input: {
      command: "download.verify",
      id: downloadId,
      expectedState: "complete",
      approvedDownloadPath,
      timeoutMs: 30_000
    }
  });
  logStep("public download scenario: cleanup session", { sessionId: session.sessionId });
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
    id: `browser-chrome-public-extension-download-verify-${iteration}`,
    command: "download.start+download.verify",
    userScenario: "User asks the widget to start a public unauthenticated browser download through the installed Browser Bridge path and verify the completed file with approved artifact evidence.",
    architectureWorkflow: [
      "Playwright launches Chromium with the real unpacked Browser Bridge extension.",
      "The extension service worker connects to the daemon and polls Browser Chrome commands.",
      "Computer Session runs download.start against a public W3C PDF URL through the regular_browser_extension surface and one-time approval.",
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
      sourceHost: PUBLIC_DOWNLOAD_HOST,
      sourceUrlHash: sha256Text(PUBLIC_DOWNLOAD_URL),
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
        urls: "public_url_hash_only",
        credentials: "not_used"
      }
    },
    improvementAndFollowUp: "This proves the real extension and Chrome downloads API path on a repeated public unauthenticated PDF target."
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
    logStep("public download scenario: observed download state", {
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

async function runPrintToPdfScenario({ profileId, iteration }) {
  const startedAtMs = Date.now();
  const page = await browser.ensurePage();
  logStep("public print-to-pdf scenario: navigating public page", { iteration, host: PUBLIC_PRINT_HOST });
  await page.goto(PUBLIC_PRINT_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  await browser.refreshBridge("print_to_pdf_public_page_loaded");
  await page.bringToFront().catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  logStep("public print-to-pdf scenario: waiting for bridge idle");
  const bridgeStatus = await waitForBridgeMode("idle");
  const tabId = Number(bridgeStatus?.activeTab?.tabId);
  assert.equal(Number.isInteger(tabId) && tabId > 0, true, JSON.stringify(bridgeStatus?.activeTab ?? {}));
  logStep("public print-to-pdf scenario: starting session", { iteration });
  const session = await startSession({
    profileId,
    userRequest: "Verify actual Browser Bridge debugger print-to-PDF on a public unauthenticated page using a fixed command and no arbitrary CDP script."
  });
  logStep("public print-to-pdf scenario: queueing debugger.print_to_pdf", { sessionId: session.sessionId, iteration });
  const operation = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "debugger.print_to_pdf",
      tabId,
      printBackground: true,
      maxInlineBytes: 0,
      timeoutMs: 30_000
    }
  });
  logStep("public print-to-pdf scenario: cleanup session", { sessionId: session.sessionId });
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
    id: `browser-chrome-public-extension-debugger-print-pdf-${iteration}`,
    command: "debugger.print_to_pdf",
    userScenario: "User asks the widget to print a public unauthenticated browser tab to PDF through the Browser Bridge debugger adapter while keeping arbitrary CDP evaluation unavailable.",
    architectureWorkflow: [
      "Playwright launches Chromium with the real unpacked Browser Bridge extension.",
      "Computer Session queues the high-risk fixed debugger.print_to_pdf command.",
      "One-time approval releases only the bounded Browser Chrome command.",
      "The extension attaches Chrome debugger to the allowed public page tab and calls Page.printToPDF.",
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
      sourceHost: PUBLIC_PRINT_HOST,
      sourceUrlHash: sha256Text(PUBLIC_PRINT_URL),
      byteLength,
      pdfSha256: sha256,
      dataOmitted: Boolean(readNestedValue(operation.job.outputJson, ["output", "pdf", "dataOmitted"]) ??
        readNestedValue(operation.job.outputJson, ["pdf", "dataOmitted"])),
      verifierNodeCount: bundle.dagNodes.filter((node) => node.kind === "verification" && node.status === "completed").length,
      evalLedgerNodeCount: bundle.dagNodes.filter((node) => node.kind === "eval_ledger" && node.status === "completed").length,
      cleanupReconciled: cleanup.reconciled,
      redaction: {
        localPathPolicy: "path_redacted",
        urls: "public_url_hash_only",
        rawPdfBytesInReport: false,
        arbitraryCdpEvalAllowed: false,
        credentials: "not_used"
      }
    },
    improvementAndFollowUp: "This proves the real extension debugger fixed-command path on a repeated public unauthenticated page."
  };
}

async function runTabGroupScenario({ profileId, iteration }) {
  const startedAtMs = Date.now();
  const page = await browser.ensurePage();
  logStep("public tab-group scenario: navigating public page", { iteration, host: PUBLIC_PRINT_HOST });
  await page.goto(PUBLIC_PRINT_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  await browser.refreshBridge("tab_group_public_page_loaded");
  await page.bringToFront().catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  const bridgeStatus = await waitForBridgeMode("idle");
  const tabId = Number(bridgeStatus?.activeTab?.tabId);
  assert.equal(Number.isInteger(tabId) && tabId > 0, true, JSON.stringify(bridgeStatus?.activeTab ?? {}));
  logStep("public tab-group scenario: starting session", { iteration, tabId });
  const session = await startSession({
    profileId,
    userRequest: "Verify Browser Bridge tab group claim, update, and release on a dogfood-owned public tab."
  });
  const owner = `codex-public-${runId}-${iteration}`.slice(0, 80);
  const claim = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "tab_group.claim",
      tabId,
      owner,
      runId,
      threadId: `public-extension-${iteration}`,
      title: `Codex Public ${iteration}`,
      color: "green",
      timeoutMs: 15_000
    }
  });
  const groupId = readNestedNumber(claim.job.outputJson, ["output", "group", "id"]) ??
    readNestedNumber(claim.job.outputJson, ["group", "id"]);
  assert.equal(Number.isInteger(groupId) && groupId >= 0, true, JSON.stringify(claim.job.outputJson));
  const update = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "tab_group.update",
      groupId,
      title: `Codex Public ${iteration} Done`,
      color: "blue",
      collapsed: false,
      timeoutMs: 15_000
    }
  });
  const release = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "tab_group.release",
      tabIds: [tabId],
      timeoutMs: 15_000
    }
  });
  logStep("public tab-group scenario: cleanup session", { sessionId: session.sessionId });
  const cleanup = await cleanupSession(session.sessionId);
  const elapsedMs = Date.now() - startedAtMs;
  const bundle = release.bundle.bundle;
  const releasedTabIds = readNestedValue(release.job.outputJson, ["output", "releasedTabIds"]) ??
    readNestedValue(release.job.outputJson, ["releasedTabIds"]) ?? [];
  const success = claim.job.status === "completed" &&
    update.job.status === "completed" &&
    release.job.status === "completed" &&
    Number.isInteger(groupId) &&
    Array.isArray(releasedTabIds) &&
    releasedTabIds.map(Number).includes(tabId) &&
    bundle.dagNodes.some((node) => node.kind === "verification" && node.status === "completed") &&
    bundle.dagNodes.some((node) => node.kind === "eval_ledger" && node.status === "completed") &&
    cleanup.reconciled;

  return {
    id: `browser-chrome-public-extension-tab-group-${iteration}`,
    command: "tab_group.claim+update+release",
    userScenario: "User asks the widget to claim the current public tab into a dogfood-owned tab group, update its label, and release it again.",
    architectureWorkflow: [
      "Playwright keeps a public unauthenticated tab active under the real Browser Bridge extension.",
      "Computer Session queues tab_group.claim with a dogfood owner and one-time side-effect approval.",
      "The extension groups only the target tab id reported by the allowed bridge status.",
      "Computer Session queues tab_group.update to prove bounded group mutation.",
      "Computer Session queues tab_group.release to restore the tab outside the group.",
      "The daemon records capability jobs, DAG verification, eval-ledger, redaction, and cleanup evidence."
    ],
    success,
    status: success ? "passed" : "needs_followup",
    result: {
      elapsedMs,
      p50LatencyMs: elapsedMs,
      p95LatencyMs: elapsedMs,
      sessionId: session.sessionId,
      evalRunId: bundle.evalRun.id,
      claimJobId: claim.job.id,
      updateJobId: update.job.id,
      releaseJobId: release.job.id,
      sourceHost: PUBLIC_PRINT_HOST,
      sourceUrlHash: sha256Text(PUBLIC_PRINT_URL),
      groupId,
      releaseCount: releasedTabIds.length,
      verifierNodeCount: bundle.dagNodes.filter((node) => node.kind === "verification" && node.status === "completed").length,
      evalLedgerNodeCount: bundle.dagNodes.filter((node) => node.kind === "eval_ledger" && node.status === "completed").length,
      cleanupReconciled: cleanup.reconciled,
      redaction: {
        tabOwnership: "dogfood_owned_tab",
        urls: "public_url_hash_only",
        credentials: "not_used"
      }
    },
    improvementAndFollowUp: "This proves bounded tab group claim/update/release through the real extension on a repeated public unauthenticated tab."
  };
}

async function runHistorySearchScenario({ profileId, iteration }) {
  const startedAtMs = Date.now();
  const page = await browser.ensurePage();
  logStep("public history-search scenario: seeding fresh profile history", { iteration, host: PUBLIC_PRINT_HOST });
  await page.goto(PUBLIC_PRINT_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await browser.refreshBridge("history_search_public_page_loaded");
  await waitForBridgeMode("idle");
  logStep("public history-search scenario: starting session", { iteration });
  const session = await startSession({
    profileId,
    userRequest: "Verify one-time Browser Bridge history search on a fresh dogfood browser profile with redacted URL path evidence only."
  });
  const operation = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "history.search",
      text: "Example Domain",
      maxResults: 10,
      startTime: Date.now() - 10 * 60 * 1000,
      timeoutMs: 15_000
    }
  });
  logStep("public history-search scenario: cleanup session", { sessionId: session.sessionId });
  const cleanup = await cleanupSession(session.sessionId);
  const elapsedMs = Date.now() - startedAtMs;
  const bundle = operation.bundle.bundle;
  const items = readHistoryItems(operation.job.outputJson);
  const matchingItems = items.filter((item) => readHistoryItemHost(item) === PUBLIC_PRINT_HOST);
  const pathRedactedCount = items.filter((item) => item?.pathRedacted === true).length;
  const metadataRisk = String(readNestedValue(operation.job.outputJson, ["metadata", "risk"]) ??
    readNestedValue(operation.job.outputJson, ["output", "metadata", "risk"]) ?? "");
  const metadataApproval = String(readNestedValue(operation.job.outputJson, ["metadata", "approval"]) ??
    readNestedValue(operation.job.outputJson, ["output", "metadata", "approval"]) ?? "");
  const success = operation.job.status === "completed" &&
    matchingItems.length >= 1 &&
    items.length >= 1 &&
    pathRedactedCount === items.length &&
    metadataRisk === "high" &&
    metadataApproval === "one_time" &&
    bundle.dagNodes.some((node) => node.kind === "verification" && node.status === "completed") &&
    bundle.dagNodes.some((node) => node.kind === "eval_ledger" && node.status === "completed") &&
    cleanup.reconciled;

  return {
    id: `browser-chrome-public-extension-history-search-${iteration}`,
    command: "history.search",
    userScenario: "User asks the widget to search recent browser history from a dogfood-owned fresh browser profile and return only redacted host/hash evidence.",
    architectureWorkflow: [
      "Playwright launches Chromium with a fresh temporary profile and the real unpacked Browser Bridge extension.",
      "The dogfood harness first visits a public unauthenticated page to create profile-local history.",
      "Computer Session queues the high-risk history.search command and requires one-time approval.",
      "The extension calls chrome.history.search and normalizes each result with URL paths redacted.",
      "The dogfood evidence stores only host counts, URL hash, approval metadata, DAG verification, eval-ledger, and cleanup proof.",
      "The user profile is never read; the temporary browser profile is deleted during cleanup."
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
      sourceHost: PUBLIC_PRINT_HOST,
      sourceUrlHash: sha256Text(PUBLIC_PRINT_URL),
      historyItemCount: items.length,
      matchingHostCount: matchingItems.length,
      pathRedactedCount,
      approval: metadataApproval,
      risk: metadataRisk,
      verifierNodeCount: bundle.dagNodes.filter((node) => node.kind === "verification" && node.status === "completed").length,
      evalLedgerNodeCount: bundle.dagNodes.filter((node) => node.kind === "eval_ledger" && node.status === "completed").length,
      cleanupReconciled: cleanup.reconciled,
      redaction: {
        history: "one_time_fresh_profile_path_redacted",
        browserProfile: "dogfood_fresh_profile_only",
        urls: "public_url_hash_only",
        credentials: "not_used"
      }
    },
    improvementAndFollowUp: "This proves high-risk history search can run through the real extension with one-time approval and redacted evidence, without touching the user's real browser profile."
  };
}

async function runPermissionSettingScenario({ profileId, iteration, permissionType }) {
  const startedAtMs = Date.now();
  const page = await browser.ensurePage();
  logStep("public permission-setting scenario: navigating public page", { iteration, permissionType, host: PUBLIC_PRINT_HOST });
  await page.goto(PUBLIC_PRINT_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await browser.refreshBridge("permission_setting_public_page_loaded");
  await waitForBridgeMode("idle");
  logStep("public permission-setting scenario: starting session", { iteration });
  const session = await startSession({
    profileId,
    userRequest: "Verify bounded Browser Bridge content setting read, one-time site permission mutation, and rollback on a fresh dogfood browser profile."
  });
  const permissionBase = {
    type: permissionType,
    url: PUBLIC_PRINT_URL,
    timeoutMs: 15_000
  };
  const initial = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: false,
    input: {
      command: "permission.get",
      ...permissionBase
    }
  });
  const initialPermission = readPermissionOutput(initial.job.outputJson);
  const initialSetting = isPermissionSetting(initialPermission.setting) ? initialPermission.setting : "ask";
  const setBlock = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "permission.set",
      ...permissionBase,
      setting: "block",
      scope: "regular"
    }
  });
  const blockPermission = readPermissionOutput(setBlock.job.outputJson);
  const afterBlock = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: false,
    input: {
      command: "permission.get",
      ...permissionBase
    }
  });
  const afterBlockPermission = readPermissionOutput(afterBlock.job.outputJson);
  const rollback = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "permission.set",
      ...permissionBase,
      setting: initialSetting,
      scope: "regular"
    }
  });
  const rollbackPermission = readPermissionOutput(rollback.job.outputJson);
  const afterRollback = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: false,
    input: {
      command: "permission.get",
      ...permissionBase
    }
  });
  const afterRollbackPermission = readPermissionOutput(afterRollback.job.outputJson);
  logStep("public permission-setting scenario: cleanup session", { sessionId: session.sessionId });
  const cleanup = await cleanupSession(session.sessionId);
  const elapsedMs = Date.now() - startedAtMs;
  const bundle = rollback.bundle.bundle;
  const setMetadata = readMetadataOutput(setBlock.job.outputJson);
  const rollbackMetadata = readMetadataOutput(rollback.job.outputJson);
  const success = initial.job.status === "completed" &&
    setBlock.job.status === "completed" &&
    afterBlock.job.status === "completed" &&
    rollback.job.status === "completed" &&
    afterRollback.job.status === "completed" &&
    initialPermission.type === permissionType &&
    blockPermission.verifiedSetting === "block" &&
    afterBlockPermission.setting === "block" &&
    rollbackPermission.verifiedSetting === initialSetting &&
    afterRollbackPermission.setting === initialSetting &&
    setMetadata.risk === "high" &&
    setMetadata.approval === "one_time" &&
    rollbackMetadata.risk === "high" &&
    rollbackMetadata.approval === "one_time" &&
    setMetadata.nativePopupClick === false &&
    rollbackMetadata.nativePopupClick === false &&
    bundle.dagNodes.some((node) => node.kind === "verification" && node.status === "completed") &&
    bundle.dagNodes.some((node) => node.kind === "eval_ledger" && node.status === "completed") &&
    cleanup.reconciled;

  return {
    id: `browser-chrome-public-extension-permission-setting-${permissionType}-${iteration}`,
    command: "permission.get+set+rollback",
    userScenario: `User asks the widget to inspect the ${permissionType} site permission, apply a bounded one-time setting change, and roll it back on a dogfood-owned browser profile.`,
    architectureWorkflow: [
      "Playwright launches Chromium with a fresh temporary profile and the real unpacked Browser Bridge extension.",
      "Computer Session reads the current site permission through permission.get without native browser chrome clicks.",
      "Computer Session queues high-risk permission.set for only the public page origin and requires one-time approval.",
      `The extension uses Chrome contentSettings to apply the bounded ${permissionType} setting, then Computer Session verifies it with permission.get.`,
      "Computer Session queues a second one-time permission.set to restore the initial setting and verifies rollback.",
      "The dogfood evidence stores only host, setting values, approval metadata, popup-click=false proof, DAG/eval proof, and cleanup proof."
    ],
    success,
    status: success ? "passed" : "needs_followup",
    result: {
      elapsedMs,
      p50LatencyMs: elapsedMs,
      p95LatencyMs: elapsedMs,
      sessionId: session.sessionId,
      evalRunId: bundle.evalRun.id,
      initialJobId: initial.job.id,
      setJobId: setBlock.job.id,
      rollbackJobId: rollback.job.id,
      sourceHost: PUBLIC_PRINT_HOST,
      sourceUrlHash: sha256Text(PUBLIC_PRINT_URL),
      permissionType,
      permissionHost: PUBLIC_PRINT_HOST,
      permissionPattern: "host_scoped_wildcard",
      initialSetting,
      appliedSetting: blockPermission.verifiedSetting,
      verifiedAfterSet: afterBlockPermission.setting,
      rollbackSetting: rollbackPermission.verifiedSetting,
      verifiedAfterRollback: afterRollbackPermission.setting,
      approval: setMetadata.approval,
      risk: setMetadata.risk,
      nativePopupClick: setMetadata.nativePopupClick === true ? true : false,
      popupWorkflow: setMetadata.popupWorkflow,
      verifierNodeCount: bundle.dagNodes.filter((node) => node.kind === "verification" && node.status === "completed").length,
      evalLedgerNodeCount: bundle.dagNodes.filter((node) => node.kind === "eval_ledger" && node.status === "completed").length,
      cleanupReconciled: cleanup.reconciled,
      redaction: {
        sitePermission: "host_only_no_path",
        rollback: "restored_to_initial_setting",
        browserProfile: "dogfood_fresh_profile_only",
        urls: "public_url_hash_only",
        credentials: "not_used"
      }
    },
    improvementAndFollowUp: `This proves ${permissionType} site permission mutation can use the Chrome contentSettings API with one-time approval, bounded origin scope, and rollback proof instead of coordinate-clicking browser chrome.`
  };
}

async function runMultiTabGroupScenario({ profileId, iteration }) {
  const startedAtMs = Date.now();
  const firstPage = await browser.ensurePage();
  logStep("public multi-tab tab-group scenario: preparing first tab", { iteration, host: PUBLIC_PRINT_HOST });
  await firstPage.goto(PUBLIC_PRINT_URL, { waitUntil: "domcontentloaded" });
  await firstPage.bringToFront().catch(() => undefined);
  await browser.refreshBridge("multi_tab_group_first_page_loaded");
  const firstStatus = await waitForBridgeMode("idle");
  const firstTabId = Number(firstStatus?.activeTab?.tabId);
  assert.equal(Number.isInteger(firstTabId) && firstTabId > 0, true, JSON.stringify(firstStatus?.activeTab ?? {}));
  const secondPage = await browser.newPage();
  try {
    logStep("public multi-tab tab-group scenario: preparing second tab", { iteration, host: PUBLIC_PRINT_HOST });
    await secondPage.goto(PUBLIC_PRINT_URL, { waitUntil: "domcontentloaded" });
    await secondPage.bringToFront().catch(() => undefined);
    await browser.refreshBridge("multi_tab_group_second_page_loaded");
    const secondStatus = await waitForBridgeMode("idle");
    const secondTabId = Number(secondStatus?.activeTab?.tabId);
    assert.equal(Number.isInteger(secondTabId) && secondTabId > 0 && secondTabId !== firstTabId, true, JSON.stringify(secondStatus?.activeTab ?? {}));
    logStep("public multi-tab tab-group scenario: starting session", { iteration, firstTabId, secondTabId });
    const session = await startSession({
      profileId,
      userRequest: "Verify Browser Bridge can claim, label, and release a dogfood-owned multi-tab group on public pages."
    });
    const owner = `codex-public-multitab-${runId}-${iteration}`.slice(0, 80);
    const claim = await executeBrowserChromeOperation({
      sessionId: session.sessionId,
      approve: true,
      input: {
        command: "tab_group.claim",
        tabIds: [firstTabId, secondTabId],
        owner,
        runId,
        threadId: `public-extension-multitab-${iteration}`,
        title: `Codex Multi ${iteration}`,
        color: "cyan",
        timeoutMs: 15_000
      }
    });
    const groupId = readNestedNumber(claim.job.outputJson, ["output", "group", "id"]) ??
      readNestedNumber(claim.job.outputJson, ["group", "id"]);
    assert.equal(Number.isInteger(groupId) && groupId >= 0, true, JSON.stringify(claim.job.outputJson));
    const update = await executeBrowserChromeOperation({
      sessionId: session.sessionId,
      approve: true,
      input: {
        command: "tab_group.update",
        groupId,
        title: `Codex Multi ${iteration} Done`,
        color: "green",
        collapsed: false,
        timeoutMs: 15_000
      }
    });
    const release = await executeBrowserChromeOperation({
      sessionId: session.sessionId,
      approve: true,
      input: {
        command: "tab_group.release",
        tabIds: [firstTabId, secondTabId],
        timeoutMs: 15_000
      }
    });
    logStep("public multi-tab tab-group scenario: cleanup session", { sessionId: session.sessionId });
    const cleanup = await cleanupSession(session.sessionId);
    const elapsedMs = Date.now() - startedAtMs;
    const bundle = release.bundle.bundle;
    const releasedTabIds = readNestedValue(release.job.outputJson, ["output", "releasedTabIds"]) ??
      readNestedValue(release.job.outputJson, ["releasedTabIds"]) ?? [];
    const releasedSet = new Set(Array.isArray(releasedTabIds) ? releasedTabIds.map(Number) : []);
    const success = claim.job.status === "completed" &&
      update.job.status === "completed" &&
      release.job.status === "completed" &&
      Number.isInteger(groupId) &&
      releasedSet.has(firstTabId) &&
      releasedSet.has(secondTabId) &&
      bundle.dagNodes.some((node) => node.kind === "verification" && node.status === "completed") &&
      bundle.dagNodes.some((node) => node.kind === "eval_ledger" && node.status === "completed") &&
      cleanup.reconciled;

    return {
      id: `browser-chrome-public-extension-multi-tab-group-${iteration}`,
      command: "tab_group.multi_tab_claim+update+release",
      userScenario: "User asks the widget to organize two public browser tabs into a dogfood-owned group, label it, and release both tabs.",
      architectureWorkflow: [
        "Playwright opens two public unauthenticated tabs in a fresh temporary Chromium profile with the real Browser Bridge extension.",
        "The extension bridge reports each active tab id after the dogfood harness brings it to front.",
        "Computer Session queues tab_group.claim with both dogfood-owned tab ids and one-time side-effect approval.",
        "The extension groups only the two explicit tab ids and returns the created group id.",
        "Computer Session updates the group label/color, then releases both tabs back out of the group.",
        "Evidence stores tab counts and host/hash proof only, plus verifier/eval nodes and cleanup reconciliation."
      ],
      success,
      status: success ? "passed" : "needs_followup",
      result: {
        elapsedMs,
        p50LatencyMs: elapsedMs,
        p95LatencyMs: elapsedMs,
        sessionId: session.sessionId,
        evalRunId: bundle.evalRun.id,
        claimJobId: claim.job.id,
        updateJobId: update.job.id,
        releaseJobId: release.job.id,
        sourceHost: PUBLIC_PRINT_HOST,
        sourceUrlHash: sha256Text(PUBLIC_PRINT_URL),
        groupId,
        tabCount: 2,
        releaseCount: releasedSet.size,
        verifierNodeCount: bundle.dagNodes.filter((node) => node.kind === "verification" && node.status === "completed").length,
        evalLedgerNodeCount: bundle.dagNodes.filter((node) => node.kind === "eval_ledger" && node.status === "completed").length,
        cleanupReconciled: cleanup.reconciled,
        redaction: {
          tabOwnership: "dogfood_owned_multi_tab",
          urls: "public_url_hash_only",
          credentials: "not_used"
        }
      },
      improvementAndFollowUp: "This proves tab-group orchestration can handle multiple explicit public tab ids through the real extension while avoiding arbitrary browser-profile state."
    };
  } finally {
    await secondPage.close().catch(() => undefined);
  }
}

async function runFileUploadScenario({ profileId, iteration }) {
  const startedAtMs = Date.now();
  const page = await browser.ensurePage();
  const uploadBasename = `codex-public-upload-${iteration}.txt`;
  const approvedFilePath = join(uploadDir, uploadBasename);
  await writeFile(approvedFilePath, `Codex public file upload dogfood ${iteration}\n`, "utf8");
  logStep("public file-upload scenario: navigating public upload page", { iteration, host: PUBLIC_UPLOAD_HOST });
  await page.goto(PUBLIC_UPLOAD_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await browser.refreshBridge("file_upload_public_page_loaded");
  const bridgeStatus = await waitForBridgeMode("idle");
  const tabId = Number(bridgeStatus?.activeTab?.tabId);
  assert.equal(Number.isInteger(tabId) && tabId > 0, true, JSON.stringify(bridgeStatus?.activeTab ?? {}));
  logStep("public file-upload scenario: starting session", { iteration, tabId });
  const session = await startSession({
    profileId,
    userRequest: "Verify Browser Bridge file upload inspect, explicit approved file selection, and clear rollback on a public file-input page."
  });
  const inspect = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "file_upload.inspect",
      tabId,
      selector: "#file-upload",
      timeoutMs: 15_000
    }
  });
  const inputs = readFileUploadInputs(inspect.job.outputJson);
  const targetInput = inputs.find((item) => item?.id === "file-upload" || item?.name === "file");
  const setFiles = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "file_upload.set_files",
      tabId,
      selector: "#file-upload",
      approvedFilePaths: [approvedFilePath],
      timeoutMs: 20_000
    }
  });
  const selectedFiles = readFileUploadFiles(setFiles.job.outputJson);
  const clearFiles = await executeBrowserChromeOperation({
    sessionId: session.sessionId,
    approve: true,
    input: {
      command: "file_upload.clear",
      tabId,
      selector: "#file-upload",
      timeoutMs: 20_000
    }
  });
  logStep("public file-upload scenario: cleanup session", { sessionId: session.sessionId });
  const cleanup = await cleanupSession(session.sessionId);
  const elapsedMs = Date.now() - startedAtMs;
  const bundle = clearFiles.bundle.bundle;
  const inspectMetadata = readMetadataOutput(inspect.job.outputJson);
  const setMetadata = readMetadataOutput(setFiles.job.outputJson);
  const clearMetadata = readMetadataOutput(clearFiles.job.outputJson);
  const selectedBasenames = selectedFiles.map((file) => typeof file?.basename === "string" ? file.basename : "").filter(Boolean);
  const success = inspect.job.status === "completed" &&
    setFiles.job.status === "completed" &&
    clearFiles.job.status === "completed" &&
    Boolean(targetInput) &&
    selectedBasenames.includes(uploadBasename) &&
    selectedFiles.every((file) => file?.pathRedacted === true) &&
    inspectMetadata.approval === "one_time" &&
    setMetadata.approval === "one_time" &&
    clearMetadata.approval === "one_time" &&
    setMetadata.verification === "file_upload_files_selected" &&
    clearMetadata.verification === "file_upload_files_cleared" &&
    bundle.dagNodes.some((node) => node.kind === "verification" && node.status === "completed") &&
    bundle.dagNodes.some((node) => node.kind === "eval_ledger" && node.status === "completed") &&
    cleanup.reconciled;

  return {
    id: `browser-chrome-public-extension-file-upload-${iteration}`,
    command: "file_upload.inspect+set_files+clear",
    userScenario: "User asks the widget to inspect a public upload control, select an explicitly approved local file, and clear it without submitting the form.",
    architectureWorkflow: [
      "Playwright opens a public unauthenticated upload page in a fresh temporary Chromium profile with the real Browser Bridge extension.",
      "Computer Session queues file_upload.inspect and requires one-time approval before reading file-input metadata.",
      "The dogfood harness creates an approved temporary file under the run-owned upload root.",
      "Computer Session queues file_upload.set_files with the explicit approved path; capability persistence redacts the path.",
      "The extension uses the fixed DOM.setFileInputFiles debugger command against the explicit file input selector.",
      "Computer Session queues file_upload.clear as rollback and records only basename/path-redacted proof plus verifier/eval nodes."
    ],
    success,
    status: success ? "passed" : "needs_followup",
    result: {
      elapsedMs,
      p50LatencyMs: elapsedMs,
      p95LatencyMs: elapsedMs,
      sessionId: session.sessionId,
      evalRunId: bundle.evalRun.id,
      inspectJobId: inspect.job.id,
      setFilesJobId: setFiles.job.id,
      clearFilesJobId: clearFiles.job.id,
      sourceHost: PUBLIC_UPLOAD_HOST,
      sourceUrlHash: sha256Text(PUBLIC_UPLOAD_URL),
      inputCount: inputs.length,
      targetInputFound: Boolean(targetInput),
      selectedFileCount: selectedFiles.length,
      selectedBasenames,
      clearStatus: readNestedValue(clearFiles.job.outputJson, ["output", "status"]) ??
        readNestedValue(clearFiles.job.outputJson, ["output", "output", "status"]) ??
        readNestedValue(clearFiles.job.outputJson, ["status"]),
      approval: setMetadata.approval,
      risk: setMetadata.risk,
      pathRedacted: selectedFiles.every((file) => file?.pathRedacted === true),
      submitClicked: false,
      verifierNodeCount: bundle.dagNodes.filter((node) => node.kind === "verification" && node.status === "completed").length,
      evalLedgerNodeCount: bundle.dagNodes.filter((node) => node.kind === "eval_ledger" && node.status === "completed").length,
      cleanupReconciled: cleanup.reconciled,
      redaction: {
        localPathPolicy: "basename_only",
        fullPathStoredInReport: false,
        fileContentsStoredInReport: false,
        uploadSubmit: "not_submitted",
        urls: "public_url_hash_only",
        credentials: "not_used"
      }
    },
    improvementAndFollowUp: "This proves approved file selection can use the fixed Browser Bridge file-upload command with basename-only evidence and clear rollback; native picker automation remains blocked until signed helper v2."
  };
}

async function startSession({ profileId, userRequest }) {
  logStep("session request", { profileId });
  const started = await postJson("/computer-use/sessions", {
    userRequest,
    requestedSurface: "regular_browser_extension",
    profileId,
    metadata: {
      dogfood: "computer-use-browser-chrome-public-extension",
      evidenceClass: "real_extension_public_site_repeated"
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
  await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/cancel`, { reason: "browser_chrome_public_extension_cleanup" });
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
    async newPage() {
      return await context.newPage();
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

async function waitForBridgeMode(mode) {
  const deadline = Date.now() + 20_000;
  let status;
  let lastLoggedAt = 0;
  while (Date.now() < deadline) {
    status = await getJson("/browser-action/extension/status").then((payload) => payload.status).catch(() => null);
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
  const deadline = Date.now() + 30_000;
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

function readHistoryItems(outputJson) {
  const items = readNestedValue(outputJson, ["output", "items"]) ??
    readNestedValue(outputJson, ["output", "output", "items"]) ??
    readNestedValue(outputJson, ["items"]) ?? [];
  return Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [];
}

function readHistoryItemHost(item) {
  const origin = typeof item?.origin === "string" ? item.origin : "";
  const redactedUrl = typeof item?.url === "string" ? item.url : "";
  for (const value of [origin, redactedUrl]) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname) {
        return parsed.hostname;
      }
    } catch {
      // Keep looking at other redacted fields.
    }
  }
  return "";
}

function readPermissionOutput(outputJson) {
  const permission = readNestedValue(outputJson, ["output", "permission"]) ??
    readNestedValue(outputJson, ["output", "output", "permission"]) ??
    readNestedValue(outputJson, ["permission"]) ?? {};
  return permission && typeof permission === "object" ? permission : {};
}

function collectMissingRequirements(bundle) {
  const records = [];
  for (const decision of bundle?.safetyDecisions ?? []) {
    if (Array.isArray(decision?.missingRequirements)) {
      records.push(...decision.missingRequirements);
    }
  }
  for (const node of bundle?.dagNodes ?? []) {
    if (Array.isArray(node?.output?.missingRequirements)) {
      records.push(...node.output.missingRequirements);
    }
  }
  return records
    .filter((record) => record && typeof record === "object")
    .map((record) => ({
      type: String(record.type ?? ""),
      value: record.value === undefined ? undefined : String(record.value),
      reason: record.reason === undefined ? undefined : String(record.reason)
    }));
}

function readFileUploadInputs(outputJson) {
  const inputs = readNestedValue(outputJson, ["output", "inputs"]) ??
    readNestedValue(outputJson, ["output", "output", "inputs"]) ??
    readNestedValue(outputJson, ["inputs"]) ?? [];
  return Array.isArray(inputs) ? inputs.filter((item) => item && typeof item === "object") : [];
}

function readFileUploadFiles(outputJson) {
  const files = readNestedValue(outputJson, ["output", "files"]) ??
    readNestedValue(outputJson, ["output", "output", "files"]) ??
    readNestedValue(outputJson, ["files"]) ?? [];
  return Array.isArray(files) ? files.filter((item) => item && typeof item === "object") : [];
}

function readMetadataOutput(outputJson) {
  const metadata = readNestedValue(outputJson, ["metadata"]) ??
    readNestedValue(outputJson, ["output", "metadata"]) ?? {};
  return metadata && typeof metadata === "object" ? metadata : {};
}

function isPermissionSetting(value) {
  return value === "allow" || value === "block" || value === "ask";
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function summarizeMetrics(scenarios, elapsedMs, profileApproval) {
  const latencies = scenarios.map((scenario) => scenario.result.elapsedMs);
  const publicHosts = [...new Set(scenarios.map((scenario) => scenario.result.sourceHost).filter(Boolean))].sort();
  return {
    scenarioCount: scenarios.length,
    sampleCount: scenarios.length,
    successCount: scenarios.filter((scenario) => scenario.success).length,
    successRate: scenarios.length ? scenarios.filter((scenario) => scenario.success).length / scenarios.length : 0,
    elapsedMs,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    realExtension: true,
    localFixture: false,
    publicSite: true,
    repeatedSamples: scenarios.length >= 4,
    publicHosts,
    requiredHostsPresent: publicHosts.includes(PUBLIC_PRINT_HOST) && publicHosts.includes(PUBLIC_DOWNLOAD_HOST) && publicHosts.includes(PUBLIC_UPLOAD_HOST),
    permissionTypesCovered: [...new Set(scenarios
      .filter((scenario) => scenario.command === "permission.get+set+rollback" && scenario.success)
      .map((scenario) => scenario.result.permissionType)
      .filter(Boolean))].sort(),
    profileApprovalCovered: profileApproval?.success === true &&
      Array.isArray(profileApproval.missingGrantTypes) &&
      profileApproval.missingGrantTypes.includes("browser_automation") &&
      profileApproval.missingGrantTypes.includes("risk_class") &&
      profileApproval.attachedDecisionPresent === true &&
      profileApproval.attachedEvalStepPresent === true,
    downloadVerifyCovered: scenarios.some((scenario) => scenario.id.includes("download") && scenario.success),
    debuggerPrintPdfCovered: scenarios.some((scenario) => scenario.id.includes("print-pdf") && scenario.success),
    tabGroupCovered: scenarios.some((scenario) => scenario.id.includes("tab-group") && scenario.success),
    historySearchCovered: scenarios.some((scenario) => scenario.id.includes("history-search") && scenario.success),
    permissionSettingCovered: scenarios.some((scenario) => scenario.id.includes("permission-setting") && scenario.success),
    multiTabGroupCovered: scenarios.some((scenario) => scenario.id.includes("multi-tab-group") && scenario.success),
    fileUploadCovered: scenarios.some((scenario) => scenario.id.includes("file-upload") && scenario.success),
    redactionProofPresent: scenarios.every((scenario) =>
      JSON.stringify(scenario.result.redaction).includes("credentials") &&
      scenario.result.redaction?.urls === "public_url_hash_only" &&
      typeof scenario.result.sourceUrlHash === "string"
    ),
    cleanupReconciled: scenarios.every((scenario) => scenario.result.cleanupReconciled)
  };
}

function renderReport(evidence) {
  const lines = [
    "# Computer Use Browser Chrome Public Extension Dogfood",
    "",
    `- generatedAt: \`${evidence.generatedAt}\``,
    `- runId: \`${evidence.runId}\``,
    `- evidenceClass: \`${evidence.evidenceClass}\``,
    `- extension id: \`${evidence.extension.id}\``,
    `- public hosts: \`${evidence.metrics.publicHosts.join(", ")}\``,
    `- sample count: \`${evidence.metrics.sampleCount}\``,
    `- success rate: \`${evidence.metrics.successRate}\``,
    `- p95 latency: \`${evidence.metrics.p95LatencyMs}ms\``,
    `- profile approval: \`${evidence.metrics.profileApprovalCovered ? "covered" : "missing"}\``,
    `- promotion: \`${evidence.promotion}\``,
    "",
    "| Scenario | Host | Command | Success | p95 | Evidence | Follow-up |",
    "|---|---|---|---|---:|---|---|"
  ];
  for (const scenario of evidence.scenarios) {
    lines.push(`| ${scenario.id} | ${scenario.result.sourceHost} | ${scenario.command} | ${scenario.success ? "pass" : "fail"} | ${scenario.result.p95LatencyMs} | ${scenario.result.resourceRoles?.join(", ") || "job-output"} | ${scenario.improvementAndFollowUp} |`);
  }
  lines.push("", `Raw evidence: docs/reports/assets/computer-use-browser-chrome-public-extension-${evidence.date}/evidence.json`, "");
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
      sourceHost: scenario.result.sourceHost,
      sourceUrlHash: scenario.result.sourceUrlHash,
      verifierNodeCount: scenario.result.verifierNodeCount,
      evalLedgerNodeCount: scenario.result.evalLedgerNodeCount,
      cleanupReconciled: scenario.result.cleanupReconciled,
      redaction: scenario.result.redaction,
      byteLength: scenario.result.byteLength,
      dataOmitted: scenario.result.dataOmitted,
      fileExists: scenario.result.fileExists,
      approvedDownloadBasename: scenario.result.approvedDownloadBasename,
      fileSha256: scenario.result.fileSha256,
      pdfSha256: scenario.result.pdfSha256,
      historyItemCount: scenario.result.historyItemCount,
      matchingHostCount: scenario.result.matchingHostCount,
      pathRedactedCount: scenario.result.pathRedactedCount,
      approval: scenario.result.approval,
      risk: scenario.result.risk,
      permissionType: scenario.result.permissionType,
      permissionHost: scenario.result.permissionHost,
      permissionPattern: scenario.result.permissionPattern,
      initialSetting: scenario.result.initialSetting,
      appliedSetting: scenario.result.appliedSetting,
      verifiedAfterSet: scenario.result.verifiedAfterSet,
      rollbackSetting: scenario.result.rollbackSetting,
      verifiedAfterRollback: scenario.result.verifiedAfterRollback,
      nativePopupClick: scenario.result.nativePopupClick,
      popupWorkflow: scenario.result.popupWorkflow,
      tabCount: scenario.result.tabCount,
      releaseCount: scenario.result.releaseCount,
      inputCount: scenario.result.inputCount,
      targetInputFound: scenario.result.targetInputFound,
      selectedFileCount: scenario.result.selectedFileCount,
      selectedBasenames: scenario.result.selectedBasenames,
      clearStatus: scenario.result.clearStatus,
      pathRedacted: scenario.result.pathRedacted,
      submitClicked: scenario.result.submitClicked
    },
    improvementAndFollowUp: scenario.improvementAndFollowUp
  };
}

function redactProfileApproval(profileApproval) {
  if (!profileApproval || typeof profileApproval !== "object") {
    return undefined;
  }
  return {
    id: profileApproval.id,
    status: profileApproval.status,
    success: profileApproval.success,
    elapsedMs: profileApproval.elapsedMs,
    sourceHost: profileApproval.sourceHost,
    sourceUrlHash: profileApproval.sourceUrlHash,
    profileScope: profileApproval.profileScope,
    profileMode: profileApproval.profileMode,
    maxUses: profileApproval.maxUses,
    missingGrantTypes: profileApproval.missingGrantTypes,
    exactMissingGrantCount: profileApproval.exactMissingGrantCount,
    attachedDecisionPresent: profileApproval.attachedDecisionPresent,
    attachedEvalStepPresent: profileApproval.attachedEvalStepPresent,
    cleanupReconciled: profileApproval.cleanupReconciled,
    redaction: profileApproval.redaction
  };
}

function redactScenarioForSampleLedger(scenario) {
  return {
    id: scenario.id,
    command: scenario.command,
    success: scenario.success,
    elapsedMs: scenario.result.elapsedMs,
    p95LatencyMs: scenario.result.p95LatencyMs,
    sourceHost: scenario.result.sourceHost,
    sourceUrlHash: scenario.result.sourceUrlHash,
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
