#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { chromium } from "@playwright/test";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { ScopedAutonomyRuntime } from "../dist/daemon/scoped-autonomy/index.js";

const DATE = process.env.CODEX_WIDGET_DOGFOOD_DATE ?? formatSeoulDate(new Date());
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `scoped-autonomy-generated-tool-live-breadth-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `scoped-autonomy-generated-tool-live-breadth-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `scoped-autonomy-generated-tool-live-breadth-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const sampleLedgerPath = join(repoRoot, "docs", "reports", "assets", "scoped-autonomy-generated-tool-live-breadth-runs.jsonl");
const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-generated-tool-live-breadth-"));
const liveUrls = [
  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
  "https://platform.openai.com/docs/codex/overview",
  "https://platform.openai.com/docs/docs-mcp"
];
const downloadUrl = "https://example.com/";
let storage;

try {
  rmSync(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(assetDir, { recursive: true });
  storage = createStorageService({ appDataDir: tempRoot });
  const runtime = new ScopedAutonomyRuntime(storage, { runtimeRoot: join(tempRoot, ".runtime", "autonomy") });
  const generatedAt = new Date().toISOString();
  const scenarios = [];

  for (const iteration of [1, 2]) {
    scenarios.push(await runLiveWebResearchPdf({ storage, runtime, iteration }));
    scenarios.push(await runLiveLocalDocumentConversion({ storage, runtime, iteration }));
    scenarios.push(await runLiveTerminalGeneratedTool({ storage, runtime, iteration }));
    scenarios.push(await runLiveBrowserDownloadVerify({ storage, runtime, iteration }));
  }

  const repeatedSamples = buildLiveSampleLedgerEntries({
    generatedAt,
    evidencePath: relativeRepoPath(evidencePath),
    scenarios
  });
  const redactedScenarios = redactPaths(scenarios);
  const rawEvidence = {
    schemaVersion: "scoped-autonomy-generated-tool-live-breadth-dogfood.v1",
    generatedAt,
    storageSchemaVersion: storage.health().schemaVersion,
    scenarios: redactedScenarios,
    metrics: summarizeScenarios(redactedScenarios, repeatedSamples),
    sampleLedger: relativeRepoPath(sampleLedgerPath),
    improvementItems: [
      "This is repeated live/local-live generated-tool breadth evidence, not unrestricted desktop automation.",
      "web_research_to_pdf uses live official OpenAI browser-captured source evidence when daemon-side HTTP is blocked.",
      "local_document_conversion converts an approved local Markdown source file and records only source hash/artifact evidence.",
      "terminal_generated_tool uses a real local Node runtime command with shell expansion disabled.",
      "browser_download_verify validates a file produced from a public browser-backed fetch and records only hash/size/source metadata.",
      "Promotion remains a review decision; high-risk native Windows mutation is still covered by the separate non-promoting boundary gate."
    ]
  };
  const evidence = {
    ...rawEvidence,
    redaction: {
      rawPathsRedacted: true,
      repoPathsRelative: true,
      absolutePathLeakCount: countAbsolutePathLeaks(JSON.stringify(rawEvidence))
    }
  };

  mkdirSync(join(repoRoot, "docs", "dogfood"), { recursive: true });
  mkdirSync(join(repoRoot, "docs", "reports"), { recursive: true });
  writeFileSync(dogfoodPath, `${JSON.stringify({ generatedAt: evidence.generatedAt, scenarios: evidence.scenarios }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");
  appendLiveSampleLedger(sampleLedgerPath, repeatedSamples);

  assert.equal(evidence.scenarios.every((scenario) => scenario.success), true);
  assert.equal(evidence.metrics.requiredGeneratedClassesPresent, true);
  assert.equal(evidence.metrics.repeatedLiveRunsPresent, true);
  assert.equal(evidence.metrics.localDocumentConversionVerified, true);
  assert.equal(evidence.metrics.pathRedactionPresent, true);
  assert.equal(evidence.redaction.absolutePathLeakCount, 0, "live breadth evidence must not leak absolute local paths");
  assert.equal(countAbsolutePathLeaks(repeatedSamples.map((sample) => JSON.stringify(sample)).join("\n")), 0, "sample ledger entries must not leak absolute local paths");
  console.log(`scoped autonomy generated-tool live breadth dogfood evidence written: ${reportPath}`);
} finally {
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function runLiveWebResearchPdf({ storage, runtime, iteration }) {
  const outputRoot = join(assetDir, `web-research-live-${iteration}`);
  const profile = createBroadProfile(storage, {
    name: `live generated tool web pdf ${iteration}`,
    riskClasses: ["read_only", "reversible"],
    networkDomains: ["openai.com", "platform.openai.com", "help.openai.com"],
    browserDomains: ["openai.com", "platform.openai.com", "help.openai.com"]
  });
  const startedAt = Date.now();
  const browserFallbackDocuments = await captureBrowserFallbackDocuments(liveUrls);
  const result = await runtime.runGoalDag({
    goal: "OpenAI 홈페이지에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    title: `OpenAI Codex generated-tool live breadth ${iteration}`,
    urls: liveUrls,
    browserFallbackDocuments
  });
  const elapsedMs = Date.now() - startedAt;
  const run = storage.readAutonomyRun(result.run.id);
  const outputDir = run.output.outputDir;
  const citationsPath = join(outputDir, "citations.json");
  const pdfPath = join(outputDir, "report.pdf");
  const reportMarkdownPath = join(outputDir, "report.md");
  const citations = existsSync(citationsPath) ? JSON.parse(readFileSync(citationsPath, "utf8")) : [];
  const reportText = existsSync(reportMarkdownPath) ? readFileSync(reportMarkdownPath, "utf8") : "";
  const executionRun = result.toolRuns.findLast((toolRun) => toolRun.status === "completed" && toolRun.mode === "execute");
  assert.ok(executionRun, "live web/PDF should complete at least one execute tool run");
  const rerun = await runtime.rerunToolRun({ toolRunId: executionRun.id });
  const rerunComparison = rerun.output?.rerunComparison ?? {};
  const sourceQuality = evaluateSourceQuality({
    rows: citations,
    browserFallbackDocuments,
    reportText
  });
  const browserFallbackCalibration = evaluateBrowserFallbackCalibration(browserFallbackDocuments);
  const validLiveSourceCount = Math.max(
    citations.filter((citation) =>
      (String(citation.status) === "200" || citation.browserFallback === true || String(citation.status) === "browser_fallback") &&
      Number(citation.chars ?? 0) > 300
    ).length,
    browserFallbackDocuments.filter((doc) => doc.text.length > 300).length
  );
  return {
    id: `generated-tool-live-web-research-to-pdf-${iteration}`,
    capability: "web_research_to_pdf",
    sourceClass: "official_openai_browser_captured_web",
    userScenario: "사용자가 공식 OpenAI Codex 문서를 조사해 PDF 파일로 달라고 요청한다.",
    architectureWorkflow: [
      "permission profile grants only official OpenAI domains, generated code, generated-tool execution, and the dogfood output root",
      "Toolsmith materializes web_research_to_pdf in the runtime workspace and runs smoke before execution",
      "live official OpenAI pages are browser-captured when daemon-side HTTP is blocked",
      "generated tool creates Markdown/PDF/citation artifacts and records source hash evidence",
      "rerun uses the stored generated-tool manifest and compares stable output fingerprints"
    ],
    success: result.run.status === "completed"
      && existsSync(pdfPath)
      && readFileSync(pdfPath).subarray(0, 5).toString("ascii") === "%PDF-"
      && validLiveSourceCount >= 2
      && sourceQuality.status === "accepted"
      && browserFallbackCalibration.status === "accepted"
      && rerun.status === "completed"
      && rerunComparison.matched === true,
    result: {
      runId: result.run.id,
      toolSpecId: result.spec?.id,
      capability: "web_research_to_pdf",
      sourceClass: "official_openai_browser_captured_web",
      outputDir,
      elapsedMs,
      executeElapsedMs: result.toolRuns.reduce((sum, toolRun) => sum + Math.max(0, Number(toolRun.elapsedMs ?? 0)), 0),
      rerunElapsedMs: rerun.elapsedMs,
      rerunMatched: rerunComparison.matched === true,
      rerunArtifactMatched: rerunComparison.artifactComparison?.matched === true,
      validLiveSourceCount,
      sourceQualityReview: sourceQuality.status,
      sourceQualityEvidence: sourceQuality,
      browserFallbackCalibration,
      sourceHashes: browserFallbackCalibration.captures,
      pdfSha256: sha256File(pdfPath),
      reportSha256: existsSync(reportMarkdownPath) ? sha256File(reportMarkdownPath) : undefined
    },
    followUp: [
      "Keep direct-fetch and browser-fallback calibration separate; fallback content quality does not imply direct HTTP stability.",
      "Do not promote high-risk native workflows based on web/PDF success."
    ]
  };
}

async function runLiveTerminalGeneratedTool({ storage, runtime, iteration }) {
  const outputRoot = join(assetDir, `terminal-live-${iteration}`);
  const profile = createBroadProfile(storage, {
    name: `live generated terminal tool ${iteration}`,
    riskClasses: ["read_only", "reversible", "side_effect"],
    commandPrefixes: ["node"]
  });
  const plan = runtime.plan({
    goal: "node --version을 실행하는 안전한 local script 도구 생성해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    availableCapabilities: []
  });
  const implementation = await runtime.selfImplementTool({ autonomyRunId: plan.run.id, gapId: plan.gaps[0].id });
  const execution = await runtime.execute({
    autonomyRunId: plan.run.id,
    toolSpecId: implementation.spec.id,
    request: {
      outputDir: outputRoot,
      command: "node --version"
    }
  });
  const rerun = await runtime.rerunToolRun({ toolRunId: execution.id });
  const rerunComparison = rerun.output?.rerunComparison ?? {};
  const stdoutPath = join(outputRoot, "stdout.txt");
  const stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf8").trim() : "";
  return {
    id: `generated-tool-live-terminal-node-version-${iteration}`,
    capability: "terminal_generated_tool",
    sourceClass: "local_node_runtime",
    userScenario: "사용자가 안전한 generated local script로 Node 런타임 버전을 확인해 달라고 요청한다.",
    architectureWorkflow: [
      "gap detector classifies terminal_generated_tool",
      "Toolsmith writes a no-shell Node wrapper in the runtime workspace",
      "permission profile allows only the node command prefix and dogfood output root",
      "execution spawns node without shell expansion and stores stdout/stderr artifacts",
      "rerun compares stable generated-tool output fingerprints"
    ],
    success: implementation.spec.status === "active"
      && execution.status === "completed"
      && rerun.status === "completed"
      && rerunComparison.matched === true
      && stdout.startsWith("v"),
    result: {
      runId: plan.run.id,
      toolSpecId: implementation.spec.id,
      capability: "terminal_generated_tool",
      sourceClass: "local_node_runtime",
      executeElapsedMs: execution.elapsedMs,
      rerunElapsedMs: rerun.elapsedMs,
      rerunMatched: rerunComparison.matched === true,
      rerunArtifactMatched: rerunComparison.artifactComparison?.matched === true,
      stdoutStartsWithVersion: stdout.startsWith("v"),
      stdoutSha256: existsSync(stdoutPath) ? sha256File(stdoutPath) : undefined
    },
    followUp: [
      "Richer terminal generated tools still need explicit command parser tests and promotion review.",
      "Shell features remain unavailable unless a future profile explicitly grants a safe shell parser."
    ]
  };
}

async function runLiveLocalDocumentConversion({ storage, runtime, iteration }) {
  const sourceDir = join(assetDir, `local-conversion-live-${iteration}`, "sources");
  mkdirSync(sourceDir, { recursive: true });
  const sourcePath = join(sourceDir, "conversion-source.md");
  const sourceMarkdown = [
    `# Local Document Conversion Live Breadth ${iteration}`,
    "",
    "This source file is created under the approved dogfood asset root.",
    "",
    "It verifies that Toolsmith can read an explicitly granted local Markdown path,",
    "convert it to report.md and report.pdf, and keep evidence path-redacted.",
    "",
    `Iteration: ${iteration}`
  ].join("\n");
  writeFileSync(sourcePath, `${sourceMarkdown}\n`, "utf8");
  const outputRoot = join(assetDir, `local-conversion-live-${iteration}`, "outputs");
  const profile = createBroadProfile(storage, {
    name: `live local document conversion ${iteration}`,
    riskClasses: ["read_only", "reversible"]
  });
  const startedAt = Date.now();
  const result = await runtime.runGoalDag({
    goal: "승인된 로컬 Markdown 파일을 PDF 문서로 변환해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    title: `Local document conversion live breadth ${iteration}`,
    sourcePath
  });
  const elapsedMs = Date.now() - startedAt;
  const run = storage.readAutonomyRun(result.run.id);
  const outputDir = run.output.outputDir;
  if (result.run.status !== "completed" || typeof outputDir !== "string") {
    throw new Error(`local_document_conversion_run_failed:${JSON.stringify({
      status: run.status,
      failureClass: run.failureClass,
      failureReason: run.output?.failureReason,
      gaps: storage.listAutonomyCapabilityGaps(run.id).map((gap) => gap.requestedCapability),
      toolRuns: storage.listAutonomyToolRuns({ autonomyRunId: run.id }).map((toolRun) => ({
        mode: toolRun.mode,
        status: toolRun.status,
        lastError: toolRun.lastError,
        stage: toolRun.output?.stage
      }))
    })}`);
  }
  const pdfPath = join(outputDir, "report.pdf");
  const reportPath = join(outputDir, "report.md");
  const dagNodes = storage.listCapabilityDagNodes(run.dagRunId);
  const executionRun = result.toolRuns.findLast((toolRun) => toolRun.status === "completed" && toolRun.mode === "execute");
  assert.ok(executionRun, "local document conversion should complete at least one execute tool run");
  const rerun = await runtime.rerunToolRun({ toolRunId: executionRun.id });
  const rerunComparison = rerun.output?.rerunComparison ?? {};
  const sourceBytes = readFileSync(sourcePath);
  const reportText = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "";
  const localConversionReview = {
    status: existsSync(pdfPath)
      && readFileSync(pdfPath).subarray(0, 5).toString("ascii") === "%PDF-"
      && reportText.includes("Local Document Conversion Live Breadth")
      && dagNodes.some((node) => node.kind === "crawl_or_observe" && node.status === "skipped")
      ? "accepted"
      : "needs_review",
    sourceBasename: basename(sourcePath),
    sourceSha256: sha256(sourceBytes),
    reportSha256: existsSync(reportPath) ? sha256File(reportPath) : undefined,
    pdfSha256: existsSync(pdfPath) ? sha256File(pdfPath) : undefined,
    skippedWebStages: dagNodes.filter((node) => ["crawl_or_observe", "extract", "verify_sources"].includes(node.kind) && node.status === "skipped").length
  };
  return {
    id: `generated-tool-live-local-document-conversion-${iteration}`,
    capability: "local_document_conversion",
    sourceClass: "approved_local_markdown_file",
    userScenario: "사용자가 승인된 로컬 Markdown 파일을 PDF 문서로 변환해 달라고 요청한다.",
    architectureWorkflow: [
      "permission profile grants only generated-tool execution and the dogfood read/write roots",
      "gap detector classifies local_document_conversion instead of web_research_to_pdf",
      "Toolsmith materializes local_document_conversion in the runtime workspace and runs smoke before execution",
      "execution reads only the approved Markdown source path and skips crawl/extract/source-verify DAG nodes",
      "generated tool creates Markdown/PDF artifacts and records source/content hashes plus rerun fingerprints"
    ],
    success: result.run.status === "completed"
      && result.spec?.status === "active"
      && result.spec?.capability === "local_document_conversion"
      && localConversionReview.status === "accepted"
      && rerun.status === "completed"
      && rerunComparison.matched === true,
    result: {
      runId: result.run.id,
      toolSpecId: result.spec?.id,
      capability: "local_document_conversion",
      sourceClass: "approved_local_markdown_file",
      outputDir,
      elapsedMs,
      executeElapsedMs: result.toolRuns.reduce((sum, toolRun) => sum + Math.max(0, Number(toolRun.elapsedMs ?? 0)), 0),
      rerunElapsedMs: rerun.elapsedMs,
      rerunMatched: rerunComparison.matched === true,
      rerunArtifactMatched: rerunComparison.artifactComparison?.matched === true,
      localConversionReview
    },
    followUp: [
      "Add non-Markdown text and large-document cases before claiming broad local conversion coverage.",
      "Pandoc remains optional and should stay profile-gated for renderer differences."
    ]
  };
}

async function runLiveBrowserDownloadVerify({ storage, runtime, iteration }) {
  const downloadDir = join(assetDir, `download-live-${iteration}`, "downloads");
  mkdirSync(downloadDir, { recursive: true });
  const downloadPath = join(downloadDir, "w3c-public-sample.txt");
  const downloadEvidence = await browserBackedPublicDownload({ url: downloadUrl, outputPath: downloadPath });
  const outputRoot = join(assetDir, `download-live-${iteration}`, "verify");
  const profile = createBroadProfile(storage, {
    name: `live generated download verifier ${iteration}`,
    riskClasses: ["read_only", "reversible"]
  });
  const plan = runtime.plan({
    goal: "다운로드된 파일이 정상 저장됐는지 size와 hash를 확인해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    availableCapabilities: []
  });
  assert.ok(plan.gaps[0]?.id, "browser_download_verify gap should be classified for live breadth dogfood");
  const implementation = await runtime.selfImplementTool({ autonomyRunId: plan.run.id, gapId: plan.gaps[0].id });
  const execution = await runtime.execute({
    autonomyRunId: plan.run.id,
    toolSpecId: implementation.spec.id,
    request: {
      outputDir: outputRoot,
      filePath: downloadPath,
      minBytes: 100
    }
  });
  const rerun = await runtime.rerunToolRun({ toolRunId: execution.id });
  const rerunComparison = rerun.output?.rerunComparison ?? {};
  const verificationPath = join(outputRoot, "download-verification.json");
  const verification = existsSync(verificationPath) ? JSON.parse(readFileSync(verificationPath, "utf8")) : {};
  return {
    id: `generated-tool-live-browser-download-verify-${iteration}`,
    capability: "browser_download_verify",
    sourceClass: "public_browser_backed_download",
    userScenario: "사용자가 공개 웹 리소스로 받은 파일이 실제로 저장됐는지 generated verifier로 확인해 달라고 요청한다.",
    architectureWorkflow: [
      "browser-backed public fetch creates a deterministic local downloaded file under the approved dogfood root",
      "gap detector classifies browser_download_verify",
      "Toolsmith materializes a bounded file verifier in the runtime workspace",
      "execution checks filesystem_read grant for the approved file path and writes size/SHA-256 evidence",
      "rerun compares stable generated-tool output fingerprints without storing raw local paths"
    ],
    success: downloadEvidence.ok === true
      && implementation.spec.status === "active"
      && execution.status === "completed"
      && rerun.status === "completed"
      && rerunComparison.matched === true
      && verification.ok === true
      && Number(verification.size ?? 0) >= 100,
    result: {
      runId: plan.run.id,
      toolSpecId: implementation.spec.id,
      capability: "browser_download_verify",
      sourceClass: "public_browser_backed_download",
      executeElapsedMs: execution.elapsedMs,
      rerunElapsedMs: rerun.elapsedMs,
      rerunMatched: rerunComparison.matched === true,
      rerunArtifactMatched: rerunComparison.artifactComparison?.matched === true,
      publicDownload: downloadEvidence,
      verification: {
        ok: verification.ok === true,
        size: verification.size,
        sha256: verification.sha256
      }
    },
    followUp: [
      "This validates a public browser-backed downloaded file; browser shelf/download transaction correlation remains covered by the Browser Chrome public-extension dogfood.",
      "Keep local file paths basename-only or redacted in debug surfaces."
    ]
  };
}

function createBroadProfile(storage, options) {
  return storage.createAutonomyPermissionProfile({
    name: options.name,
    mode: "scoped_yolo",
    grants: {
      network: Boolean(options.networkDomains?.length),
      networkDomains: options.networkDomains ?? [],
      browserAutomation: Boolean(options.browserDomains?.length),
      browserDomains: options.browserDomains ?? [],
      filesystem: {
        readRoots: [tempRoot, assetDir],
        writeRoots: [tempRoot, assetDir]
      },
      commands: {
        allowPrefixes: options.commandPrefixes ?? ["node"],
        denyPatterns: ["password", "token", "cookie", "secret", "api_key", "rm -rf", "Remove-Item -Recurse", "format"]
      },
      packageInstall: false,
      osMutation: false,
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      credentialAccess: "never",
      riskClasses: options.riskClasses,
      maxRuntimeMs: 60_000,
      maxOutputBytes: 4 * 1024 * 1024,
      maxIterations: 3
    }
  });
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

async function browserBackedPublicDownload(input) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const response = await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const body = response ? Buffer.from(await response.body()) : Buffer.alloc(0);
    writeFileSync(input.outputPath, body);
    return {
      ok: response?.ok() === true && body.length >= 100,
      sourceOrigin: new URL(input.url).origin,
      urlHash: sha256(input.url),
      status: response?.status() ?? 0,
      bytes: body.length,
      sha256: sha256(body),
      basename: basename(input.outputPath)
    };
  } finally {
    await browser.close();
  }
}

function evaluateSourceQuality({ rows, browserFallbackDocuments, reportText }) {
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
  const officialSourceCount = Math.max(
    rows.filter((row) =>
      typeof row.url === "string" &&
      /(^|\/\/)?(help\.openai\.com|platform\.openai\.com|openai\.com)\b/.test(row.url) &&
      (Number(row.chars ?? 0) > 300 || row.browserFallback === true || String(row.status) === "browser_fallback")
    ).length,
    browserFallbackDocuments.filter((doc) =>
      typeof doc.url === "string" &&
      /(^|\/\/)?(help\.openai\.com|platform\.openai\.com|openai\.com)\b/.test(doc.url) &&
      doc.text.length > 300
    ).length
  );
  const totalChars = Math.max(
    rows.reduce((sum, row) => sum + Number(row.chars ?? 0), 0),
    browserFallbackDocuments.reduce((sum, doc) => sum + doc.text.length, 0)
  );
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
      "requires Codex to appear in generated report or source metadata",
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
      "stores text hashes and lengths only"
    ]
  };
}

