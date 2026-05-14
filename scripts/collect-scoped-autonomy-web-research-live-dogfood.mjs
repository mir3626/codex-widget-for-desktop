#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { ScopedAutonomyRuntime } from "../dist/daemon/scoped-autonomy/index.js";

const DATE = "2026-05-14";
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `scoped-autonomy-web-research-live-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `scoped-autonomy-web-research-live-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `scoped-autonomy-web-research-live-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-web-research-live-"));
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
  const result = await runtime.runGoalDag({
    goal: "OpenAI 홈페이지에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    title: "OpenAI Codex live source report",
    urls: [
      "https://openai.com/codex/",
      "https://platform.openai.com/docs/codex"
    ]
  });
  const run = storage.readAutonomyRun(result.run.id);
  const outputDir = run.output.outputDir;
  const citationsPath = join(outputDir, "citations.json");
  const pdfPath = join(outputDir, "report.pdf");
  const crawlRun = result.toolRuns.find((toolRun) => {
    const input = toolRun.input && typeof toolRun.input === "object" ? toolRun.input : {};
    return input.command === "crawl_or_observe";
  });
  const citations = existsSync(citationsPath) ? JSON.parse(readFileSync(citationsPath, "utf8")) : [];
  const liveUrlsObserved = Array.isArray(crawlRun?.output?.urlsFetched)
    ? crawlRun.output.urlsFetched
    : citations.filter((citation) => citation.url).map((citation) => citation.url);
  const scenario = {
    id: "scoped-autonomy-live-openai-web-research-to-pdf",
    userScenario: "사용자가 OpenAI 웹사이트에서 Codex 관련 내용을 실제로 읽어 PDF 파일로 달라고 요청한다.",
    architectureWorkflow: [
      "permission_check grants only openai.com and platform.openai.com live fetches",
      "Toolsmith materializes web_research_to_pdf.v2 in runtime workspace and passes smoke before live execution",
      "crawl_or_observe performs live allowed-domain fetches and records HTTP status per source",
      "extract and verify_sources build a citation table from live response text",
      "draft_markdown and render_pdf produce persistent artifacts",
      "store_artifact writes blob-backed eval resources and verify_artifact checks the PDF header"
    ],
    success: result.run.status === "completed"
      && existsSync(pdfPath)
      && readFileSync(pdfPath).subarray(0, 5).toString("ascii") === "%PDF-"
      && liveUrlsObserved.length > 0
      && citations.some((citation) => String(citation.url).includes("openai.com")),
    result: {
      runId: result.run.id,
      toolSpecId: result.spec?.id,
      outputDir,
      liveUrlsObserved,
      statuses: citations.map((citation) => ({ url: citation.url, status: citation.status, chars: citation.chars }))
    },
    followUp: [
      "OpenAI pages currently return HTTP status evidence to Node fetch in this environment; the run still records live response text and status.",
      "Browser-backed fetch may be needed when upstream blocks daemon-side HTTP clients.",
      "Promotion should require repeated live runs and p95 latency comparison, not this single dogfood result."
    ]
  };

  const evidence = {
    generatedAt: new Date().toISOString(),
    storageSchemaVersion: storage.health().schemaVersion,
    scenarios: [scenario],
    debugBundle: runtime.createDebugBundle(result.run.id),
    citations
  };
  mkdirSync(join(repoRoot, "docs", "dogfood"), { recursive: true });
  mkdirSync(join(repoRoot, "docs", "reports"), { recursive: true });
  writeFileSync(dogfoodPath, `${JSON.stringify({ generatedAt: evidence.generatedAt, scenarios: [scenario] }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");

  assert.equal(scenario.success, true);
  console.log(`scoped autonomy live web research dogfood evidence written: ${reportPath}`);
} finally {
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
    lines.push(`- ${status.url}: ${status.status}, ${status.chars} chars`);
  }
  lines.push("", "Follow-up:");
  for (const item of scenario.followUp) {
    lines.push(`- ${item}`);
  }
  lines.push("", `Raw evidence: docs/reports/assets/scoped-autonomy-web-research-live-${DATE}/evidence.json`, "");
  return lines.join("\n");
}
