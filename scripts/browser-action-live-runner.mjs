import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { chromium } from "@playwright/test";
import { createServer as createViteServer } from "vite";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = process.env.CODEX_WIDGET_AUTH_MODE || "mock";

const DEFAULT_SCENARIOS = path.resolve("docs/dogfood/browser-action-live-scenarios.jsonl");
const DEFAULT_EXTENSION_DIR = path.resolve("providers/browser-dom-extension");
const DEFAULT_DAEMON_URL = "http://127.0.0.1:4128";
const DEFAULT_OUTPUT_ROOT = path.resolve("docs/reports/assets/browser-action-live");
const SAFE_REAL_MODE_STRING_KEYS = new Set([
  "adapterId",
  "artifactDir",
  "graphDigest",
  "leaseId",
  "mutationRevision",
  "outputDir",
  "reportPath",
  "routeKey",
  "runId",
  "scenarioId",
  "sessionId",
  "tabId",
  "tabKey",
  "viewRevision",
  "windowId"
]);

const options = parseArgs(process.argv.slice(2));
const runId = options.runId || `browser-action-live-${formatKstTimestamp(new Date())}`;
const outputDir = path.resolve(options.outputDir || path.join(DEFAULT_OUTPUT_ROOT, runId));
const reportPath = path.resolve(options.report || path.join("docs/reports", `browser-action-live-report-${runId}.md`));

await mkdir(outputDir, { recursive: true });

const scenarios = (await readScenarios(options.scenarios))
  .filter((scenario) => scenarioMatchesMode(scenario, options.mode))
  .filter((scenario) => options.scenario.size === 0 || options.scenario.has(scenario.id));

if (scenarios.length === 0) {
  throw new Error(`No Browser Action live scenarios selected from ${options.scenarios}.`);
}

if (options.dryRun) {
  const dryRun = {
    runId,
    mode: options.mode,
    scenarioCount: scenarios.length,
    scenarios: scenarios.map((scenario) => ({ id: scenario.id, mode: scenario.mode, prompt: scenario.prompt }))
  };
  await writeJson(path.join(outputDir, "dry-run.json"), dryRun);
  await writeFile(reportPath, renderReport({ runId, mode: options.mode, results: [], dryRun }), "utf8");
  console.log(`browser action live runner dry-run ok: ${scenarios.length} scenario(s), report=${reportPath}`);
  process.exit(0);
}

const result = options.mode === "real"
  ? await runRealBrowserMode(scenarios)
  : options.mode === "widget-ui"
    ? await runWidgetUiMode(scenarios)
    : await runIsolatedMode(scenarios);

await writeJson(path.join(outputDir, "run-result.json"), result);
await writeFile(reportPath, renderReport(result), "utf8");

const failed = result.results.filter((item) => item.status !== "pass");
console.log(`browser action live runner ${failed.length === 0 ? "ok" : "completed with failures"}: report=${reportPath}`);
if (failed.length > 0 && !options.allowFailures) {
  process.exitCode = 1;
}

async function runIsolatedMode(scenarios) {
  const smokeAppData = useSmokeAppData("codex-widget-browser-action-live");
  const daemon = await startDaemon({ port: options.daemonPort });
  const daemonUrl = `http://127.0.0.1:${daemon.port}`;
  const fixture = await startFixtureServer();
  const browser = await launchIsolatedBrowser({
    daemonUrl,
    extensionDir: options.extensionDir,
    grantAllSitePermission: options.grantAllSitePermission,
    headless: options.headless
  });
  const socket = await connectDaemonSocket(daemonUrl);
  const results = [];

  try {
    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      const page = await browser.ensurePage();
      const scenarioResult = await runScenario({
        scenario,
        daemonUrl,
        socket,
        page,
        fixture,
        scenarioIndex: index,
        realMode: false
      });
      results.push(scenarioResult);
      console.log(`[${scenarioResult.status}] ${scenario.id} ${scenarioResult.failureClass ? `(${scenarioResult.failureClass})` : ""}`);
    }
  } finally {
    socket.close();
    await browser.close();
    await fixture.close();
    await daemon.close();
    smokeAppData.cleanup();
  }

  return {
    runId,
    mode: "isolated",
    daemonUrl,
    outputDir,
    reportPath,
    startedAt: new Date().toISOString(),
    results
  };
}

async function runRealBrowserMode(scenarios) {
  const daemonUrl = options.daemonUrl;
  await assertDaemonHealthy(daemonUrl);
  const socket = await connectDaemonSocket(daemonUrl);
  const results = [];

  try {
    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      console.log(`[real] ${scenario.id}: keep the active browser tab untouched until this scenario completes.`);
      const scenarioResult = await runScenario({
        scenario,
        daemonUrl,
        socket,
        page: null,
        fixture: null,
        scenarioIndex: index,
        realMode: true
      });
      results.push(scenarioResult);
      console.log(`[${scenarioResult.status}] ${scenario.id} ${scenarioResult.failureClass ? `(${scenarioResult.failureClass})` : ""}`);
    }
  } finally {
    socket.close();
  }

  return {
    runId,
    mode: "real",
    daemonUrl,
    outputDir,
    reportPath,
    startedAt: new Date().toISOString(),
    results
  };
}

