#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const DATE = process.env.CODEX_WIDGET_DOGFOOD_DATE ?? formatSeoulDate(new Date());
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `computer-use-toolsmith-live-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `computer-use-toolsmith-live-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `computer-use-toolsmith-live-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const sampleLedgerPath = join(repoRoot, "docs", "reports", "assets", "computer-use-toolsmith-live-runs.jsonl");
const liveUrls = [
  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
  "https://platform.openai.com/docs/codex/overview",
  "https://platform.openai.com/docs/docs-mcp"
];

rmSync(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(assetDir, { recursive: true });

const smokeAppData = useSmokeAppData("codex-widget-computer-use-toolsmith-live-dogfood");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const outputRoot = join(assetDir, "live-report");

try {
  const startedAtMs = Date.now();
  const browserFallbackDocuments = await captureBrowserFallbackDocuments(liveUrls);
  const profile = await postJson("/computer-use/autonomy/profiles", {
    name: "Computer Use live OpenAI web research",
    mode: "scoped_yolo",
    scope: "one_time",
    maxUses: 3,
    grants: {
      network: true,
      networkDomains: ["openai.com", "platform.openai.com", "help.openai.com"],
      browserAutomation: true,
      browserDomains: ["openai.com", "platform.openai.com", "help.openai.com"],
      filesystem: {
        readRoots: [smokeAppData.dir, assetDir],
        writeRoots: [smokeAppData.dir, assetDir]
      },
      commands: {
        allowPrefixes: ["node"],
        denyPatterns: ["password", "token", "cookie", "secret", "api_key", "rm -rf", "format"]
      },
      packageInstall: false,
      osMutation: false,
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      credentialAccess: "never",
      riskClasses: ["read_only", "reversible"],
      maxRuntimeMs: 60_000,
      maxOutputBytes: 4 * 1024 * 1024,
      maxIterations: 3
    }
  });
  assert.equal(profile.ok, true);

  const started = await postJson("/computer-use/sessions", {
    userRequest: "OpenAI 홈페이지에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.",
    requestedSurface: "tool_workspace",
    profileId: profile.profile.id,
    metadata: {
      createsLocalArtifact: true,
      requiresGeneratedTool: true
    }
  });
  assert.equal(started.ok, true);
  const sessionId = started.result.session.sessionId;

  const operation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    operation: {
      kind: "toolsmith",
      input: {
        goal: "OpenAI 홈페이지에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.",
        permissionProfileId: profile.profile.id,
        outputRoot,
        title: "Computer Use OpenAI Codex live source report",
        urls: liveUrls,
        browserFallbackDocuments
      }
    },
    waitMs: 60_000
  });
  const elapsedMs = Date.now() - startedAtMs;
  assert.equal(operation.ok, true);

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  const sourceSummary = readToolsmithSourceSummary(bundle.bundle);
  const reportResources = bundle.bundle.evalResources.filter((resource) => resource.role === "toolsmith_report");
  const pdfResource = bundle.bundle.evalResources.find((resource) => resource.role === "toolsmith_pdf");
  const pdfBytes = pdfResource?.id
    ? await getBytes(`/computer-use/eval/runs/${encodeURIComponent(bundle.bundle.evalRun.id)}/resources/${encodeURIComponent(pdfResource.id)}/content?download=1`)
    : null;
  const reportText = reportResources.length
    ? (await Promise.all(reportResources.map((resource) =>
        getText(`/computer-use/eval/runs/${encodeURIComponent(bundle.bundle.evalRun.id)}/resources/${encodeURIComponent(resource.id)}/content`)
      ))).join("\n\n--- report resource ---\n\n")
    : "";
  const autonomyRuns = await getJson(`/computer-use/autonomy/runs?sessionId=${encodeURIComponent(sessionId)}`);
  const autonomyRun = autonomyRuns.runs.find((run) => run.status === "completed" && run.sessionId === sessionId);
  const validSourceSummaryCount = (sourceSummary?.rows ?? []).filter((row) =>
    (row.status === "200" || row.status === "browser_fallback" || row.browserFallback === true) &&
    Number(row.chars) > 300
  ).length;
  const validBrowserCaptureCount = browserFallbackDocuments.filter((doc) => doc.text.length > 300).length;
  const validLiveSourceCount = Math.max(validSourceSummaryCount, validBrowserCaptureCount);
  const sourceQuality = evaluateSourceQuality({
    rows: sourceSummary?.rows ?? [],
    browserFallbackDocuments,
    reportText
  });
  const browserFallbackCalibration = evaluateBrowserFallbackCalibration(browserFallbackDocuments);
  const scenario = {
    id: "computer-use-session-live-openai-web-research-to-pdf",
    userScenario: "사용자가 위젯 Computer Use 세션에 OpenAI Codex 관련 공식 문서를 조사해서 PDF로 저장해 달라고 요청한다.",
    architectureWorkflow: [
      "renderer-equivalent request creates a tool_workspace Computer Session with a scoped one-time permission profile",
      "ComputerSessionRuntime routes the operation to Toolsmith and links the child autonomy DAG to the parent action node",
      "Toolsmith materializes web_research_to_pdf.v2 in the runtime workspace and passes smoke before execution",
      "live official OpenAI source pages are captured through browser-backed fallback when daemon-side HTTP is blocked",
      "crawl_or_observe, extract, verify_sources, draft_markdown, render_pdf, store_artifact, and verify_artifact run as distinct child DAG stages",
      "parent Computer Session mirrors report/PDF artifacts into eval resources and debug-bundle observations",
      "parent DAG records action, verification, eval_ledger, store_artifact, and verify_artifact proof nodes"
    ],
    success: operation.result.dagNode.status === "completed" &&
      bundle.bundle.session.state === "completed" &&
      Boolean(autonomyRun) &&
      Boolean(pdfBytes && Buffer.from(pdfBytes.bytes).subarray(0, 5).toString("ascii") === "%PDF-") &&
      reportText.includes("Codex") &&
      validLiveSourceCount > 0 &&
      bundle.bundle.dagNodes.some((node) => node.id === `${operation.result.dagNode.id}:store_artifact` && node.status === "completed") &&
      bundle.bundle.dagNodes.some((node) => node.id === `${operation.result.dagNode.id}:verify_artifact` && node.status === "completed"),
    result: {
      sessionId,
      evalRunId: bundle.bundle.evalRun.id,
      autonomyRunId: autonomyRun?.id,
      outputRoot,
      elapsedMs,
      p50LatencyMs: elapsedMs,
      p95LatencyMs: elapsedMs,
      sourceSummary,
      validLiveSourceCount,
      validSourceSummaryCount,
      validBrowserCaptureCount,
      fallbackOnly: sourceQuality.fallbackOnly,
      sourceQualityReview: sourceQuality.status,
      sourceQualityEvidence: sourceQuality,
      browserFallbackCalibration,
      browserFallbackCaptures: browserFallbackDocuments.map((doc) => ({
        url: doc.url,
        chars: doc.text.length,
        textSha256: doc.capture.textSha256,
        status: doc.capture.status,
        title: doc.title
      })),
      artifactRoles: bundle.bundle.evalResources.map((resource) => resource.role),
      pdfBytes: pdfBytes?.bytes.byteLength,
      reportChars: reportText.length
    },
    followUp: [
      "Current live success depends on browser-backed public documentation capture because daemon-side HTTP can return 403.",
      "Promotion still needs repeated parent Computer Session live runs, p95 latency tracking, and non-fallback transport calibration.",
      "This dogfood proves the parent Computer Session evidence path, not only the child scoped-autonomy runtime."
    ]
  };
  const evidence = {
    generatedAt: new Date().toISOString(),
    metrics: {
      scenarioCount: 1,
      p50LatencyMs: elapsedMs,
      p95LatencyMs: elapsedMs,
      sourceQualityReview: sourceQuality.status,
      fallbackOnly: sourceQuality.fallbackOnly,
      browserFallbackCalibration: browserFallbackCalibration.status
    },
    scenarios: [scenario],
    debugBundle: bundle.bundle
  };
  mkdirSync(join(repoRoot, "docs", "dogfood"), { recursive: true });
  mkdirSync(join(repoRoot, "docs", "reports"), { recursive: true });
  writeFileSync(dogfoodPath, `${JSON.stringify({ generatedAt: evidence.generatedAt, scenarios: [scenario] }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");
  appendLiveSample(sampleLedgerPath, {
    generatedAt: evidence.generatedAt,
    date: DATE,
    evidencePath: normalizePath(evidencePath),
    reportPath: normalizePath(reportPath),
    scenario: redactScenarioForSampleLedger(scenario)
  });
  assert.equal(scenario.success, true);
  console.log(`computer use toolsmith live dogfood evidence written: ${reportPath}`);
} finally {
  await daemon.close();
  smokeAppData.cleanup();
}

async function captureBrowserFallbackDocuments(urls) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 CodexWidgetDogfood/1.0"
    });
    const captures = [];
    for (const url of urls) {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForTimeout(750);
      const title = await page.title().catch(() => "");
      const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      if (!text.trim()) {
        continue;
      }
      captures.push({
        title: title || url,
        url,
        text: text.replace(/\s+/g, " ").trim().slice(0, 12_000),
        capture: {
          command: "playwright.browser_capture",
          status: response?.status() ?? 0,
          title,
          chars: text.length,
          textSha256: sha256(text),
          capturedAt: new Date().toISOString(),
          dataOmitted: true
        }
      });
    }
    return captures;
  } finally {
    await browser.close();
  }
}