function buildLiveSampleLedgerEntries(input) {
  return input.scenarios.flatMap((scenario) => {
    const rows = [];
    const executeElapsedMs = readFiniteNumber(scenario.result?.executeElapsedMs, scenario.result?.elapsedMs);
    const rerunElapsedMs = readFiniteNumber(scenario.result?.rerunElapsedMs);
    if (Number.isFinite(executeElapsedMs)) {
      rows.push(buildLiveSample({
        generatedAt: input.generatedAt,
        evidencePath: input.evidencePath,
        scenario,
        mode: "execute",
        elapsedMs: executeElapsedMs,
        matched: scenario.success === true,
        artifactMatched: scenario.success === true
      }));
    }
    if (Number.isFinite(rerunElapsedMs)) {
      rows.push(buildLiveSample({
        generatedAt: input.generatedAt,
        evidencePath: input.evidencePath,
        scenario,
        mode: "rerun",
        elapsedMs: rerunElapsedMs,
        matched: scenario.result?.rerunMatched === true,
        artifactMatched: scenario.result?.rerunArtifactMatched === true
      }));
    }
    return rows.map((row) => {
      const redacted = redactPaths(row);
      return {
        ...redacted,
        redaction: {
          rawPathsRedacted: true,
          repoPathsRelative: true,
          absolutePathLeakCount: countAbsolutePathLeaks(JSON.stringify(redacted))
        }
      };
    });
  });
}