async function runWidgetUiMode(scenarios) {
  const smokeAppData = useSmokeAppData("codex-widget-browser-action-widget-ui-live");
  const daemon = await startDaemon({ port: options.daemonPort });
  const daemonUrl = `http://127.0.0.1:${daemon.port}`;
  const fixture = await startFixtureServer();
  const renderer = await startWidgetRendererServer();
  const targetBrowser = await launchIsolatedBrowser({
    daemonUrl,
    extensionDir: options.extensionDir,
    grantAllSitePermission: options.grantAllSitePermission,
    headless: options.headless
  });
  const widgetBrowser = await launchWidgetBrowser({ rendererUrl: renderer.url, daemonPort: daemon.port, headless: options.headless });
  const monitorSocket = await connectDaemonSocket(daemonUrl);
  const results = [];

  try {
    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      const page = await targetBrowser.ensurePage();
      const scenarioResult = await runWidgetUiScenario({
        scenario,
        daemonUrl,
        monitorSocket,
        targetPage: page,
        widgetPage: widgetBrowser.page,
        fixture,
        scenarioIndex: index
      });
      results.push(scenarioResult);
      console.log(`[${scenarioResult.status}] ${scenario.id} ${scenarioResult.failureClass ? `(${scenarioResult.failureClass})` : ""}`);
    }
  } finally {
    monitorSocket.close();
    await widgetBrowser.close();
    await targetBrowser.close();
    await renderer.close();
    await fixture.close();
    await daemon.close();
    smokeAppData.cleanup();
  }

  return {
    runId,
    mode: "widget-ui",
    daemonUrl,
    rendererUrl: renderer.url,
    outputDir,
    reportPath,
    startedAt: new Date().toISOString(),
    results
  };
}

