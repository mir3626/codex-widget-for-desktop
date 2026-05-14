#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { ScopedAutonomyRuntime } from "../dist/daemon/scoped-autonomy/index.js";

const DATE = "2026-05-14";
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `scoped-autonomy-toolsmith-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `scoped-autonomy-toolsmith-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `scoped-autonomy-toolsmith-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-scoped-autonomy-dogfood-"));
let storage;

try {
  rmSync(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(assetDir, { recursive: true });
  storage = createStorageService({ appDataDir: tempRoot });
  const runtime = new ScopedAutonomyRuntime(storage, { runtimeRoot: join(tempRoot, ".runtime", "autonomy") });
  const scenarios = [];

  scenarios.push(await runWebResearchToPdfSuccess({ storage, runtime, tempRoot, assetDir }));
  scenarios.push(runMissingExecutionGrantBlocked({ storage, runtime, tempRoot }));
  scenarios.push(runNativeWorkflowBlocked({ storage, runtime, tempRoot }));

  const evalRuns = storage.listComputerUseEvalRuns({ limit: 50 });
  const evidence = {
    generatedAt: new Date().toISOString(),
    storageSchemaVersion: storage.health().schemaVersion,
    scenarios,
    evalRuns: evalRuns.map((run) => ({
      id: run.id,
      scenarioId: run.scenarioId,
      taskSuccess: run.taskSuccess,
      failureClass: run.failureClass,
      status: run.status
    })),
    autonomyRuns: storage.listAutonomyRuns({ limit: 50 }),
    toolSpecs: storage.listAutonomyToolSpecs({ limit: 50 }),
    improvementItems: [
      "Live URL fetch needs source-specific extraction and citation verification before promotion beyond fixture-backed dogfood.",
      "Renderer needs a permission profile editor and run inspector before non-developer users can safely operate scoped_yolo mode.",
      "Ad hoc generated code now stays in daemon runtime workspace and still requires smoke-pass activation before use.",
      "Native Windows workflow Toolsmith templates remain blocked on signed helper scope and dogfood matrix."
    ]
  };

  mkdirSync(join(repoRoot, "docs", "dogfood"), { recursive: true });
  mkdirSync(join(repoRoot, "docs", "reports"), { recursive: true });
  writeFileSync(dogfoodPath, `${JSON.stringify({ generatedAt: evidence.generatedAt, scenarios }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");

  assert.equal(scenarios[0].success, true);
  assert.equal(scenarios[1].success, true);
  assert.equal(scenarios[2].success, true);
  console.log(`scoped autonomy toolsmith dogfood evidence written: ${reportPath}`);
} finally {
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function runWebResearchToPdfSuccess({ storage, runtime, tempRoot, assetDir }) {
  const outputRoot = join(assetDir, "generated-report");
  const profile = storage.createAutonomyPermissionProfile({
    name: "dogfood web research to pdf",
    mode: "scoped_yolo",
    grants: {
      networkDomains: ["openai.com", "help.openai.com", "platform.openai.com"],
      browserDomains: ["openai.com"],
      filesystem: { readRoots: [tempRoot, assetDir], writeRoots: [tempRoot, assetDir] },
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      maxRuntimeMs: 10_000,
      maxOutputBytes: 1024 * 1024
    }
  });
  const plan = runtime.plan({
    goal: "OpenAI 홈페이지에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    availableCapabilities: []
  });
  const spec = runtime.materializeTool({ autonomyRunId: plan.run.id, gapId: plan.gaps[0].id });
  const smoke = await runtime.runSmoke({ autonomyRunId: plan.run.id, toolSpecId: spec.id });
  const execution = await runtime.execute({
    autonomyRunId: plan.run.id,
    toolSpecId: spec.id,
    request: {
      title: "OpenAI Codex command support report",
      outputDir: outputRoot,
      sourceDocuments: [
        {
          title: "OpenAI Codex fixture",
          url: "https://openai.com/codex",
          text: "Codex supports repository-aware command execution, code edits, tests, summaries, and handoff reporting."
        }
      ]
    }
  });
  const pdfPath = join(outputRoot, "report.pdf");
  return {
    id: "scoped-autonomy-web-research-to-pdf",
    userScenario: "사용자가 OpenAI/Codex 관련 내용을 조사해 PDF 파일로 달라고 요청한다.",
    architectureWorkflow: [
      "daemon creates a computer-use eval run and scoped-autonomy run",
      "gap detector classifies the missing workflow as web_research_to_pdf",
      "permission evaluator checks generated tool, network domain, and filesystem write grants",
      "Toolsmith materializes the reviewed web_research_to_pdf Node template in runtime workspace",
      "smoke test creates fixture markdown/PDF artifacts before real execution",
      "execution produces report.md/report.pdf and stores artifacts as eval resources",
      "eval ledger records plan, materialize, smoke, execute, and verification steps"
    ],
    success: execution.status === "completed" && smoke.status === "completed" && existsSync(pdfPath) && readFileSync(pdfPath).subarray(0, 5).toString("ascii") === "%PDF-",
    result: {
      runId: plan.run.id,
      toolSpecId: spec.id,
      smokeRunId: smoke.id,
      executionRunId: execution.id,
      pdfPath
    },
    followUp: [
      "Current dogfood uses fixture source text for deterministic validation.",
      "Live crawl promotion needs source extraction, citation verification, and p95 latency measurement."
    ]
  };
}

function runMissingExecutionGrantBlocked({ storage, runtime, tempRoot }) {
  const profile = storage.createAutonomyPermissionProfile({
    name: "dogfood missing execution grant",
    mode: "scoped_yolo",
    grants: {
      networkDomains: ["openai.com"],
      filesystem: { readRoots: [tempRoot], writeRoots: [tempRoot] },
      generatedToolMaterialization: true,
      generatedToolExecution: false
    }
  });
  const plan = runtime.plan({
    goal: "OpenAI 홈페이지에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.",
    permissionProfileId: profile.id,
    outputRoot: join(tempRoot, "exports", "blocked"),
    availableCapabilities: []
  });
  return {
    id: "scoped-autonomy-missing-execution-grant",
    userScenario: "사용자가 사전 권한을 일부만 주고 PDF 조사 작업을 요청한다.",
    architectureWorkflow: [
      "gap detector identifies web_research_to_pdf",
      "permission evaluator detects missing generated_tool_execution grant",
      "autonomy run is marked blocked",
      "no generated tool execution is attempted",
      "eval ledger records blocked permission evidence"
    ],
    success: plan.run.status === "blocked" && plan.permission.allowed === false,
    result: {
      runId: plan.run.id,
      missingRequirements: plan.permission.missingRequirements
    },
    followUp: [
      "Renderer should show the exact missing grant and allow the user to grant a narrower one-time profile."
    ]
  };
}

function runNativeWorkflowBlocked({ storage, runtime, tempRoot }) {
  const profile = storage.createAutonomyPermissionProfile({
    name: "dogfood native workflow blocked",
    mode: "scoped_yolo",
    grants: {
      filesystem: { readRoots: [tempRoot], writeRoots: [tempRoot] },
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      osMutation: false
    }
  });
  const plan = runtime.plan({
    goal: "윈도우 설정에서 앱별 권한을 열고 설정을 변경해줘.",
    permissionProfileId: profile.id,
    outputRoot: join(tempRoot, "exports", "native"),
    availableCapabilities: []
  });
  return {
    id: "scoped-autonomy-native-workflow-blocked",
    userScenario: "사용자가 Windows 설정 변경처럼 고위험 native workflow를 요청한다.",
    architectureWorkflow: [
      "gap detector identifies native_windows_workflow",
      "permission evaluator checks os_mutation and generated helper execution grants",
      "missing OS mutation permission blocks the run",
      "blocker is recorded instead of attempting screenshot/OCR workaround"
    ],
    success: plan.run.status === "blocked" && plan.permission.missingRequirements.some((requirement) => requirement.type === "os_mutation"),
    result: {
      runId: plan.run.id,
      missingRequirements: plan.permission.missingRequirements
    },
    followUp: [
      "Native Windows workflow remains blocked on signed bounded helper implementation and high-risk dogfood matrix."
    ]
  };
}

function renderReport(evidence) {
  const lines = [
    "# Scoped Autonomy Toolsmith Dogfood",
    "",
    `Generated: ${evidence.generatedAt}`,
    `Storage schema version: ${evidence.storageSchemaVersion}`,
    "",
    "## Scenario Results",
    ""
  ];
  for (const scenario of evidence.scenarios) {
    lines.push(`### ${scenario.id}`, "");
    lines.push(`User scenario: ${scenario.userScenario}`, "");
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
  lines.push("", `Raw evidence: docs/reports/assets/scoped-autonomy-toolsmith-${DATE}/evidence.json`, "");
  return lines.join("\n");
}