function buildLiveSample(input) {
  return {
    schemaVersion: "scoped-autonomy-generated-tool-live-breadth-sample.v1",
    generatedAt: input.generatedAt,
    evidenceClass: "live_generated_tool_breadth",
    evidencePath: input.evidencePath,
    scenario: {
      id: input.scenario.id,
      success: input.scenario.success === true,
      result: {
        capability: input.scenario.capability,
        sourceClass: input.scenario.sourceClass,
        elapsedMs: input.elapsedMs,
        rerunMatched: input.scenario.result?.rerunMatched === true,
        rerunArtifactMatched: input.scenario.result?.rerunArtifactMatched === true,
        sourceQualityReview: input.scenario.result?.sourceQualityReview,
        validLiveSourceCount: input.scenario.result?.validLiveSourceCount,
        publicDownloadOk: input.scenario.result?.publicDownload?.ok,
        stdoutStartsWithVersion: input.scenario.result?.stdoutStartsWithVersion,
        localConversionReview: input.scenario.result?.localConversionReview?.status
      }
    },
    sample: {
      capability: input.scenario.capability,
      sourceClass: input.scenario.sourceClass,
      mode: input.mode,
      status: input.matched ? "completed" : "failed",
      elapsedMs: input.elapsedMs,
      matched: input.matched,
      artifactMatched: input.artifactMatched,
      liveBacked: true
    }
  };
}

