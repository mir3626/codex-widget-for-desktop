#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { ScopedAutonomyRuntime } from "../dist/daemon/scoped-autonomy/index.js";

const DATE = process.env.CODEX_WIDGET_DOGFOOD_DATE ?? formatSeoulDate(new Date());
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `scoped-autonomy-web-research-live-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `scoped-autonomy-web-research-live-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `scoped-autonomy-web-research-live-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const sampleLedgerPath = join(repoRoot, "docs", "reports", "assets", "scoped-autonomy-web-research-live-runs.jsonl");
const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-web-research-live-"));
const liveUrls = [
  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
  "https://platform.openai.com/docs/codex/overview",
  "https://platform.openai.com/docs/docs-mcp"
];
let storage;

try {
  rmSync(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(assetDir, { recursive: true });
  storage = createStorageService({ appDataDir: tempRoot });
  const runtime = new ScopedAutonomyRuntime(storage, { runtimeRoot: join(tempRoot, ".runtime", "autonomy") });
  const profile = storage.createAutonomyPermissionProfile({
    name: "dogfood live OpenAI web research",
    mode: "scoped_yolo",
    grants: {
      network: true,
      networkDomains: ["openai.com", "platform.openai.com", "help.openai.com"],
      browserAutomation: true,
      browserDomains: ["openai.com", "platform.openai.com", "help.openai.com"],
      filesystem: {
        readRoots: [tempRoot, assetDir],
        writeRoots: [tempRoot, assetDir]
      },
      commands: {
        allowPrefixes: ["node"],
        denyPatterns: ["password", "token", "cookie", "secret", "api_key"]
      },
      packageInstall: false,
      osMutation: false,
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      credentialAccess: "never",
      riskClasses: ["read_only", "reversible"],
      maxRuntimeMs: 45_000,
      maxOutputBytes: 4 * 1024 * 1024,
      maxIterations: 3
    }
  });

  const outputRoot = join(assetDir, "live-report");
  const startedAtMs = Date.now();
  const browserFallbackDocuments = await captureBrowserFallbackDocuments(liveUrls);
  const result = await runtime.runGoalDag({
    goal: "OpenAI 홈페이지에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    title: "OpenAI Codex live source report",
    urls: liveUrls,
    browserFallbackDocuments
  });
  const elapsedMs = Date.now() - startedAtMs;
  const run = storage.readAutonomyRun(result.run.id);
  const outputDir = run.output.outputDir;
  const citationsPath = join(outputDir, "citations.json");
  const pdfPath = join(outputDir, "report.pdf");
  const reportMarkdownPath = join(outputDir, "report.md");
  const crawlRun = result.toolRuns.find((toolRun) => {
    const input = toolRun.input && typeof toolRun.input === "object" ? toolRun.input : {};
    return input.command === "crawl_or_observe";
  });
  const citations = existsSync(citationsPath) ? JSON.parse(readFileSync(citationsPath, "utf8")) : [];
  const liveUrlsObserved = Array.isArray(crawlRun?.output?.urlsFetched)
    ? crawlRun.output.urlsFetched
    : citations.filter((citation) => citation.url).map((citation) => citation.url);
  const liveEvidenceUrls = citations
    .filter((citation) => citation.url && (citation.fetched === true || citation.browserFallback === true))
    .map((citation) => citation.url);
  const validLiveSourceCount = citations.filter((citation) =>
    String(citation.status) === "200" ||
    citation.browserFallback === true ||
    String(citation.status) === "browser_fallback"
  ).filter((citation) => Number(citation.chars) > 300).length;
  const reportText = existsSync(reportMarkdownPath) ? readFileSync(reportMarkdownPath, "utf8") : "";
  const sourceQuality = evaluateSourceQuality({
    statuses: citations,
    browserFallbackDocuments,
    reportText
  });
  const browserFallbackCalibration = evaluateBrowserFallbackCalibration(browserFallbackDocuments);
  const scenario = {
    id: "scoped-autonomy-live-openai-web-research-to-pdf",
    userScenario: "사용자가 OpenAI 웹사이트에서 Codex 관련 내용을 실제로 읽어 PDF 파일로 달라고 요청한다.",
    architectureWorkflow: [
      "permission_check grants only openai.com and platform.openai.com live fetches",
      "Toolsmith materializes web_research_to_pdf.v2 in runtime workspace and passes smoke before live execution",
      "crawl_or_observe performs live allowed-domain fetches and records HTTP status per source",
      "if daemon-side HTTP is blocked, browser-backed capture is supplied as bounded fallback evidence",
      "extract and verify_sources build a citation table from live response text",
      "draft_markdown and render_pdf produce persistent artifacts",
      "store_artifact writes blob-backed eval resources and verify_artifact checks the PDF header"
    ],
    success: result.run.status === "completed"
      && existsSync(pdfPath)
      && readFileSync(pdfPath).subarray(0, 5).toString("ascii") === "%PDF-"
      && liveEvidenceUrls.length > 0
      && citations.some((citation) => String(citation.url).includes("openai.com"))
      && validLiveSourceCount > 0,
    result: {
      runId: result.run.id,
      toolSpecId: result.spec?.id,
      outputDir,
      elapsedMs,
      p50LatencyMs: elapsedMs,
      p95LatencyMs: elapsedMs,
      liveUrlsObserved,
      liveEvidenceUrls,
      validLiveSourceCount,
      validSourceSummaryCount: validLiveSourceCount,
      browserFallbackCount: citations.filter((citation) => citation.browserFallback === true).length,
      validBrowserCaptureCount: browserFallbackDocuments.filter((doc) => doc.text.length > 300).length,
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
      statuses: citations.map((citation) => ({
        url: citation.url,
        status: citation.status,
        chars: citation.chars,
        browserFallback: citation.browserFallback === true
      }))
    },
    followUp: [
      "OpenAI pages may return HTTP 403 to daemon-side fetch in this environment; browser-backed capture is therefore included as bounded fallback evidence.",
      "Browser fallback text has accepted content-quality evidence but still requires repeated p95 samples and non-fallback transport calibration before promotion.",
      "Promotion should require repeated live runs and p95 latency comparison, not this single dogfood result."
    ]
  };

  const evidence = {
    generatedAt: new Date().toISOString(),
    storageSchemaVersion: storage.health().schemaVersion,
    metrics: {
      scenarioCount: 1,
      p50LatencyMs: elapsedMs,
      p95LatencyMs: elapsedMs,
      sourceQualityReview: sourceQuality.status,
      fallbackOnly: sourceQuality.fallbackOnly,
      browserFallbackCalibration: browserFallbackCalibration.status
    },
    scenarios: [scenario],
    debugBundle: runtime.createDebugBundle(result.run.id),
    citations
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
  console.log(`scoped autonomy live web research dogfood evidence written: ${reportPath}`);
} finally {
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function captureBrowserFallbackDocuments(urls) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 CodexWidgetDogfood/1.0"
    });
    const captures = [];
    for (const url of urls) {
      try {
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
      } catch (error) {
        captures.push({
          title: url,
          url,
          text: `Browser capture failed: ${readError(error)}`,
          capture: {
            command: "playwright.browser_capture",
            status: "failed",
            error: readError(error),
            capturedAt: new Date().toISOString(),
            dataOmitted: true
          }
        });
      }
    }
    return captures;
  } finally {
    await browser.close();
  }
}

function renderReport(evidence) {
  const scenario = evidence.scenarios[0];
  const lines = [
    "# Scoped Autonomy Live Web Research Dogfood",
    "",
    `Generated: ${evidence.generatedAt}`,
    `Storage schema version: ${evidence.storageSchemaVersion}`,
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
  lines.push("", "Live source status:");
  for (const status of scenario.result.statuses) {
    lines.push(`- ${status.url}: ${status.status}, ${status.chars} chars${status.browserFallback ? ", browser fallback" : ""}`);
  }
  lines.push("", "Browser fallback captures:");
  for (const capture of scenario.result.browserFallbackCaptures) {
    lines.push(`- ${capture.url}: ${capture.status}, ${capture.chars} chars, ${capture.title}`);
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
  lines.push("", `Raw evidence: docs/reports/assets/scoped-autonomy-web-research-live-${DATE}/evidence.json`, "");
  return lines.join("\n");
}

function readError(error) {
  return error instanceof Error ? error.message : String(error);
}

function evaluateSourceQuality({ statuses, browserFallbackDocuments, reportText }) {
  const rows = Array.isArray(statuses) ? statuses : [];
  const directFetchedSourceCount = rows.filter((row) =>
    String(row.status) === "200" &&
    row.browserFallback !== true &&
    Number(row.chars ?? 0) > 300
  ).length;
  const fallbackSourceCount = Math.max(
    rows.filter((row) =>
      (row.browserFallback === true || String(row.status) === "browser_fallback") &&
      Number(row.chars ?? 0) > 300
    ).length,
    browserFallbackDocuments.filter((doc) => doc.text.length > 300).length
  );
  const officialSourceCount = rows.filter((row) =>
    typeof row.url === "string" &&
    /(^|\/\/)(help\.openai\.com|platform\.openai\.com|openai\.com)\b/.test(row.url) &&
    Number(row.chars ?? 0) > 300
  ).length;
  const totalChars = rows.reduce((sum, row) => sum + Number(row.chars ?? 0), 0);
  const codexMentioned = /codex/i.test(`${reportText}\n${rows.map((row) => row.title ?? row.url ?? "").join("\n")}`);
  const accepted = officialSourceCount >= 2 && totalChars >= 1_000 && codexMentioned;
  return {
    status: accepted ? "accepted" : "needs_review",
    officialSourceCount,
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
      browserFallbackCount: scenario.result.browserFallbackCount,
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
      statuses: scenario.result.statuses.map((row) => ({
        url: redactUrlToOrigin(row.url),
        status: row.status,
        chars: row.chars,
        browserFallback: row.browserFallback
      }))
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