async function runWidgetUiScenario(input) {
  let startedAt = Date.now();
  const scenarioDir = path.join(outputDir, safeFileName(input.scenario.id));
  const events = [];
  const beforeStatus = await readBridgeStatus(input.daemonUrl).catch((error) => ({ error: readError(error) }));
  let beforeScreenshot = "";
  let afterScreenshot = "";
  let beforeWidgetScreenshot = "";
  let afterWidgetScreenshot = "";
  let finalUrl = "";
  let finalText = "";
  let answer = "";
  let failureClass = "";
  let status = "pass";
  let scenarioBridgeStatus = beforeStatus;

  await mkdir(scenarioDir, { recursive: true });
  await writeJson(path.join(scenarioDir, "scenario.json"), sanitizeArtifact(input.scenario, { realMode: false }));
  await writeJson(path.join(scenarioDir, "bridge-status-before.json"), sanitizeArtifact(beforeStatus, { realMode: false }));

  const stopCollecting = collectSocketEvents(input.monitorSocket, events);
  try {
    if (input.targetPage && (input.scenario.url || Array.isArray(input.scenario.setupUrls))) {
      const setupUrls = Array.isArray(input.scenario.setupUrls) && input.scenario.setupUrls.length > 0
        ? input.scenario.setupUrls
        : [input.scenario.url];
      let targetUrl = "";
      for (const setupUrl of setupUrls) {
        targetUrl = resolveScenarioUrl(setupUrl, input.fixture);
        await input.targetPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      }
      if (input.scenario.setupHistoryBack) {
        await input.targetPage.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
        targetUrl = input.targetPage.url();
      }
      await input.targetPage.bringToFront();
      await input.targetPage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      scenarioBridgeStatus = await waitForBridgeActiveTab(input.daemonUrl, targetUrl, 12_000);
      beforeScreenshot = path.join(scenarioDir, "screenshot-before.png");
      await input.targetPage.screenshot({ path: beforeScreenshot, fullPage: true }).catch(() => {
        beforeScreenshot = "";
      });
    }

    await input.widgetPage.bringToFront();
    await waitForWidgetReady(input.widgetPage);
    beforeWidgetScreenshot = path.join(scenarioDir, "widget-before.png");
    await input.widgetPage.screenshot({ path: beforeWidgetScreenshot, fullPage: true }).catch(() => {
      beforeWidgetScreenshot = "";
    });

    const assistantCountBefore = await input.widgetPage.locator(".assistant-message").count();
    await submitWidgetPrompt(input.widgetPage, resolveScenarioPrompt(input.scenario.prompt, input.fixture));
    startedAt = Date.now();
    await maybeRespondToWidgetApproval(input.widgetPage, input.scenario, startedAt);
    await input.targetPage.bringToFront();
    answer = await waitForWidgetAssistantAnswer(input.widgetPage, {
      assistantCountBefore,
      scenario: input.scenario,
      startedAt
    });

    await input.targetPage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    finalUrl = input.targetPage.url();
    finalText = await input.targetPage.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    afterScreenshot = path.join(scenarioDir, "screenshot-after.png");
    await input.targetPage.screenshot({ path: afterScreenshot, fullPage: true }).catch(() => {
      afterScreenshot = "";
    });
    afterWidgetScreenshot = path.join(scenarioDir, "widget-after.png");
    await input.widgetPage.screenshot({ path: afterWidgetScreenshot, fullPage: true }).catch(() => {
      afterWidgetScreenshot = "";
    });

    const assertion = assertScenario({
      scenario: input.scenario,
      answer,
      finalUrl,
      finalText,
      elapsedMs: Date.now() - startedAt,
      events,
      bridgeStatus: scenarioBridgeStatus
    });
    if (!assertion.ok) {
      status = "fail";
      failureClass = assertion.failureClass;
    }
  } catch (error) {
    status = "fail";
    failureClass = classifyFailure({ error, answer, events, bridgeStatus: scenarioBridgeStatus });
    answer = answer || readError(error);
    if (input.targetPage) {
      finalUrl = input.targetPage.url();
      finalText = await input.targetPage.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
      afterScreenshot = path.join(scenarioDir, "screenshot-after.png");
      await input.targetPage.screenshot({ path: afterScreenshot, fullPage: true }).catch(() => {
        afterScreenshot = "";
      });
    }
  } finally {
    stopCollecting();
  }

  const afterStatus = await readBridgeStatus(input.daemonUrl).catch((error) => ({ error: readError(error) }));
  await writeJson(path.join(scenarioDir, "bridge-status-after.json"), sanitizeArtifact(afterStatus, { realMode: false }));
  await writeFile(path.join(scenarioDir, "daemon-events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : ""), "utf8");
  await writeJson(path.join(scenarioDir, "result.json"), {
    scenarioId: input.scenario.id,
    status,
    failureClass,
    elapsedMs: Date.now() - startedAt,
    finalUrl,
    answer,
    answerRedacted: false,
    answerLength: answer.length,
    screenshots: {
      before: beforeScreenshot ? path.relative(process.cwd(), beforeScreenshot) : undefined,
      after: afterScreenshot ? path.relative(process.cwd(), afterScreenshot) : undefined,
      widgetBefore: beforeWidgetScreenshot ? path.relative(process.cwd(), beforeWidgetScreenshot) : undefined,
      widgetAfter: afterWidgetScreenshot ? path.relative(process.cwd(), afterWidgetScreenshot) : undefined
    }
  });

  return {
    id: input.scenario.id,
    mode: "widget-ui",
    prompt: resolveScenarioPrompt(input.scenario.prompt, input.fixture),
    status,
    failureClass,
    elapsedMs: Date.now() - startedAt,
    finalUrl,
    answerPreview: answer.slice(0, 500),
    artifactDir: path.relative(process.cwd(), scenarioDir).replace(/\\/g, "/")
  };
}

async function runScenario(input) {
  let startedAt = Date.now();
  const requestId = `browser-action-live-${input.scenario.id}-${Date.now()}-${input.scenarioIndex}`;
  const scenarioDir = path.join(outputDir, safeFileName(input.scenario.id));
  const events = [];
  const beforeStatus = await readBridgeStatus(input.daemonUrl).catch((error) => ({ error: readError(error) }));
  let beforeScreenshot = "";
  let afterScreenshot = "";
  let finalUrl = "";
  let finalText = "";
  let answer = "";
  let failureClass = "";
  let status = "pass";
  let scenarioBridgeStatus = beforeStatus;

  await mkdir(scenarioDir, { recursive: true });
  await writeJson(path.join(scenarioDir, "scenario.json"), sanitizeArtifact(input.scenario, { realMode: input.realMode }));
  await writeJson(path.join(scenarioDir, "bridge-status-before.json"), sanitizeArtifact(beforeStatus, { realMode: input.realMode }));

  try {
    if (input.page && (input.scenario.url || Array.isArray(input.scenario.setupUrls))) {
      const setupUrls = Array.isArray(input.scenario.setupUrls) && input.scenario.setupUrls.length > 0
        ? input.scenario.setupUrls
        : [input.scenario.url];
      let targetUrl = "";
      for (const setupUrl of setupUrls) {
        targetUrl = resolveScenarioUrl(setupUrl, input.fixture);
        await input.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      }
      if (input.scenario.setupHistoryBack) {
        await input.page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
        targetUrl = input.page.url();
      }
      await input.page.bringToFront();
      await input.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      scenarioBridgeStatus = await waitForBridgeActiveTab(input.daemonUrl, targetUrl, 12_000);
      beforeScreenshot = path.join(scenarioDir, "screenshot-before.png");
      await input.page.screenshot({ path: beforeScreenshot, fullPage: true }).catch(() => {
        beforeScreenshot = "";
      });
    }

    const completed = waitForSocketEvent(input.socket, {
      predicate: (event) => {
        events.push(event);
        if (event.type === "interaction.required" && event.interaction?.requestId === requestId) {
          const decision = readInteractionDecision(event.interaction, input.scenario);
          input.socket.send(JSON.stringify({ type: "interaction.respond", id: event.interaction.id, decision }));
        }
        return event.type === "message.completed" && event.id === requestId;
      },
      label: `message.completed:${requestId}`,
      timeoutMs: readMaxMs(input.scenario)
    });

    input.socket.send(JSON.stringify({
      type: "ask",
      id: requestId,
      text: resolveScenarioPrompt(input.scenario.prompt, input.fixture),
      mode: "browser"
    }));
    startedAt = Date.now();

    const message = await completed;
    answer = String(message.text ?? "");
    if (input.page && input.scenario.approval) {
      const followupCompleted = waitForSocketEvent(input.socket, {
        predicate: (event) => {
          events.push(event);
          return event.type === "message.completed" && event.id === requestId && String(event.text ?? "") !== answer;
        },
        label: `post-approval message.completed:${requestId}`,
        timeoutMs: Math.max(2_000, readMaxMs(input.scenario) - (Date.now() - startedAt))
      }).catch(() => null);
      await waitForApprovedScenarioEffect(input.page, input.scenario, Date.now() - startedAt).catch(() => undefined);
      const followup = await Promise.race([
        followupCompleted,
        sleep(2_000).then(() => null)
      ]);
      if (followup?.text) {
        answer = String(followup.text);
      }
    }
    if (input.page) {
      await input.page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
      finalUrl = input.page.url();
      finalText = await input.page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      afterScreenshot = path.join(scenarioDir, "screenshot-after.png");
      await input.page.screenshot({ path: afterScreenshot, fullPage: true }).catch(() => {
        afterScreenshot = "";
      });
    }

    const assertion = assertScenario({
      scenario: input.scenario,
      answer,
      finalUrl,
      finalText,
      elapsedMs: Date.now() - startedAt,
      events,
      bridgeStatus: scenarioBridgeStatus
    });
    if (!assertion.ok) {
      status = "fail";
      failureClass = assertion.failureClass;
    }
  } catch (error) {
    status = "fail";
    failureClass = classifyFailure({ error, answer, events, bridgeStatus: scenarioBridgeStatus });
    answer = answer || readError(error);
    if (input.page) {
      finalUrl = input.page.url();
      finalText = await input.page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
      afterScreenshot = path.join(scenarioDir, "screenshot-after.png");
      await input.page.screenshot({ path: afterScreenshot, fullPage: true }).catch(() => {
        afterScreenshot = "";
      });
    }
  }

  const afterStatus = await readBridgeStatus(input.daemonUrl).catch((error) => ({ error: readError(error) }));
  await writeJson(path.join(scenarioDir, "bridge-status-after.json"), sanitizeArtifact(afterStatus, { realMode: input.realMode }));
  const artifactEvents = sanitizeArtifact(events, { realMode: input.realMode });
  await writeFile(path.join(scenarioDir, "daemon-events.jsonl"), artifactEvents.map((event) => JSON.stringify(event)).join("\n") + (artifactEvents.length ? "\n" : ""), "utf8");
  await writeJson(path.join(scenarioDir, "result.json"), {
    scenarioId: input.scenario.id,
    requestId,
    status,
    failureClass,
    elapsedMs: Date.now() - startedAt,
    finalUrl: redactRealModeString(finalUrl, { realMode: input.realMode, label: "finalUrl" }),
    answer: redactRealModeString(answer, { realMode: input.realMode, label: "answer" }),
    answerRedacted: input.realMode && Boolean(answer),
    answerLength: answer.length,
    screenshots: {
      before: beforeScreenshot ? path.relative(process.cwd(), beforeScreenshot) : undefined,
      after: afterScreenshot ? path.relative(process.cwd(), afterScreenshot) : undefined
    }
  });

  return {
    id: input.scenario.id,
    mode: input.scenario.mode,
    prompt: resolveScenarioPrompt(input.scenario.prompt, input.fixture),
    status,
    failureClass,
    elapsedMs: Date.now() - startedAt,
    finalUrl: redactRealModeString(finalUrl, { realMode: input.realMode, label: "finalUrl" }),
    answerPreview: redactRealModeString(answer.slice(0, 500), { realMode: input.realMode, label: "answerPreview" }),
    artifactDir: path.relative(process.cwd(), scenarioDir).replace(/\\/g, "/")
  };
}

function sanitizeArtifact(value, options, key = "") {
  if (!options.realMode || value == null) {
    return value;
  }
  if (typeof value === "string") {
    return shouldKeepRealModeStringKey(key, value) ? value : redactRealModeString(value, { ...options, label: key || "text" });
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeArtifact(item, options, key));
  }
  if (typeof value === "object") {
    const sanitized = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitized[entryKey] = sanitizeArtifact(entryValue, options, entryKey);
    }
    return sanitized;
  }
  return value;
}

