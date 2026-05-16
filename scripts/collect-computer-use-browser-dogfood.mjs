#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const DATE = process.env.CODEX_WIDGET_DOGFOOD_DATE ?? formatSeoulDate(new Date());
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `computer-use-browser-prompt-dogfood-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `computer-use-browser-prompt-dogfood-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `computer-use-browser-prompt-dogfood-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const sampleLedgerPath = join(repoRoot, "docs", "reports", "assets", "computer-use-browser-prompt-dogfood-runs.jsonl");

await rm(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(assetDir, { recursive: true });

const pageServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(renderFixturePage(url));
});

await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
const fixtureBaseUrl = `http://127.0.0.1:${pageServer.address().port}`;
const smokeAppData = useSmokeAppData("codex-widget-computer-use-browser-dogfood");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

const scenarios = [
  {
    id: "computer-session-browser-read-current-page",
    intentClass: "read_current_page",
    userScenario: "사용자가 위젯 Computer Use 세션에서 현재 브라우저 페이지 내용을 읽어 달라고 요청한다.",
    prompt: "현재 페이지를 읽어줘 full_control_dev",
    startPath: "/read",
    expected: { actionTypes: ["read"], urlIncludes: "/read" }
  },
  {
    id: "computer-session-browser-search-form-submit",
    intentClass: "search_form_fill_submit",
    userScenario: "사용자가 위젯 Computer Use 세션에서 검색창에 Codex CLI를 입력하고 검색 버튼을 눌러 달라고 요청한다.",
    prompt: "검색창에 \"Codex CLI\" 검색하고 Search 버튼 눌러줘 full_control_dev",
    startPath: "/search",
    expected: { actionTypes: ["type", "click"], urlIncludes: "q=Codex%20CLI" }
  },
  {
    id: "computer-session-browser-representative-content-selection",
    intentClass: "representative_content_selection",
    userScenario: "사용자가 위젯 Computer Use 세션에서 인기글을 열고 첫 번째 글 링크로 이동해 달라고 요청한다.",
    prompt: "인기글 버튼을 누른 뒤 1번째 글 링크를 열어줘 full_control_dev",
    startPath: "/posts",
    expected: { actionTypes: ["click", "click"], urlIncludes: "/articles/first" }
  },
  {
    id: "computer-session-browser-navigation",
    intentClass: "navigation",
    userScenario: "사용자가 위젯 Computer Use 세션에서 브라우저를 특정 문서 URL로 이동해 달라고 요청한다.",
    prompt: `${fixtureBaseUrl}/docs로 이동해줘 full_control_dev`,
    startPath: "/",
    expected: { actionTypes: ["navigate"], urlIncludes: "/docs" }
  }
];