function summarizeScenarios(scenarios, samples) {
  const requiredGeneratedClasses = ["browser_download_verify", "local_document_conversion", "terminal_generated_tool", "web_research_to_pdf"];
  const generatedCapabilityClasses = [...new Set(scenarios.map((scenario) => scenario.capability).filter(Boolean))].sort();
  const executeSamples = samples.filter((sample) => sample.sample?.mode === "execute");
  const sampleCountByClass = Object.fromEntries(requiredGeneratedClasses.map((capability) => [
    capability,
    executeSamples.filter((sample) => sample.sample?.capability === capability).length
  ]));
  const p95LatencySamples = samples
    .map((sample) => Number(sample.sample?.elapsedMs))
    .filter(Number.isFinite);
  return {
    totalScenarios: scenarios.length,
    successfulScenarios: scenarios.filter((scenario) => scenario.success === true).length,
    generatedCapabilityClasses,
    requiredGeneratedClasses,
    requiredGeneratedClassesPresent: requiredGeneratedClasses.every((capability) => generatedCapabilityClasses.includes(capability)),
    sampleCount: samples.length,
    executeSampleCount: executeSamples.length,
    sampleCountByClass,
    repeatedLiveRunsPresent: requiredGeneratedClasses.every((capability) => Number(sampleCountByClass[capability] ?? 0) >= 2),
    p95LatencySampleCount: p95LatencySamples.length,
    p95LatencyMs: p95LatencySamples.length ? percentile(p95LatencySamples, 0.95) : undefined,
    rerunMatchedCount: samples.filter((sample) => sample.sample?.mode === "rerun" && sample.sample?.matched === true).length,
    rerunArtifactMatchedCount: samples.filter((sample) => sample.sample?.mode === "rerun" && sample.sample?.artifactMatched === true).length,
    webSourceQualityAccepted: scenarios.filter((scenario) => scenario.capability === "web_research_to_pdf").every((scenario) => scenario.result?.sourceQualityReview === "accepted"),
    localDocumentConversionVerified: scenarios.filter((scenario) => scenario.capability === "local_document_conversion").every((scenario) => scenario.result?.localConversionReview?.status === "accepted"),
    terminalCommandVerified: scenarios.filter((scenario) => scenario.capability === "terminal_generated_tool").every((scenario) => scenario.result?.stdoutStartsWithVersion === true),
    publicDownloadVerified: scenarios.filter((scenario) => scenario.capability === "browser_download_verify").every((scenario) => scenario.result?.publicDownload?.ok === true && scenario.result?.verification?.ok === true),
    pathRedactionPresent: samples.length > 0 && samples.every((sample) => Number(sample.redaction?.absolutePathLeakCount ?? 1) === 0)
  };
}