function shouldKeepRealModeStringKey(key, value) {
  const normalizedKey = String(key);
  if (/^https?:\/\//i.test(value)) {
    return false;
  }
  if (SAFE_REAL_MODE_STRING_KEYS.has(normalizedKey)) {
    return true;
  }
  if (/^(.*Id|id|type|status|mode|level|category|provider|action|decision|risk|freshness|stability)$/i.test(normalizedKey)) {
    return true;
  }
  if (/^(createdAt|capturedAt|expiresAt|startedAt|endedAt|timestamp)$/i.test(normalizedKey)) {
    return true;
  }
  if (/^(reasonCodes?)$/i.test(normalizedKey)) {
    return true;
  }
  return false;
}

function redactRealModeString(value, options) {
  if (!options.realMode || !value) {
    return value;
  }
  return `[redacted real-browser ${options.label || "value"}; ${String(value).length} chars]`;
}


async function waitForApprovedScenarioEffect(page, scenario, elapsedMs) {
  const remainingMs = Math.max(500, readMaxMs(scenario) - elapsedMs);
  const expectedUrlParts = scenario.expect?.urlIncludes ?? [];
  if (expectedUrlParts.length === 0) {
    await page.waitForTimeout(Math.min(remainingMs, 1_000));
    return;
  }
  const deadline = Date.now() + remainingMs;
  while (Date.now() < deadline) {
    const current = page.url();
    if (expectedUrlParts.every((part) => current.includes(part))) {
      return;
    }
    await page.waitForTimeout(200);
  }
}

