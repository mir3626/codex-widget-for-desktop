#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const DATE = process.env.CODEX_WIDGET_DOGFOOD_DATE ?? formatSeoulDate(new Date());
const runId = `computer-use-browser-prompt-live-${formatKstTimestamp(new Date())}`;
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `computer-use-browser-prompt-live-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `computer-use-browser-prompt-live-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `computer-use-browser-prompt-live-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const sampleLedgerPath = join(repoRoot, "docs", "reports", "assets", "computer-use-browser-prompt-live-runs.jsonl");

await rm(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(assetDir, { recursive: true });

const scenarios = [
  {
    id: "computer-session-browser-live-read-example",
    intentClass: "read_current_page",
    sourceHost: "example.com",
    userScenario: "사용자가 위젯 Computer Use 세션에서 공개 웹페이지(example.com)의 현재 페이지 내용을 읽어 달라고 요청한다.",
    prompt: "현재 페이지를 읽어줘 full_control_dev",
    sourceUrl: "https://example.com/",
    expected: { actionTypes: ["read"], urlIncludes: "https://example.com/" }
  },
  {
    id: "computer-session-browser-live-search-wikipedia",
    intentClass: "search_form_fill_submit",
    sourceHost: "wikipedia.org",
    userScenario: "사용자가 위젯 Computer Use 세션에서 Wikipedia 검색창에 Codex CLI를 입력하고 검색 버튼을 눌러 달라고 요청한다.",
    prompt: "검색창에 \"Codex CLI\" 검색하고 Search 버튼 눌러줘 full_control_dev",
    sourceUrl: "https://www.wikipedia.org/",
    expected: { actionTypes: ["type", "click"], urlIncludes: "search=Codex+CLI" }
  },
  {
    id: "computer-session-browser-live-click-example-link",
    intentClass: "representative_content_selection",
    sourceHost: "example.com",
    userScenario: "사용자가 위젯 Computer Use 세션에서 공개 웹페이지(example.com)의 More information 링크를 열어 달라고 요청한다.",
    prompt: "Click More information full_control_dev",
    sourceUrl: "https://example.com/",
    expected: { actionTypes: ["click"], urlIncludes: "https://www.iana.org/help/example-domains" }
  },
  {
    id: "computer-session-browser-live-navigate-iana",
    intentClass: "navigation",
    sourceHost: "iana.org",
    userScenario: "사용자가 위젯 Computer Use 세션에서 공개 IANA reserved domains 문서로 이동해 달라고 요청한다.",
    prompt: "open https://www.iana.org/domains/reserved full_control_dev",
    sourceUrl: "https://example.com/",
    expected: { actionTypes: ["navigate"], urlIncludes: "https://www.iana.org/domains/reserved" }
  }
];

const smokeAppData = useSmokeAppData("codex-widget-computer-use-browser-live-dogfood");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const startedAtMs = Date.now();
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }
  const elapsedMs = Date.now() - startedAtMs;
  const evidence = {
    schemaVersion: "computer-use-browser-prompt-live-dogfood.v1",
    generatedAt: new Date().toISOString(),
    date: DATE,
    runId,
    metrics: summarizeMetrics(results, elapsedMs),
    scenarios: results
  };
  mkdirSync(join(repoRoot, "docs", "dogfood"), { recursive: true });
  mkdirSync(join(repoRoot, "docs", "reports"), { recursive: true });
  writeFileSync(dogfoodPath, `${JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    generatedAt: evidence.generatedAt,
    date: evidence.date,
    runId,
    scenarios: results.map(redactScenarioForDogfood)
  }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");
  for (const scenario of results) {
    await appendFile(sampleLedgerPath, `${JSON.stringify({
      schemaVersion: "computer-use-browser-prompt-live-sample.v1",
      generatedAt: evidence.generatedAt,
      date: DATE,
      runId,
      evidencePath: normalizePath(evidencePath),
      reportPath: normalizePath(reportPath),
      scenario: redactScenarioForSampleLedger(scenario)
    })}\n`, "utf8");
  }
  assert.equal(results.every((result) => result.success), true);
  console.log(`computer use browser prompt live dogfood evidence written: ${reportPath}`);
} finally {
  await daemon.close();
  smokeAppData.cleanup();
}