function appendLiveSampleLedger(path, samples) {
  if (!samples.length) {
    return;
  }
  mkdirSync(join(repoRoot, "docs", "reports", "assets"), { recursive: true });
  appendFileSync(path, `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`, "utf8");
}

function renderReport(evidence) {
  const lines = [
    "# Scoped Autonomy Generated-Tool Live Breadth Dogfood",
    "",
    `Generated: ${evidence.generatedAt}`,
    `Storage schema version: ${evidence.storageSchemaVersion}`,
    `Successful scenarios: ${evidence.metrics.successfulScenarios}/${evidence.metrics.totalScenarios}`,
    `Generated capability classes: ${evidence.metrics.generatedCapabilityClasses.join(", ")}`,
    `Repeated execute samples: ${evidence.metrics.executeSampleCount}`,
    `p95 latency: ${evidence.metrics.p95LatencyMs}ms`,
    `Path redaction: ${evidence.redaction.absolutePathLeakCount === 0 ? "passed" : "failed"}`,
    "",
    "## Scenario Results",
    ""
  ];
  for (const scenario of evidence.scenarios) {
    lines.push(`### ${scenario.id}`, "");
    lines.push(`User scenario: ${scenario.userScenario}`, "");
    lines.push(`Capability: ${scenario.capability}`, "");
    lines.push(`Source class: ${scenario.sourceClass}`, "");
    lines.push(`Success: ${scenario.success ? "passed" : "failed"}`, "");
    lines.push("Architecture workflow:");
    for (const step of scenario.architectureWorkflow) {
      lines.push(`- ${step}`);
    }
    lines.push("", "Follow-up:");
    for (const item of scenario.followUp) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  lines.push("## Improvement Items", "");
  for (const item of evidence.improvementItems) {
    lines.push(`- ${item}`);
  }
  lines.push("", `Raw evidence: docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-${DATE}/evidence.json`, "");
  return lines.join("\n");
}

function relativeRepoPath(path) {
  const normalizedRoot = repoRoot.toLowerCase();
  const normalizedPath = String(path).toLowerCase();
  if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`) || normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return relative(repoRoot, path).replace(/\\/g, "/");
  }
  return path;
}

function redactPaths(value) {
  if (Array.isArray(value)) {
    return value.map(redactPaths);
  }
  if (typeof value === "string") {
    return redactPathString(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactPaths(nested)]));
}

function redactPathString(value) {
  const relativePath = relativeRepoPath(value);
  if (relativePath !== value) {
    return relativePath;
  }
  if (/^[a-z]:[\\/]/i.test(value)) {
    return `<redacted>/${basename(value)}`;
  }
  return value;
}

function countAbsolutePathLeaks(text) {
  return (text.match(/(^|[^A-Za-z])[A-Z]:[\\/]/g) ?? []).length;
}

function readFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) {
    return undefined;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function redactUrlToOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return String(value ?? "").split("/")[0];
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function formatSeoulDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}