function assertScenario(input) {
  const expect = input.scenario.expect ?? {};
  if (readMaxMs(input.scenario) && input.elapsedMs > readMaxMs(input.scenario)) {
    return { ok: false, failureClass: "latency_regression" };
  }
  for (const text of expect.forbidAnswer ?? []) {
    if (input.answer.includes(text)) {
      return { ok: false, failureClass: "bad_user_response" };
    }
  }
  for (const text of expect.answerIncludes ?? []) {
    if (!input.answer.includes(text)) {
      return { ok: false, failureClass: "bad_user_response" };
    }
  }
  for (const text of expect.urlIncludes ?? []) {
    if (!input.finalUrl.includes(text)) {
      return { ok: false, failureClass: input.finalUrl ? "wrong_effect" : "no_browser_surface" };
    }
  }
  for (const text of expect.forbidFinalUrlIncludes ?? []) {
    if (input.finalUrl.includes(text)) {
      return { ok: false, failureClass: "wrong_click" };
    }
  }
  for (const text of expect.textIncludes ?? []) {
    if (!input.finalText.includes(text) && !input.answer.includes(text)) {
      return { ok: false, failureClass: "wrong_effect" };
    }
  }
  const latestResult = [...input.events].reverse().find((event) => event.type === "browserAction.result");
  if (latestResult && JSON.stringify(latestResult).includes("needs_clarification")) {
    return { ok: false, failureClass: "candidate_generation_failed" };
  }
  if (input.bridgeStatus?.mode === "permission_needed") {
    return { ok: false, failureClass: "permission_missing" };
  }
  if (input.bridgeStatus?.connected === false) {
    return { ok: false, failureClass: "extension_not_connected" };
  }
  if (Number.isFinite(Number(expect.maxApprovalPrompts))) {
    const approvals = input.events.filter((event) => event.type === "interaction.required" && event.interaction?.kind === "approval").length;
    if (approvals > Number(expect.maxApprovalPrompts)) {
      return { ok: false, failureClass: "unexpected_approval" };
    }
  }
  return { ok: true };
}

function classifyFailure(input) {
  const text = `${readError(input.error)} ${input.answer} ${JSON.stringify(input.events.slice(-5))}`;
  if (input.bridgeStatus?.mode === "permission_needed" || /needs_site_permission|missing_permission|Enable this site|site permission|required before/i.test(text)) {
    return "permission_missing";
  }
  if (input.bridgeStatus?.connected === false || /disconnected|health check|ECONNREFUSED|Failed to fetch/i.test(text)) {
    return "extension_not_connected";
  }
  if (/did not pick up|timed out|awaiting_extension|plan_paused_for_extension/i.test(text)) {
    return "extension_command_timeout";
  }
  if (/Active tab|wrong_tab|tab mismatch|window mismatch/i.test(text)) {
    return "wrong_tab";
  }
  if (/target|candidate|clarification|확정하지 못|대상/i.test(text)) {
    return "candidate_rank_wrong";
  }
  if (/plan:|latest result|Browser Action을 실행했습니다/i.test(text)) {
    return "bad_user_response";
  }
  return "unknown_failure";
}