try {
  const startedAtMs = Date.now();
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }
  const elapsedMs = Date.now() - startedAtMs;
  const evidence = {
    schemaVersion: "computer-use-browser-prompt-dogfood.v1",
    generatedAt: new Date().toISOString(),
    date: DATE,
    fixtureBaseUrl: redactLocalhostPort(fixtureBaseUrl),
    metrics: summarizeMetrics(results, elapsedMs),
    scenarios: results
  };
  mkdirSync(join(repoRoot, "docs", "dogfood"), { recursive: true });
  mkdirSync(join(repoRoot, "docs", "reports"), { recursive: true });
  writeFileSync(dogfoodPath, `${JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    generatedAt: evidence.generatedAt,
    date: evidence.date,
    scenarios: results.map(redactScenarioForDogfood)
  }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");
  await appendFile(sampleLedgerPath, `${JSON.stringify({
    schemaVersion: "computer-use-browser-prompt-dogfood-sample.v1",
    generatedAt: evidence.generatedAt,
    date: DATE,
    evidencePath: normalizePath(evidencePath),
    reportPath: normalizePath(reportPath),
    metrics: evidence.metrics,
    scenarios: results.map((scenario) => ({
      id: scenario.id,
      intentClass: scenario.intentClass,
      success: scenario.success,
      elapsedMs: scenario.result.elapsedMs,
      promptRunStatus: scenario.result.promptRunStatus,
      actionTypes: scenario.result.actionTypes
    }))
  })}\n`, "utf8");
  assert.equal(results.every((result) => result.success), true);
  console.log(`computer use browser prompt dogfood evidence written: ${reportPath}`);
} finally {
  await daemon.close();
  pageServer.close();
  smokeAppData.cleanup();
}

async function runScenario(scenario) {
  const startedAtMs = Date.now();
  const started = await postJson("/computer-use/sessions", {
    userRequest: scenario.userScenario,
    requestedSurface: "isolated_browser",
    profileId: `profile:${scenario.id}`,
    metadata: {
      dogfood: "computer-use-browser-prompt",
      intentClass: scenario.intentClass
    }
  });
  assert.equal(started.ok, true);
  const sessionId = started.result.session.sessionId;
  const sourceUrl = `${fixtureBaseUrl}${scenario.startPath}`;
  const prompt = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/browser-action-prompt`, {
    text: scenario.prompt,
    mode: "browser",
    source: {
      kind: "controlled_browser",
      browser: "chromium",
      url: sourceUrl
    }
  });
  assert.equal(prompt.ok, true);
  const promptRunId = prompt.result.promptRun.id;
  const bundle = await waitForPromptRun(sessionId, promptRunId, "completed");
  const evalRun = await getEvalRun(bundle.bundle.evalRun.id);
  const promptRun = bundle.bundle.promptRuns.find((run) => run.id === promptRunId);
  const finalUrl = readLatestBrowserUrl(bundle.bundle);
  const actionTypes = promptRun?.steps.map((step) => step.actionType) ?? [];
  const elapsedMs = Date.now() - startedAtMs;
  const success = promptRun?.status === "completed" &&
    bundle.bundle.session.state === "completed" &&
    expectedActionsMatch(actionTypes, scenario.expected.actionTypes) &&
    (!scenario.expected.urlIncludes || String(finalUrl ?? "").includes(scenario.expected.urlIncludes)) &&
    bundle.bundle.dagNodes.some((node) => node.kind === "verification" && node.status === "completed") &&
    bundle.bundle.dagNodes.some((node) => node.kind === "eval_ledger" && node.status === "completed") &&
    evalRun.steps.some((step) => step.kind === "browser_action_prompt_plan" && step.status === "completed") &&
    evalRun.steps.some((step) => step.kind === "browser_action_prompt_step");
  await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/cancel`, { reason: "browser_prompt_dogfood_cleanup" });
  const cleanupBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  return {
    id: scenario.id,
    intentClass: scenario.intentClass,
    userScenario: scenario.userScenario,
    architectureWorkflow: [
      "renderer-equivalent request creates an isolated_browser Computer Session with scenario metadata",
      "ComputerSessionRuntime selects the isolated browser surface and creates an eval run plus capability DAG skeleton",
      "the /browser-action-prompt route deterministically decomposes the Korean user prompt into a Browser Action prompt plan",
      "each prompt step is executed through the Computer Session operation path, not through the legacy Browser Action endpoint alone",
      "the Playwright Browser Action adapter captures pre-action and post-action DOM observations for every action step",
      "Computer Session records action feedback, perception graph evidence, verifier output, follow-up verification nodes, and eval-ledger nodes",
      "the debug bundle exports prompt runs, capability jobs, DAG nodes, observations, action feedback, eval resources, verifier audit, and rollback cleanup"
    ],
    success,
    status: success ? "passed" : "needs_followup",
    result: {
      sessionId,
      evalRunId: bundle.bundle.evalRun.id,
      dagRunId: bundle.bundle.session.dagRunId,
      promptRunId,
      promptRunStatus: promptRun?.status,
      stepCount: promptRun?.steps.length ?? 0,
      completedStepCount: promptRun?.steps.filter((step) => step.status === "completed").length ?? 0,
      actionTypes,
      elapsedMs,
      p50LatencyMs: elapsedMs,
      p95LatencyMs: elapsedMs,
      finalUrl: redactLocalhostPort(finalUrl),
      capabilityJobCount: bundle.bundle.capabilityJobs.filter((job) => job.kind === "browser_action").length,
      completedCapabilityJobCount: bundle.bundle.capabilityJobs.filter((job) => job.kind === "browser_action" && job.status === "completed").length,
      dagNodeCount: bundle.bundle.dagNodes.length,
      verificationNodeCount: bundle.bundle.dagNodes.filter((node) => node.kind === "verification" && node.status === "completed").length,
      evalLedgerNodeCount: bundle.bundle.dagNodes.filter((node) => node.kind === "eval_ledger" && node.status === "completed").length,
      observationCount: bundle.bundle.observations.length,
      browserDomObservationCount: bundle.bundle.observations.filter((observation) => observation.kind === "browser_dom").length,
      perceptionGraphCount: bundle.bundle.perceptionGraphs.length,
      actionFeedbackCount: bundle.bundle.actionFeedbacks.length,
      verifierResultCount: bundle.bundle.verifierResults.length,
      promptPlanEvalStepCount: evalRun.steps.filter((step) => step.kind === "browser_action_prompt_plan").length,
      promptStepEvalStepCount: evalRun.steps.filter((step) => step.kind === "browser_action_prompt_step").length,
      actionRoutes: summarizeActionRoutes(bundle.bundle.dagNodes),
      cleanupRollbackCompleted: cleanupBundle.bundle.rollbackActions.some((action) => action.kind === "close_surface" && action.status === "completed"),
      redaction: {
        rawScreenshots: "not_embedded",
        rawDom: "not_embedded",
        localhostPorts: "redacted_in_report"
      }
    },
    improvementAndFollowUp: success
      ? "성공했지만 현재 증거는 local fixture 기반이다. 반복 실행 가능성은 높지만 public-site live promotion에는 별도 live Computer Session browser prompt corpus가 필요하다."
      : "프롬프트 분해, target matching, action verifier, 또는 follow-up DAG linkage 중 하나가 실패했으므로 debug bundle을 기준으로 원인 분류가 필요하다."
  };
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

async function getEvalRun(runId) {
  const response = await fetch(`${baseUrl}/computer-use/eval/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) {
    throw new Error(`eval run ${runId} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function waitForPromptRun(sessionId, promptRunId, status) {
  const deadline = Date.now() + 8000;
  let bundle;
  while (Date.now() < deadline) {
    bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
    const promptRun = bundle.bundle.promptRuns.find((candidate) => candidate.id === promptRunId);
    if (promptRun?.status === status) {
      return bundle;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for prompt run ${promptRunId} to reach ${status}: ${JSON.stringify(bundle?.bundle?.promptRuns ?? [], null, 2)}`);
}