function readToolsmithSourceSummary(bundle) {
  const observation = bundle.observations.find((candidate) =>
    candidate.kind === "file" &&
    candidate.source === "toolsmith_scoped_autonomy" &&
    candidate.metadata?.sourceSummary
  );
  return observation?.metadata?.sourceSummary ?? null;
}

function renderReport(evidence) {
  const scenario = evidence.scenarios[0];
  const lines = [
    "# Computer Use Toolsmith Live Dogfood",
    "",
    `Generated: ${evidence.generatedAt}`,
    "",
    `## ${scenario.id}`,
    "",
    `User scenario: ${scenario.userScenario}`,
    "",
    `Success: ${scenario.success ? "passed" : "failed"}`,
    "",
    "Architecture workflow:"
  ];
  for (const step of scenario.architectureWorkflow) {
    lines.push(`- ${step}`);
  }
  lines.push("", "Source status:");
  for (const row of scenario.result.sourceSummary?.rows ?? []) {
    lines.push(`- ${row.url}: ${row.status}, ${row.chars ?? "unknown"} chars${row.browserFallback ? ", browser fallback" : ""}`);
  }
  lines.push("", "Browser fallback captures:");
  for (const capture of scenario.result.browserFallbackCaptures ?? []) {
    lines.push(`- ${capture.url}: ${capture.status}, ${capture.chars} chars, ${capture.title}`);
  }
  lines.push("", "Artifacts:");
  for (const role of scenario.result.artifactRoles) {
    lines.push(`- ${role}`);
  }
  lines.push("", "Timing and quality:");
  lines.push(`- elapsedMs: ${scenario.result.elapsedMs}`);
  lines.push(`- p95LatencyMs: ${scenario.result.p95LatencyMs}`);
  lines.push(`- sourceQualityReview: ${scenario.result.sourceQualityReview}`);
  lines.push(`- fallbackOnly: ${scenario.result.fallbackOnly}`);
  lines.push(`- browserFallbackCalibration: ${scenario.result.browserFallbackCalibration.status}`);
  lines.push("", "Follow-up:");
  for (const item of scenario.followUp) {
    lines.push(`- ${item}`);
  }
  lines.push("", `Raw evidence: docs/reports/assets/computer-use-toolsmith-live-${DATE}/evidence.json`, "");
  return lines.join("\n");
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function getText(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.text();
}

async function getBytes(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return {
    contentType: response.headers.get("content-type"),
    bytes: new Uint8Array(await response.arrayBuffer())
  };
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

function evaluateSourceQuality({ rows, browserFallbackDocuments, reportText }) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const directFetchedSourceCount = sourceRows.filter((row) =>
    String(row.status) === "200" &&
    row.browserFallback !== true &&
    Number(row.chars ?? 0) > 300
  ).length;
  const fallbackSourceCount = Math.max(
    sourceRows.filter((row) =>
      (row.browserFallback === true || String(row.status) === "browser_fallback") &&
      Number(row.chars ?? 0) > 300
    ).length,
    browserFallbackDocuments.filter((doc) => doc.text.length > 300).length
  );
  const officialSourceCount = sourceRows.filter((row) =>
    typeof row.url === "string" &&
    /(^|\/\/)?(help\.openai\.com|platform\.openai\.com|openai\.com)\b/.test(row.url) &&
    (Number(row.chars ?? 0) > 300 || row.browserFallback === true || String(row.status) === "browser_fallback")
  ).length;
  const officialFallbackSourceCount = browserFallbackDocuments.filter((doc) =>
    typeof doc.url === "string" &&
    /(^|\/\/)?(help\.openai\.com|platform\.openai\.com|openai\.com)\b/.test(doc.url) &&
    doc.text.length > 300
  ).length;
  const totalChars = Math.max(
    sourceRows.reduce((sum, row) => sum + Number(row.chars ?? 0), 0),
    browserFallbackDocuments.reduce((sum, doc) => sum + doc.text.length, 0)
  );
  const codexMentioned = /codex/i.test(`${reportText}\n${sourceRows.map((row) => row.title ?? row.url ?? "").join("\n")}`);
  const accepted = Math.max(officialSourceCount, officialFallbackSourceCount) >= 2 && totalChars >= 1_000 && codexMentioned;
  return {
    status: accepted ? "accepted" : "needs_review",
    officialSourceCount: Math.max(officialSourceCount, officialFallbackSourceCount),
    totalChars,
    codexMentioned,
    directFetchedSourceCount,
    fallbackSourceCount,
    fallbackOnly: directFetchedSourceCount === 0 && fallbackSourceCount > 0,
    basis: [
      "requires at least two official OpenAI sources over 300 chars",
      "requires total extracted source text over 1000 chars",
      "requires Codex to appear in the generated report or source metadata",
      "records fallbackOnly separately so accepted content quality does not imply direct-fetch promotion"
    ]
  };
}

function evaluateBrowserFallbackCalibration(browserFallbackDocuments) {
  const captures = browserFallbackDocuments.map((doc) => ({
    origin: redactUrlToOrigin(doc.url),
    urlHash: sha256(doc.url),
    status: doc.capture.status,
    chars: doc.text.length,
    titleSha256: sha256(doc.title || doc.url),
    textSha256: doc.capture.textSha256 ?? sha256(doc.text)
  }));
  const accepted = captures.length >= 2 &&
    captures.every((capture) =>
      Number(capture.status) >= 200 &&
      Number(capture.status) < 400 &&
      capture.chars > 300 &&
      typeof capture.textSha256 === "string" &&
      capture.textSha256.length === 64
    );
  return {
    schemaVersion: "browser-fallback-calibration.v1",
    status: accepted ? "accepted" : "needs_review",
    captureCount: captures.length,
    captures,
    basis: [
      "requires at least two browser-captured official sources",
      "requires HTTP 2xx/3xx browser response status for every capture",
      "requires every captured body to exceed 300 chars",
      "stores text hashes and lengths only; raw browser text is omitted from sample ledgers",
      "promotion gate still requires repeated samples with stable capture hashes"
    ]
  };
}

function appendLiveSample(path, sample) {
  mkdirSync(join(repoRoot, "docs", "reports", "assets"), { recursive: true });
  appendFileSync(path, `${JSON.stringify(sample)}\n`, "utf8");
}

function redactScenarioForSampleLedger(scenario) {
  return {
    id: scenario.id,
    success: scenario.success,
    result: {
      elapsedMs: scenario.result.elapsedMs,
      p50LatencyMs: scenario.result.p50LatencyMs,
      p95LatencyMs: scenario.result.p95LatencyMs,
      validLiveSourceCount: scenario.result.validLiveSourceCount,
      validSourceSummaryCount: scenario.result.validSourceSummaryCount,
      validBrowserCaptureCount: scenario.result.validBrowserCaptureCount,
      fallbackOnly: scenario.result.fallbackOnly,
      sourceQualityReview: scenario.result.sourceQualityReview,
      sourceQualityEvidence: {
        status: scenario.result.sourceQualityEvidence.status,
        officialSourceCount: scenario.result.sourceQualityEvidence.officialSourceCount,
        totalChars: scenario.result.sourceQualityEvidence.totalChars,
        codexMentioned: scenario.result.sourceQualityEvidence.codexMentioned,
        directFetchedSourceCount: scenario.result.sourceQualityEvidence.directFetchedSourceCount,
        fallbackSourceCount: scenario.result.sourceQualityEvidence.fallbackSourceCount,
        fallbackOnly: scenario.result.sourceQualityEvidence.fallbackOnly
      },
      browserFallbackCalibration: {
        status: scenario.result.browserFallbackCalibration.status,
        captureCount: scenario.result.browserFallbackCalibration.captureCount,
        captures: scenario.result.browserFallbackCalibration.captures
      },
      sourceSummary: {
        sourceCount: scenario.result.sourceSummary?.sourceCount,
        rows: (scenario.result.sourceSummary?.rows ?? []).map((row) => ({
          url: redactUrlToOrigin(row.url),
          status: row.status,
          chars: row.chars,
          browserFallback: row.browserFallback
        }))
      }
    }
  };
}

function redactUrlToOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return String(value ?? "").split("/")[0];
  }
}

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(`${repoRoot.replace(/\\/g, "/")}/`, "");
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function formatSeoulDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}