async function launchIsolatedBrowser(input) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "codex-widget-browser-action-live-profile-"));
  const extension = await prepareExtensionForLiveRun(input.extensionDir, input.grantAllSitePermission);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: input.headless,
    args: [
      `--disable-extensions-except=${extension.dir}`,
      `--load-extension=${extension.dir}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });
  const extensionId = await readExtensionId(context);
  const configPage = await context.newPage();
  await configPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
  await configPage.evaluate(async (settings) => {
    await chrome.storage.sync.set(settings);
    await chrome.runtime.sendMessage({ type: "bridge.saveSettings", settings });
  }, {
    daemonBaseUrl: input.daemonUrl,
    autoConnect: true,
    autoObserve: true,
    allowAllSites: Boolean(input.grantAllSitePermission),
    observeBlocklist: [],
    allowSafeReadScroll: true,
    requireApprovalForClickType: false,
    useNativeHost: false,
    debugSnapshot: false,
    pollIntervalSeconds: 5
  });
  await configPage.close();
  let page = context.pages().find((candidate) => !candidate.url().startsWith("chrome-extension://"));

  return {
    extensionId,
    async ensurePage() {
      if (!page || page.isClosed()) {
        page = await context.newPage();
      }
      return page;
    },
    async close() {
      if (options.keepBrowser) {
        return;
      }
      await context.close().catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
      await extension.cleanup();
    }
  };
}

async function prepareExtensionForLiveRun(extensionDir, grantAllSitePermission) {
  if (!grantAllSitePermission) {
    return { dir: extensionDir, cleanup: async () => undefined };
  }
  const tempDir = await mkdtemp(path.join(tmpdir(), "codex-widget-browser-bridge-all-sites-"));
  await cp(extensionDir, tempDir, { recursive: true });
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

async function startWidgetRendererServer() {
  const vite = await createViteServer({
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false }
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === "string") {
    await vite.close();
    throw new Error("Widget renderer server did not bind.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => vite.close()
  };
}

async function launchWidgetBrowser(input) {
  const browser = await chromium.launch({ headless: input.headless });
  const page = await browser.newPage({ viewport: { width: 520, height: 820 } });
  await page.goto(`${input.rendererUrl}/?daemonPort=${input.daemonPort}&mode=browser`, { waitUntil: "domcontentloaded" });
  await waitForWidgetReady(page);
  return {
    page,
    close: () => browser.close()
  };
}

async function readExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    try {
      worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    } catch (error) {
      throw new Error(`Browser Bridge extension service worker did not start. Chromium usually requires headed mode for unpacked extension tests; rerun without --headless. ${readError(error)}`);
    }
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
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname.startsWith("/view/interesting")) {
      response.end(renderFixturePage({
        path: url.pathname,
        title: "재밌는 게시글",
        body: `<article><h1>재밌는 게시글</h1><p>Browser Action live fixture opened the representative content item.</p><a href="/forum?filter=concept">목록</a></article>`
      }));
      return;
    }
    if (url.pathname.startsWith("/view/notice")) {
      response.end(renderFixturePage({ path: url.pathname, title: "공지", body: "<h1>공지</h1><p>Wrong notice target.</p>" }));
      return;
    }
    if (url.pathname.startsWith("/view/survey")) {
      response.end(renderFixturePage({ path: url.pathname, title: "설문", body: "<h1>설문</h1><p>Wrong survey target.</p>" }));
      return;
    }
    response.end(renderFixturePage({
      path: url.pathname,
      title: "Browser Action Live Fixture",
      body: `
        <nav aria-label="게시판 필터">
          <a id="concept-posts" href="/forum?filter=concept">개념글</a>
          <a href="/forum">전체글</a>
          <button type="button">글쓰기</button>
        </nav>
        <main aria-label="게시글 목록">
          <h1>특이점 테스트 게시판</h1>
          <ul class="post-list">
            <li class="notice"><a href="/view/notice">[공지] 처음 오신 분을 위한 안내</a><span>운영자</span></li>
            <li class="survey"><a href="/view/survey">[설문] 알리 할인상품 의견 요청</a><span>운영자</span></li>
            <li><a href="/view/interesting">연봉자랑하는 지피쨩</a><span>작성자 오늘 1964 28</span></li>
            <li><a href="/view/interesting?alt=2">싱글벙글 브라우저 액션 테스트</a><span>작성자 오늘 881 12</span></li>
          </ul>
        </main>
      `
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close() {
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

function renderFixturePage(input) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; color: #17211f; }
    nav { display: flex; gap: 12px; margin-bottom: 24px; }
    a, button { font-size: 16px; min-height: 32px; }
    .post-list { display: grid; gap: 10px; max-width: 720px; }
    .notice, .survey { color: #6d7672; }
    li a { margin-right: 12px; }
  </style>
</head>
<body data-fixture-path="${escapeHtml(input.path)}">
${input.body}
</body>
</html>`;
}