function renderFixturePage(url) {
  if (url.pathname === "/search") {
    const query = url.searchParams.get("q") ?? "";
    return `<!doctype html>
      <title>Computer Use Browser Prompt Search</title>
      <main>
        <form id="search-form" onsubmit="event.preventDefault(); const q = document.querySelector('#query').value; document.querySelector('#result').textContent = 'Result for ' + q; history.pushState({}, '', '/search?q=' + encodeURIComponent(q));">
          <label for="query">검색</label>
          <input id="query" name="q" type="search" role="searchbox" aria-label="검색" value="${escapeHtml(query)}" />
          <button id="search-button" type="submit">Search</button>
        </form>
        <p id="result">${query ? `Result for ${escapeHtml(query)}` : "Ready"}</p>
      </main>`;
  }
  if (url.pathname === "/posts") {
    return `<!doctype html>
      <title>Computer Use Browser Prompt Posts</title>
      <main>
        <button id="popular-posts" type="button" onclick="document.querySelector('#first-post').hidden=false;document.querySelector('#status').textContent='popular opened'">인기글</button>
        <a id="first-post" href="/articles/first" hidden>1번째 글</a>
        <p id="status">closed</p>
      </main>`;
  }
  if (url.pathname === "/articles/first") {
    return `<!doctype html>
      <title>Computer Use Browser Prompt Article</title>
      <main>
        <h1>1번째 글</h1>
        <p id="article-status">first post opened</p>
      </main>`;
  }
  if (url.pathname === "/read") {
    return `<!doctype html>
      <title>Computer Use Browser Prompt Read</title>
      <main>
        <h1>Codex browser prompt fixture</h1>
        <p>이 페이지는 Computer Session browser-action-prompt 경로의 읽기 증거를 검증한다.</p>
      </main>`;
  }
  if (url.pathname === "/docs") {
    return `<!doctype html>
      <title>Computer Use Browser Prompt Docs</title>
      <main>
        <h1>Codex Docs</h1>
        <p id="docs-status">navigation completed</p>
      </main>`;
  }
  return `<!doctype html>
    <title>Computer Use Browser Prompt Home</title>
    <main>
      <h1>Computer Use Browser Prompt Fixture</h1>
      <a href="/docs">Docs</a>
    </main>`;
}