async function runScenario(scenario) {
  const startedAtMs = Date.now();
  const started = await postJson("/computer-use/sessions", {
    userRequest: scenario.userScenario,
    requestedSurface: "isolated_browser",
    profileId: `profile:${scenario.id}`,
    metadata: {
      dogfood: "computer-use-browser-prompt-live",
      intentClass: scenario.intentClass,
      sourceHost: scenario.sourceHost,
      livePublicSite: true
    }
  });
  assert.equal(started.ok, true);
  const sessionId = started.result.session.sessionId;
  const prompt = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/browser-action-prompt`, {
    text: scenario.prompt,
    mode: "browser",
    source: {
      kind: "controlled_browser",
      browser: "chromium",
      url: scenario.sourceUrl
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
  await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/cancel`, { reason: "browser_prompt_live_dogfood_cleanup" });
  const cleanupBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  return {
    id: scenario.id,
    intentClass: scenario.intentClass,
    sourceHost: scenario.sourceHost,
    userScenario: scenario.userScenario,
    architectureWorkflow: [
      "renderer-equivalent request creates an isolated_browser Computer Session for a public website",
      "ComputerSessionRuntime selects the isolated browser surface and creates an eval run plus capability DAG skeleton",
      "the /browser-action-prompt route deterministically decomposes the Korean or direct user prompt into a Browser Action prompt plan",
      "each prompt step is executed through the parent Computer Session operation path against a real public URL",
      "the Playwright Browser Action adapter captures pre-action and post-action DOM observations without storing raw DOM or screenshots in the report",
      "Computer Session records action feedback, perception graph evidence where a side-effect target exists, verifier output, follow-up verification nodes, and eval-ledger nodes",
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
      sourceUrl: scenario.sourceUrl,
      finalUrl,
      sourceHost: scenario.sourceHost,
      finalHost: readUrlHost(finalUrl),
      urlHash: hashText(finalUrl ?? ""),
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
        credentials: "not_used",
        urls: "public_url_metadata_only"
      }
    },
    improvementAndFollowUp: success
      ? "성공. 이 케이스는 public-site live evidence이며, 승격에는 같은 intent class의 반복 sample과 p95/safety regression 검사가 필요하다."
      : "실패. 공개 사이트 DOM 변화, anti-bot 흐름, 프롬프트 분해, target matching, action verifier 중 어느 단계가 실패했는지 debug bundle을 기준으로 분류해야 한다."
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
  const deadline = Date.now() + 15_000;
  let bundle;
  while (Date.now() < deadline) {
    bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
    const promptRun = bundle.bundle.promptRuns.find((candidate) => candidate.id === promptRunId);
    if (promptRun?.status === status) {
      return bundle;
    }
    if (promptRun && (promptRun.status === "failed" || promptRun.status === "cancelled")) {
      return bundle;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for prompt run ${promptRunId} to reach ${status}: ${JSON.stringify(bundle?.bundle?.promptRuns ?? [], null, 2)}`);
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
  const hosts = new Set(results.map((result) => result.sourceHost));
  return {
    scenarioCount: results.length,
    successCount: results.filter((result) => result.success).length,
    livePublicSite: true,
    fixtureBacked: false,
    directComputerSessionPromptRoute: true,
    intentClassCount: intentClasses.size,
    sourceHostCount: hosts.size,
    sourceHosts: [...hosts],
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    elapsedMs
  };
}

function redactScenarioForDogfood(scenario) {
  return {
    id: scenario.id,
    intentClass: scenario.intentClass,
    sourceHost: scenario.sourceHost,
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

function redactScenarioForSampleLedger(scenario) {
  return {
    id: scenario.id,
    intentClass: scenario.intentClass,
    sourceHost: scenario.sourceHost,
    success: scenario.success,
    status: scenario.status,
    architectureWorkflow: scenario.architectureWorkflow,
    result: {
      elapsedMs: scenario.result.elapsedMs,
      p95LatencyMs: scenario.result.p95LatencyMs,
      promptRunStatus: scenario.result.promptRunStatus,
      stepCount: scenario.result.stepCount,
      completedStepCount: scenario.result.completedStepCount,
      actionTypes: scenario.result.actionTypes,
      sourceHost: scenario.result.sourceHost,
      finalHost: scenario.result.finalHost,
      urlHash: scenario.result.urlHash,
      completedCapabilityJobCount: scenario.result.completedCapabilityJobCount,
      verificationNodeCount: scenario.result.verificationNodeCount,
      evalLedgerNodeCount: scenario.result.evalLedgerNodeCount,
      browserDomObservationCount: scenario.result.browserDomObservationCount,
      perceptionGraphCount: scenario.result.perceptionGraphCount,
      actionFeedbackCount: scenario.result.actionFeedbackCount,
      promptPlanEvalStepCount: scenario.result.promptPlanEvalStepCount,
      promptStepEvalStepCount: scenario.result.promptStepEvalStepCount,
      cleanupRollbackCompleted: scenario.result.cleanupRollbackCompleted,
      redaction: scenario.result.redaction
    }
  };
}

function renderReport(evidence) {
  const lines = [
    "# Computer Use Browser Prompt Live Dogfood",
    "",
    `Generated: ${evidence.generatedAt}`,
    `Run: \`${evidence.runId}\``,
    "",
    "## Metrics",
    "",
    `- scenarios: \`${evidence.metrics.scenarioCount}\``,
    `- success: \`${evidence.metrics.successCount}/${evidence.metrics.scenarioCount}\``,
    `- p95 latency: \`${evidence.metrics.p95LatencyMs ?? "n/a"}ms\``,
    `- hosts: \`${evidence.metrics.sourceHosts.join(", ")}\``,
    `- route: \`/computer-use/sessions/:id/browser-action-prompt\``,
    "",
    "## Scenarios",
    "",
    "| Scenario | Intent | Host | Status | Steps | Evidence | Follow-up |",
    "|---|---|---|---|---:|---|---|"
  ];
  for (const scenario of evidence.scenarios) {
    lines.push([
      scenario.id,
      scenario.intentClass,
      scenario.sourceHost,
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

function readUrlHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function hashText(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function redactId(value) {
  return typeof value === "string" ? value.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>") : value;
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

function formatKstTimestamp(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  return formatter.format(date).replace(/[^0-9]/g, "").replace(/^(\d{8})(\d{6})$/, "$1-$2");
}