async function connectDaemonSocket(daemonUrl) {
  const url = new URL(daemonUrl);
  const socket = new WebSocket(`ws://${url.host}`);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function waitForSocketEvent(socket, input) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${input.label}.`));
    }, input.timeoutMs);
    const onMessage = (raw) => {
      const event = JSON.parse(raw.toString());
      if (input.predicate(event)) {
        cleanup();
        resolve(event);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    function cleanup() {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    }
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

function collectSocketEvents(socket, events) {
  const onMessage = (raw) => {
    try {
      events.push(JSON.parse(raw.toString()));
    } catch (error) {
      events.push({ type: "parse_error", error: readError(error) });
    }
  };
  socket.on("message", onMessage);
  return () => socket.off("message", onMessage);
}

async function waitForWidgetReady(page) {
  const prompt = page.getByLabel("Ask Codex");
  await prompt.waitFor({ timeout: 15_000 });
  await waitUntil(async () => !(await prompt.isDisabled()), "Widget prompt did not become enabled.", 15_000);
}

async function submitWidgetPrompt(page, prompt) {
  const textarea = page.getByLabel("Ask Codex");
  await textarea.fill(prompt);
  await page.getByRole("button", { name: "Send prompt" }).click();
}

async function maybeRespondToWidgetApproval(page, scenario, startedAt) {
  if (!scenario.approval && !scenario.clarificationChoice) {
    return;
  }
  const maxMs = readMaxMs(scenario);
  const deadline = Date.now() + Math.max(1_000, Math.min(20_000, maxMs - (Date.now() - startedAt)));
  let clarificationSubmitted = false;
  let approvalSubmitted = false;
  while (Date.now() < deadline) {
    const interactionCard = page.locator(".interaction-card").first();
    try {
      await interactionCard.waitFor({ timeout: Math.max(500, Math.min(5_000, deadline - Date.now())) });
    } catch {
      return;
    }

    const sendButton = interactionCard.getByRole("button", { name: "Send" });
    if (!clarificationSubmitted && scenario.clarificationChoice && await sendButton.count()) {
      await interactionCard.locator("input, textarea").first().fill(String(scenario.clarificationChoice));
      await sendButton.click();
      clarificationSubmitted = true;
      await page.waitForTimeout(100);
      continue;
    }

    if (!scenario.approval || approvalSubmitted) {
      return;
    }
    const denyButton = interactionCard.getByRole("button", { name: "Deny" });
    const alwaysAllowButton = interactionCard.getByRole("button", { name: "Always allow" });
    const allowButton = interactionCard.getByRole("button", { name: "Allow" });
    if (scenario.approval === "deny" && await denyButton.count()) {
      await denyButton.click();
      return;
    }
    if (scenario.approval === "always_allow" && await alwaysAllowButton.count()) {
      await alwaysAllowButton.click();
      return;
    }
    if (await allowButton.count()) {
      await allowButton.click();
      approvalSubmitted = true;
      await page.waitForTimeout(100);
      continue;
    }
    return;
  }
}

async function waitForWidgetAssistantAnswer(page, input) {
  const assistantIndex = input.assistantCountBefore;
  const deadline = Date.now() + readMaxMs(input.scenario);
  let latestText = "";
  while (Date.now() < deadline) {
    const messages = page.locator(".assistant-message");
    if ((await messages.count()) > assistantIndex) {
      const message = messages.nth(assistantIndex);
      const className = await message.getAttribute("class").catch(() => "");
      latestText = (await message.innerText().catch(() => "")).trim();
      if (isWidgetAnswerReady(latestText, input.scenario, String(className).includes("is-live"))) {
        if (input.scenario.approval && /승인 후 실행|approval|approve/i.test(latestText)) {
          await page.waitForTimeout(100);
        } else {
          return latestText;
        }
      }
    }
    await page.waitForTimeout(60);
  }
  return latestText || (await readLatestWidgetAnswer(page));
}

function isWidgetAnswerReady(text, scenario, isLive) {
  if (!text || text === "Working") {
    return false;
  }
  if (scenario.approval && /승인 후 실행|approval|approve/i.test(text)) {
    return false;
  }
  const expect = scenario.expect ?? {};
  if ((expect.answerIncludes ?? []).length > 0 && expect.answerIncludes.every((value) => text.includes(value))) {
    return true;
  }
  if ((expect.textIncludes ?? []).length > 0 && expect.textIncludes.every((value) => text.includes(value))) {
    return true;
  }
  if ((expect.urlIncludes ?? []).length > 0 && expect.urlIncludes.every((value) => text.includes(value))) {
    return true;
  }
  if (/브라우저 동작을 완료했습니다|현재 보고 있는 페이지는|주요 내용:/i.test(text)) {
    return true;
  }
  return !isLive;
}

async function readLatestWidgetAnswer(page) {
  const messages = page.locator(".assistant-message");
  const count = await messages.count();
  if (count === 0) {
    return "";
  }
  return (await messages.nth(count - 1).innerText().catch(() => "")).trim();
}

async function waitForBridgeActiveTab(daemonUrl, expectedUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await readBridgeStatus(daemonUrl).catch(() => null);
    const activeUrl = status?.activeTab?.url ?? "";
    if (status?.connected && status?.mode !== "disconnected" && activeTabUrlMatchesExpected(activeUrl, expectedUrl)) {
      return status;
    }
    await sleep(300);
  }
  throw new Error(`Browser Bridge did not report the expected active tab: ${expectedUrl}`);
}

function activeTabUrlMatchesExpected(activeUrl, expectedUrl) {
  const active = normalizeUrl(activeUrl);
  const expected = normalizeUrl(expectedUrl);
  if (active === expected) {
    return true;
  }
  try {
    const activeParsed = new URL(active);
    const expectedParsed = new URL(expected);
    return !expectedParsed.search &&
      activeParsed.origin === expectedParsed.origin &&
      normalizePathname(activeParsed.pathname) === normalizePathname(expectedParsed.pathname);
  } catch {
    return false;
  }
}

async function readBridgeStatus(daemonUrl) {
  const response = await fetch(new URL("/browser-action/extension/status", daemonUrl));
  if (!response.ok) {
    throw new Error(`Browser Bridge status failed (${response.status}).`);
  }
  const payload = await response.json();
  return payload.status ?? payload;
}

async function assertDaemonHealthy(daemonUrl) {
  const response = await fetch(new URL("/storage/health", daemonUrl));
  if (!response.ok) {
    throw new Error(`Widget daemon health check failed (${response.status}) at ${daemonUrl}`);
  }
}

function readInteractionDecision(interaction, scenario) {
  if (scenario.approval === "deny") {
    return "decline";
  }
  if (scenario.approval === "always_allow") {
    return "always_allow";
  }
  const text = `${interaction.title ?? ""} ${interaction.body ?? ""} ${interaction.action ?? ""}`.toLowerCase();
  if (/(delete|삭제|pay|purchase|결제|password|token|cookie|upload|download|submit|send|post|publish)/i.test(text)) {
    return "decline";
  }
  return scenario.approval === "manual" ? "decline" : "approve";
}

function resolveScenarioUrl(value, fixture) {
  if (value.startsWith("fixture:")) {
    return `${fixture.baseUrl}${value.slice("fixture:".length)}`;
  }
  return value;
}

function resolveScenarioPrompt(value, fixture) {
  return String(value ?? "").replace(/\{\{fixtureBaseUrl\}\}/g, fixture?.baseUrl ?? "");
}

function readMaxMs(scenario) {
  return Number(scenario.expect?.maxMs) || 45_000;
}

function scenarioMatchesMode(scenario, mode) {
  if (mode === "all") {
    return true;
  }
  if (mode === "widget-ui") {
    return !scenario.mode || scenario.mode === "isolated" || scenario.mode === "widget-ui";
  }
  return !scenario.mode || scenario.mode === mode;
}

async function readScenarios(filePath) {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid scenario JSONL at ${filePath}:${index + 1}: ${readError(error)}`);
      }
    });
}