function readLatestBrowserUrl(bundle) {
  const browserObservation = [...bundle.observations]
    .reverse()
    .find((observation) => observation.kind === "browser_dom" && typeof observation.metadata?.url === "string");
  return browserObservation?.metadata?.url;
}

function expectedActionsMatch(actual, expected) {
  if (actual.length !== expected.length) {
    return false;
  }
  return expected.every((action, index) => actual[index] === action);
}

function summarizeActionRoutes(dagNodes) {
  return dagNodes
    .map((node) => node.output?.actionRoute ?? node.input?.actionRoute)
    .filter((route) => route && typeof route === "object")
    .map((route) => ({
      executionMode: route.executionMode,
      preferenceRank: route.preferenceRank,
      visualFallbackUsed: route.visualFallbackUsed === true
    }));
}

function summarizeMetrics(results, elapsedMs) {
  const latencies = results.map((result) => Number(result.result.elapsedMs)).filter(Number.isFinite);
  const intentClasses = new Set(results.map((result) => result.intentClass));
  return {
    scenarioCount: results.length,
    successCount: results.filter((result) => result.success).length,
    fixtureBacked: true,
    directComputerSessionPromptRoute: true,
    intentClassCount: intentClasses.size,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    elapsedMs
  };
}

function redactScenarioForDogfood(scenario) {
  return {
    id: scenario.id,
    intentClass: scenario.intentClass,
    userScenario: scenario.userScenario,
    architectureWorkflow: scenario.architectureWorkflow,
    success: scenario.success,
    status: scenario.status,
    result: {
      ...scenario.result,
      sessionId: redactId(scenario.result.sessionId),
      evalRunId: redactId(scenario.result.evalRunId),
      dagRunId: redactId(scenario.result.dagRunId),
      promptRunId: redactId(scenario.result.promptRunId)
    },
    improvementAndFollowUp: scenario.improvementAndFollowUp
  };
}

function renderReport(evidence) {
  const lines = [
    "# Computer Use Browser Prompt Dogfood",
    "",
    `Generated: ${evidence.generatedAt}`,
    `Fixture: \`${evidence.fixtureBaseUrl}\``,
    "",
    "## Metrics",
    "",
    `- scenarios: \`${evidence.metrics.scenarioCount}\``,
    `- success: \`${evidence.metrics.successCount}/${evidence.metrics.scenarioCount}\``,
    `- p95 latency: \`${evidence.metrics.p95LatencyMs ?? "n/a"}ms\``,
    `- route: \`/computer-use/sessions/:id/browser-action-prompt\``,
    `- promotion: \`fixture evidence only; live public-site corpus still required\``,
    "",
    "## Scenarios",
    "",
    "| Scenario | Intent | Status | Steps | Evidence | Follow-up |",
    "|---|---|---|---:|---|---|"
  ];
  for (const scenario of evidence.scenarios) {
    lines.push([
      scenario.id,
      scenario.intentClass,
      scenario.status,
      String(scenario.result.stepCount),
      `${scenario.result.completedCapabilityJobCount} jobs, ${scenario.result.perceptionGraphCount} graphs, ${scenario.result.verificationNodeCount} verifier nodes`,
      scenario.improvementAndFollowUp
    ].map((cell) => ` ${escapeMarkdownTable(String(cell))} `).join("|").replace(/^/, "|").replace(/$/, "|"));
  }
  lines.push("");
  lines.push("## Architecture Workflow");
  lines.push("");
  for (const scenario of evidence.scenarios) {
    lines.push(`### ${scenario.id}`);
    lines.push("");
    for (const step of scenario.architectureWorkflow) {
      lines.push(`- ${step}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) {
    return undefined;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function redactLocalhostPort(value) {
  return typeof value === "string" ? value.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>") : value;
}

function redactId(value) {
  return typeof value === "string" ? value.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>") : value;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeMarkdownTable(value) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function formatSeoulDate(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}
