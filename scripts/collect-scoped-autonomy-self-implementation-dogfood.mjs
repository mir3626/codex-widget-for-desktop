#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { ScopedAutonomyRuntime } from "../dist/daemon/scoped-autonomy/index.js";

const DATE = "2026-05-14";
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `scoped-autonomy-self-implementation-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `scoped-autonomy-self-implementation-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `scoped-autonomy-self-implementation-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-self-implementation-dogfood-"));
let storage;

try {
  rmSync(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(assetDir, { recursive: true });
  storage = createStorageService({ appDataDir: tempRoot });
  const runtime = new ScopedAutonomyRuntime(storage, { runtimeRoot: join(tempRoot, ".runtime", "autonomy") });
  const scenarios = [];

  scenarios.push(await runFullDagWebPdf({ storage, runtime, tempRoot, assetDir }));
  scenarios.push(await runTerminalGeneratedTool({ storage, runtime, tempRoot, assetDir }));
  scenarios.push(await runBrowserDownloadVerify({ storage, runtime, tempRoot, assetDir }));
  scenarios.push(runNativeHighRiskBlocked({ storage, runtime, tempRoot }));

  const evidence = {
    generatedAt: new Date().toISOString(),
    storageSchemaVersion: storage.health().schemaVersion,
    scenarios,
    autonomyRuns: storage.listAutonomyRuns({ limit: 100 }),
    tools: storage.listAutonomyToolSpecs({ limit: 100 }),
    inventory: storage.listAutonomyCapabilityInventory({ limit: 100 }),
    evalRuns: storage.listComputerUseEvalRuns({ limit: 100 }).map((run) => ({
      id: run.id,
      status: run.status,
      taskSuccess: run.taskSuccess,
      failureClass: run.failureClass,
      elapsedMs: run.elapsedMs
    })),
    improvementItems: [
      "Run-to-run stability is now measurable through rerun manifests, but promotion still needs repeated p95 latency samples.",
      "Terminal generated tools are intentionally command-prefix bounded; richer scripts should stay in runtime workspace until promoted by explicit user request.",
      "Download verification works on a supplied path; browser downloads surface integration remains a separate bridge/native-helper concern.",
      "Native Windows mutation stays blocked until signed helper scope, release signing, and high-risk dogfood gates are complete."
    ]
  };

  mkdirSync(join(repoRoot, "docs", "dogfood"), { recursive: true });
  mkdirSync(join(repoRoot, "docs", "reports"), { recursive: true });
  writeFileSync(dogfoodPath, `${JSON.stringify({ generatedAt: evidence.generatedAt, scenarios }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");

  assert.equal(scenarios.every((scenario) => scenario.success), true);
  console.log(`scoped autonomy self-implementation dogfood evidence written: ${reportPath}`);
} finally {
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function runFullDagWebPdf({ storage, runtime, tempRoot, assetDir }) {
  const outputRoot = join(assetDir, "full-dag-web-pdf");
  const profile = createBroadProfile(storage, tempRoot, assetDir, {
    name: "dogfood full DAG web pdf",
    riskClasses: ["read_only", "reversible"]
  });
  const result = await runtime.runGoalDag({
    goal: "OpenAI 홈페이지에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    title: "OpenAI Codex command support report",
    forceFirstSmokeFailure: true,
    sourceDocuments: [
      {
        title: "OpenAI Codex fixture",
        url: "https://openai.com/codex/",
        text: "Codex supports repository-aware command execution, code edits, tests, summaries, and handoff reporting."
      }
    ]
  });
  const run = storage.readAutonomyRun(result.run.id);
  const outputDir = run.output.outputDir;
  const dagNodes = storage.listCapabilityDagNodes(run.dagRunId);
  const evalSteps = storage.listComputerUseEvalSteps(run.evalRunId);
  return {
    id: "self-implementation-full-dag-web-pdf",
    userScenario: "사용자가 OpenAI/Codex 관련 내용을 조사해 PDF 파일로 달라고 요청한다.",
    architectureWorkflow: [
      "permission_check validates scoped_yolo grants before implementation",
      "capability_gap decomposes the request into crawl/extract/verify/draft/render/store/verify operations",
      "implement_capability materializes web_research_to_pdf.v2 under daemon runtime workspace",
      "first smoke is intentionally failed, then Toolsmith revises generated source and retries",
      "smoke_test activates the generated tool only after deterministic artifact checks pass",
      "DAG executes each web/PDF stage as a separate generated-tool command",
      "eval ledger and debug bundle record source hashes, commands, artifacts, timings, and resources"
    ],
    success: result.run.status === "completed"
      && result.spec.status === "active"
      && existsSync(join(outputDir, "report.md"))
      && existsSync(join(outputDir, "report.pdf"))
      && dagNodes.filter((node) => node.status === "completed").length >= 10
      && evalSteps.some((step) => step.kind === "toolsmith_smoke" && step.status === "failed")
      && evalSteps.some((step) => step.kind === "toolsmith_smoke" && step.status === "completed"),
    result: {
      runId: result.run.id,
      toolSpecId: result.spec.id,
      outputDir,
      dagCompleted: dagNodes.filter((node) => node.status === "completed").length,
      evalStepCount: evalSteps.length
    },
    followUp: [
      "Repeat live runs before promoting any latency or stability claim.",
      "Renderer can now display profile/gaps/DAG/tools but still needs visual polish during real user trials."
    ]
  };
}

async function runTerminalGeneratedTool({ storage, runtime, tempRoot, assetDir }) {
  const outputRoot = join(assetDir, "terminal-tool");
  const profile = createBroadProfile(storage, tempRoot, assetDir, {
    name: "dogfood terminal generated tool",
    riskClasses: ["read_only", "reversible", "side_effect"],
    commandPrefixes: ["node"]
  });
  const plan = runtime.plan({
    goal: "node --version을 실행하는 안전한 local script 도구 생성해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    availableCapabilities: []
  });
  const result = await runtime.selfImplementTool({ autonomyRunId: plan.run.id, gapId: plan.gaps[0].id });
  const execution = await runtime.execute({
    autonomyRunId: plan.run.id,
    toolSpecId: result.spec.id,
    request: {
      outputDir: outputRoot,
      command: "node --version"
    }
  });
  const stdoutPath = join(outputRoot, "stdout.txt");
  return {
    id: "self-implementation-terminal-generated-tool",
    userScenario: "사용자가 안전한 로컬 스크립트 도구를 만들어 node 버전을 확인해 달라고 요청한다.",
    architectureWorkflow: [
      "gap detector classifies terminal_generated_tool",
      "Toolsmith writes a no-shell Node wrapper in runtime workspace",
      "smoke test writes deterministic stdout artifacts",
      "execution evaluates command prefix grants before spawning node without shell expansion",
      "stdout/stderr artifacts and command provenance are recorded"
    ],
    success: result.spec.status === "active"
      && execution.status === "completed"
      && existsSync(stdoutPath)
      && readFileSync(stdoutPath, "utf8").trim().startsWith("v"),
    result: {
      runId: plan.run.id,
      toolSpecId: result.spec.id,
      executionRunId: execution.id,
      stdout: existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf8").trim() : ""
    },
    followUp: [
      "Complex generated scripts should require promotion review before becoming repo source.",
      "Command splitting intentionally avoids shell features; richer command models need explicit parser tests."
    ]
  };
}

async function runBrowserDownloadVerify({ storage, runtime, tempRoot, assetDir }) {
  const downloadDir = join(assetDir, "downloads");
  mkdirSync(downloadDir, { recursive: true });
  const fixturePath = join(downloadDir, "fixture-download.txt");
  writeFileSync(fixturePath, "download verifier fixture\n", "utf8");
  const outputRoot = join(assetDir, "download-verify");
  const profile = createBroadProfile(storage, tempRoot, assetDir, {
    name: "dogfood browser download verify",
    riskClasses: ["read_only", "reversible"]
  });
  const plan = runtime.plan({
    goal: "다운로드된 파일이 정상 저장됐는지 size와 hash를 확인해줘.",
    permissionProfileId: profile.id,
    outputRoot: assetDir,
    availableCapabilities: []
  });
  const result = await runtime.selfImplementTool({ autonomyRunId: plan.run.id, gapId: plan.gaps[0].id });
  const execution = await runtime.execute({
    autonomyRunId: plan.run.id,
    toolSpecId: result.spec.id,
    request: {
      outputDir: outputRoot,
      filePath: fixturePath,
      minBytes: 8
    }
  });
  const verificationPath = join(outputRoot, "download-verification.json");
  return {
    id: "self-implementation-browser-download-verify",
    userScenario: "사용자가 브라우저에서 받은 파일이 실제로 저장됐는지 검증해 달라고 요청한다.",
    architectureWorkflow: [
      "gap detector classifies browser_download_verify",
      "Toolsmith materializes a bounded local file verifier",
      "smoke test verifies a deterministic fixture file",
      "execution checks filesystem_read grant for the supplied path",
      "file size and SHA-256 evidence are stored as artifact JSON"
    ],
    success: result.spec.status === "active"
      && execution.status === "completed"
      && existsSync(verificationPath)
      && JSON.parse(readFileSync(verificationPath, "utf8")).ok === true,
    result: {
      runId: plan.run.id,
      toolSpecId: result.spec.id,
      executionRunId: execution.id,
      verificationPath
    },
    followUp: [
      "Actual browser download shelf observation still requires browser bridge or native helper integration.",
      "Verifier should later correlate browser download transaction IDs with local files."
    ]
  };
}

function runNativeHighRiskBlocked({ storage, runtime, tempRoot }) {
  const profile = storage.createAutonomyPermissionProfile({
    name: "dogfood native high risk blocked",
    mode: "scoped_yolo",
    grants: {
      network: false,
      networkDomains: [],
      filesystem: { readRoots: [tempRoot], writeRoots: [tempRoot] },
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      osMutation: false,
      riskClasses: ["read_only", "reversible"]
    }
  });
  const plan = runtime.plan({
    goal: "Windows 설정에서 앱별 권한을 열고 설정을 변경해줘.",
    permissionProfileId: profile.id,
    outputRoot: join(tempRoot, "native-blocked"),
    availableCapabilities: []
  });
  return {
    id: "self-implementation-native-windows-blocked",
    userScenario: "사용자가 Windows 설정 변경처럼 고위험 native workflow를 요청한다.",
    architectureWorkflow: [
      "gap detector classifies native_windows_workflow",
      "permission evaluator requires high_risk and os_mutation grants",
      "run is blocked before materialization or execution",
      "blocker stays explicit rather than bypassing through OCR or generated code"
    ],
    success: plan.run.status === "blocked" && plan.permission.missingRequirements.some((requirement) => requirement.type === "os_mutation"),
    result: {
      runId: plan.run.id,
      missingRequirements: plan.permission.missingRequirements,
      blockers: plan.gaps.flatMap((gap) => gap.blockers)
    },
    followUp: [
      "Unattended high-risk Windows mutation remains blocked by policy.",
      "Signed bounded helper and release signing hardening are required before resuming this slice."
    ]
  };
}

function createBroadProfile(storage, tempRoot, assetDir, options) {
  return storage.createAutonomyPermissionProfile({
    name: options.name,
    mode: "scoped_yolo",
    grants: {
      network: true,
      networkDomains: ["openai.com", "platform.openai.com", "help.openai.com", "example.com"],
      browserAutomation: false,
      browserDomains: [],
      filesystem: {
        readRoots: [tempRoot, assetDir],
        writeRoots: [tempRoot, assetDir]
      },
      commands: {
        allowPrefixes: options.commandPrefixes ?? ["node"],
        denyPatterns: ["password", "token", "cookie", "secret", "api_key", "rm -rf", "Remove-Item -Recurse"]
      },
      packageInstall: false,
      osMutation: false,
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      credentialAccess: "never",
      riskClasses: options.riskClasses,
      maxRuntimeMs: 30_000,
      maxOutputBytes: 2 * 1024 * 1024,
      maxIterations: 3
    }
  });
}

function renderReport(evidence) {
  const lines = [
    "# Scoped Autonomy Self-Implementation Dogfood",
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
  lines.push("", `Raw evidence: docs/reports/assets/scoped-autonomy-self-implementation-${DATE}/evidence.json`, "");
  return lines.join("\n");
}