function parseArgs(argv) {
  const parsed = {
    mode: "isolated",
    scenario: new Set(),
    scenarios: DEFAULT_SCENARIOS,
    daemonUrl: DEFAULT_DAEMON_URL,
    daemonPort: 0,
    extensionDir: DEFAULT_EXTENSION_DIR,
    headless: false,
    keepBrowser: false,
    grantAllSitePermission: false,
    dryRun: false,
    allowFailures: false,
    outputDir: "",
    report: "",
    runId: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? "";
    if (arg === "--mode") parsed.mode = next();
    else if (arg === "--scenario") parsed.scenario.add(next());
    else if (arg === "--scenarios") parsed.scenarios = path.resolve(next());
    else if (arg === "--daemon-url") parsed.daemonUrl = normalizeDaemonUrl(next());
    else if (arg === "--daemon-port") parsed.daemonPort = Number(next()) || 0;
    else if (arg === "--extension-dir") parsed.extensionDir = path.resolve(next());
    else if (arg === "--headless") parsed.headless = true;
    else if (arg === "--headed") parsed.headless = false;
    else if (arg === "--keep-browser") parsed.keepBrowser = true;
    else if (arg === "--grant-all-site-permission") parsed.grantAllSitePermission = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--allow-failures") parsed.allowFailures = true;
    else if (arg === "--output-dir") parsed.outputDir = next();
    else if (arg === "--report") parsed.report = next();
    else if (arg === "--run-id") parsed.runId = safeFileName(next());
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!["isolated", "real", "widget-ui", "all"].includes(parsed.mode)) {
    throw new Error(`Invalid --mode ${parsed.mode}; expected isolated, real, widget-ui, or all.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Browser Action live runner

Usage:
  node scripts/browser-action-live-runner.mjs [options]

Options:
  --mode isolated|real|widget-ui|all
                               isolated sends prompts over daemon websocket; widget-ui drives the browser-hosted widget UI; real uses the installed extension and active user browser tab
  --scenario <id>              run one scenario; can be repeated
  --scenarios <path>           JSONL scenario file
  --headed                     show the isolated browser window (default)
  --headless                   run isolated browser headless where the browser supports extensions
  --keep-browser               keep the isolated browser open after the run
  --grant-all-site-permission  use a temporary unpacked extension copy with http/https host permissions for public-site dogfood
  --daemon-url <url>           real-mode daemon URL, default http://127.0.0.1:4128
  --dry-run                    parse scenarios and write a report without launching browser/daemon
  --allow-failures             keep exit code 0 even when scenarios fail
`);
}

function renderReport(input) {
  const rows = input.results.length
    ? input.results.map((result) => `| ${result.id} | ${result.mode ?? ""} | ${result.status} | ${result.failureClass || "-"} | ${result.elapsedMs} | \`${result.artifactDir}\` |`).join("\n")
    : "| - | - | dry-run | - | - | - |";
  const dryRun = input.dryRun
    ? `\nDry-run scenarios: ${input.dryRun.scenarios.map((scenario) => scenario.id).join(", ")}\n`
    : "";
  return `# Browser Action Live Test Report

- Run: \`${input.runId}\`
- Mode: \`${input.mode}\`
- Generated: ${new Date().toISOString()}
- Output: \`${String(outputDir).replace(/\\/g, "/")}\`
${dryRun}
| Scenario | Mode | Status | Failure class | Elapsed ms | Artifacts |
| --- | --- | --- | --- | ---: | --- |
${rows}

## Notes

- \`isolated\` mode launches a dedicated Chromium profile with the unpacked Browser Bridge extension and a local fixture page.
- \`widget-ui\` mode launches that same target browser plus a separate browser-hosted widget UI and submits prompts through the actual composer/approval controls.
- \`real\` mode uses the currently installed Browser Bridge extension and the active user browser tab. Do not touch that tab while a real-mode scenario is running.
- Failure packets include daemon events, bridge status before/after, screenshots when a controlled browser page is available, and a machine-readable result JSON.
`;
}

function normalizeDaemonUrl(value) {
  const url = new URL(value);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return String(value ?? "").replace(/#.*$/, "");
  }
}

function normalizePathname(value) {
  return String(value || "/").replace(/\/$/, "") || "/";
}

function formatKstDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}-${parts.find((part) => part.type === "day").value}`;
}

function formatKstTimestamp(date) {
  const datePart = formatKstDate(date).replace(/-/g, "");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  return `${datePart}-${parts.find((part) => part.type === "hour").value}${parts.find((part) => part.type === "minute").value}${parts.find((part) => part.type === "second").value}`;
}

function safeFileName(value) {
  return String(value || "run").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "run";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, message, timeoutMs = 5_000, intervalMs = 50) {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(message);
    }
    await sleep(intervalMs);
  }
}

function readError(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
