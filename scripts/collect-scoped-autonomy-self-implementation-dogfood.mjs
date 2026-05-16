#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { ScopedAutonomyRuntime } from "../dist/daemon/scoped-autonomy/index.js";

const DATE = "2026-05-16";
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `scoped-autonomy-self-implementation-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `scoped-autonomy-self-implementation-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `scoped-autonomy-self-implementation-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const sampleLedgerPath = join(repoRoot, "docs", "reports", "assets", "scoped-autonomy-self-implementation-runs.jsonl");
const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-self-implementation-dogfood-"));
let storage;

try {
  rmSync(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(assetDir, { recursive: true });
  storage = createStorageService({ appDataDir: tempRoot });
  const runtime = new ScopedAutonomyRuntime(storage, { runtimeRoot: join(tempRoot, ".runtime", "autonomy") });
  const scenarios = [];

  scenarios.push(await runFullDagWebPdf({ storage, runtime, tempRoot, assetDir }));
  scenarios.push(await runLocalDocumentConversion({ storage, runtime, tempRoot, assetDir }));
  scenarios.push(await runTerminalGeneratedTool({ storage, runtime, tempRoot, assetDir }));
  scenarios.push(await runBrowserDownloadVerify({ storage, runtime, tempRoot, assetDir }));
  scenarios.push(runNativeHighRiskBlocked({ storage, runtime, tempRoot }));
  const generatedAt = new Date().toISOString();
  const repeatedSamples = buildRepeatedSampleLedgerEntries({
    generatedAt,
    evidencePath: relativeRepoPath(evidencePath),
    scenarios
  });

  const rawEvidence = {
    schemaVersion: "scoped-autonomy-self-implementation-dogfood.v1",
    generatedAt,
    storageSchemaVersion: storage.health().schemaVersion,
    scenarios,
    metrics: {
      ...summarizeScenarios(scenarios),
      repeatedGeneratedToolSamples: summarizeRepeatedSamples(repeatedSamples)
    },
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
  const evidenceWithoutRedaction = redactPaths(rawEvidence);
  const evidence = {
    ...evidenceWithoutRedaction,
    redaction: {
      rawPathsRedacted: true,
      repoPathsRelative: true,
      absolutePathLeakCount: countAbsolutePathLeaks(JSON.stringify(evidenceWithoutRedaction))
    }
  };

  mkdirSync(join(repoRoot, "docs", "dogfood"), { recursive: true });
  mkdirSync(join(repoRoot, "docs", "reports"), { recursive: true });
  writeFileSync(dogfoodPath, `${JSON.stringify({ generatedAt: evidence.generatedAt, scenarios: evidence.scenarios }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");
  appendRepeatedSampleLedger(sampleLedgerPath, repeatedSamples);

  assert.equal(scenarios.every((scenario) => scenario.success), true);
  assert.equal(evidence.redaction.absolutePathLeakCount, 0, "dogfood evidence must not leak absolute local paths");
  assert.equal(repeatedSamples.length >= 6, true, "dogfood must record execute/rerun samples for all generated tool classes");
  assert.equal(countAbsolutePathLeaks(repeatedSamples.map((sample) => JSON.stringify(sample)).join("\n")), 0, "sample ledger entries must not leak absolute local paths");
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
  const executionRun = result.toolRuns.findLast((toolRun) => toolRun.status === "completed" && toolRun.mode === "execute");
  assert.ok(executionRun, "full DAG should have a completed execute tool run");
  const rerun = await runtime.rerunToolRun({ toolRunId: executionRun.id });
  const rerunComparison = rerun.output?.rerunComparison ?? {};
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
      && evalSteps.some((step) => step.kind === "toolsmith_smoke" && step.status === "completed")
      && rerun.status === "completed"
      && rerunComparison.schemaVersion === "toolsmith-rerun-comparison.v1"
      && rerunComparison.matched === true,
    result: {
      runId: result.run.id,
      toolSpecId: result.spec.id,
      capability: result.spec.capability,
      outputDir: relativeRepoPath(outputDir),
      dagCompleted: dagNodes.filter((node) => node.status === "completed").length,
      evalStepCount: evalSteps.length,
      rerunRunId: rerun.id,
      rerunMatched: rerunComparison.matched === true,
      rerunArtifactMatched: rerunComparison.artifactComparison?.matched === true,
      dagElapsedMs: elapsedBetweenMs(run.createdAt, run.completedAt ?? run.updatedAt),
      executeElapsedMs: result.toolRuns.reduce((sum, toolRun) => sum + Math.max(0, Number(toolRun.elapsedMs ?? 0)), 0),
      executeStageP95LatencyMs: percentile(result.toolRuns.map((toolRun) => Number(toolRun.elapsedMs)).filter(Number.isFinite), 0.95),
      rerunElapsedMs: rerun.elapsedMs
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
  const rerun = await runtime.rerunToolRun({ toolRunId: execution.id });
  const rerunComparison = rerun.output?.rerunComparison ?? {};
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
      && rerun.status === "completed"
      && rerunComparison.schemaVersion === "toolsmith-rerun-comparison.v1"
      && rerunComparison.matched === true
      && existsSync(stdoutPath)
      && readFileSync(stdoutPath, "utf8").trim().startsWith("v"),
    result: {
      runId: plan.run.id,
      toolSpecId: result.spec.id,
      capability: result.spec.capability,
      executionRunId: execution.id,
      rerunRunId: rerun.id,
      rerunMatched: rerunComparison.matched === true,
      rerunArtifactMatched: rerunComparison.artifactComparison?.matched === true,
      executeElapsedMs: execution.elapsedMs,
      rerunElapsedMs: rerun.elapsedMs,
      stdoutSha256: existsSync(stdoutPath) ? sha256File(stdoutPath) : ""
    },
    followUp: [
      "Complex generated scripts should require promotion review before becoming repo source.",
      "Command splitting intentionally avoids shell features; richer command models need explicit parser tests."
    ]
  };
}

async function runLocalDocumentConversion({ storage, runtime, tempRoot, assetDir }) {
  const outputRoot = join(assetDir, "local-document-conversion");
  const profile = createBroadProfile(storage, tempRoot, assetDir, {
    name: "dogfood local document conversion",
    riskClasses: ["read_only", "reversible"]
  });
  const result = await runtime.runGoalDag({
    goal: "제공한 Markdown 내용을 PDF 문서로 변환해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    title: "Local Document Conversion Dogfood",
    markdown: [
      "# Local Document Conversion Dogfood",
      "",
      "This scenario verifies the local_document_conversion Toolsmith template.",
      "",
      "- no web crawl",
      "- Markdown artifact",
      "- PDF artifact"
    ].join("\n")
  });
  const run = storage.readAutonomyRun(result.run.id);
  const outputDir = run.output.outputDir;
  const dagNodes = storage.listCapabilityDagNodes(run.dagRunId);
  const evalSteps = storage.listComputerUseEvalSteps(run.evalRunId);
  const executionRun = result.toolRuns.findLast((toolRun) => toolRun.status === "completed" && toolRun.mode === "execute");
  assert.ok(executionRun, "local conversion should have a completed execute tool run");
  const rerun = await runtime.rerunToolRun({ toolRunId: executionRun.id });
  const rerunComparison = rerun.output?.rerunComparison ?? {};
  return {
    id: "self-implementation-local-document-conversion",
    userScenario: "사용자가 제공한 Markdown 내용을 로컬에서 PDF 문서로 변환해 달라고 요청한다.",
    architectureWorkflow: [
      "permission_check validates read-only generated-tool and output-root grants",
      "capability_gap classifies local_document_conversion instead of web_research_to_pdf",
      "Toolsmith materializes local_document_conversion.v1 under daemon runtime workspace",
      "smoke_test activates the converter only after Markdown/PDF artifact checks pass",
      "DAG skips crawl/extract/source verification and runs draft/render/store/verify stages",
      "eval ledger records artifact blobs, source hash evidence, timings, and rerun comparison"
    ],
    success: result.run.status === "completed"
      && result.spec.status === "active"
      && result.spec.capability === "local_document_conversion"
      && existsSync(join(outputDir, "report.md"))
      && existsSync(join(outputDir, "report.pdf"))
      && dagNodes.some((node) => node.kind === "crawl_or_observe" && node.status === "skipped")
      && dagNodes.some((node) => node.kind === "draft_markdown" && node.status === "completed")
      && evalSteps.some((step) => step.kind === "toolsmith_smoke" && step.status === "completed")
      && rerun.status === "completed"
      && rerunComparison.schemaVersion === "toolsmith-rerun-comparison.v1"
      && rerunComparison.matched === true,
    result: {
      runId: result.run.id,
      toolSpecId: result.spec.id,
      capability: result.spec.capability,
      outputDir: relativeRepoPath(outputDir),
      dagCompleted: dagNodes.filter((node) => node.status === "completed").length,
      skippedWebStages: dagNodes.filter((node) => ["crawl_or_observe", "extract", "verify_sources"].includes(node.kind) && node.status === "skipped").length,
      evalStepCount: evalSteps.length,
      rerunRunId: rerun.id,
      rerunMatched: rerunComparison.matched === true,
      rerunArtifactMatched: rerunComparison.artifactComparison?.matched === true,
      dagElapsedMs: elapsedBetweenMs(run.createdAt, run.completedAt ?? run.updatedAt),
      executeElapsedMs: result.toolRuns.reduce((sum, toolRun) => sum + Math.max(0, Number(toolRun.elapsedMs ?? 0)), 0),
      rerunElapsedMs: rerun.elapsedMs,
      pdfSha256: sha256File(join(outputDir, "report.pdf")),
      reportSha256: sha256File(join(outputDir, "report.md"))
    },
    followUp: [
      "Pandoc remains optional; builtin PDF rendering is the default unless a profile grants pandoc.",
      "Future promotion should add source-file conversion cases with explicit filesystem_read grants."
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
  const rerun = await runtime.rerunToolRun({ toolRunId: execution.id });
  const rerunComparison = rerun.output?.rerunComparison ?? {};
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
      && rerun.status === "completed"
      && rerunComparison.schemaVersion === "toolsmith-rerun-comparison.v1"
      && rerunComparison.matched === true
      && existsSync(verificationPath)
      && JSON.parse(readFileSync(verificationPath, "utf8")).ok === true,
    result: {
      runId: plan.run.id,
      toolSpecId: result.spec.id,
      capability: result.spec.capability,
      executionRunId: execution.id,
      rerunRunId: rerun.id,
      rerunMatched: rerunComparison.matched === true,
      rerunArtifactMatched: rerunComparison.artifactComparison?.matched === true,
      executeElapsedMs: execution.elapsedMs,
      rerunElapsedMs: rerun.elapsedMs,
      verificationPath: relativeRepoPath(verificationPath)
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
      requestedCapability: plan.gaps[0]?.requestedCapability,
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
    `Successful scenarios: ${evidence.metrics.successfulScenarios}/${evidence.metrics.totalScenarios}`,
    `Generated capability classes: ${evidence.metrics.generatedCapabilityClasses.join(", ")}`,
    `Matched reruns: ${evidence.metrics.rerunMatchedCount}`,
    `Repeated samples: ${evidence.metrics.repeatedGeneratedToolSamples.sampleCount}`,
    `Repeated p95 latency: ${evidence.metrics.repeatedGeneratedToolSamples.p95LatencyMs}ms`,
    `Path redaction: ${evidence.redaction.absolutePathLeakCount === 0 ? "passed" : "failed"}`,
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

function summarizeScenarios(scenarios) {
  const generatedCapabilityClasses = [...new Set(scenarios
    .map((scenario) => scenario.result?.capability)
    .filter(Boolean))].sort();
  const rerunMatchedCount = scenarios.filter((scenario) => scenario.result?.rerunMatched === true).length;
  const rerunArtifactMatchedCount = scenarios.filter((scenario) => scenario.result?.rerunArtifactMatched === true).length;
  return {
    totalScenarios: scenarios.length,
    successfulScenarios: scenarios.filter((scenario) => scenario.success === true).length,
    generatedCapabilityClasses,
    rerunMatchedCount,
    rerunArtifactMatchedCount,
    nativeBlockedCount: scenarios.filter((scenario) => scenario.id === "self-implementation-native-windows-blocked" && scenario.success === true).length
  };
}

function buildRepeatedSampleLedgerEntries(input) {
  const entries = [];
  for (const scenario of input.scenarios) {
    const capability = scenario.result?.capability;
    if (!["browser_download_verify", "local_document_conversion", "terminal_generated_tool", "web_research_to_pdf"].includes(capability)) {
      continue;
    }
    const executeElapsedMs = readFiniteNumber(scenario.result?.executeElapsedMs, scenario.result?.dagElapsedMs);
    const rerunElapsedMs = readFiniteNumber(scenario.result?.rerunElapsedMs);
    if (Number.isFinite(executeElapsedMs)) {
      entries.push(buildRepeatedSample({
        generatedAt: input.generatedAt,
        evidencePath: input.evidencePath,
        scenario,
        capability,
        mode: "execute",
        elapsedMs: executeElapsedMs,
        matched: scenario.success === true,
        artifactMatched: scenario.success === true
      }));
    }
    if (Number.isFinite(rerunElapsedMs)) {
      entries.push(buildRepeatedSample({
        generatedAt: input.generatedAt,
        evidencePath: input.evidencePath,
        scenario,
        capability,
        mode: "rerun",
        elapsedMs: rerunElapsedMs,
        matched: scenario.result?.rerunMatched === true,
        artifactMatched: scenario.result?.rerunArtifactMatched === true
      }));
    }
  }
  return entries.map((entry) => {
    const redacted = redactPaths(entry);
    return {
      ...redacted,
      redaction: {
        rawPathsRedacted: true,
        repoPathsRelative: true,
        absolutePathLeakCount: countAbsolutePathLeaks(JSON.stringify(redacted))
      }
    };
  });
}

function buildRepeatedSample(input) {
  return {
    schemaVersion: "scoped-autonomy-generated-tool-breadth-sample.v1",
    generatedAt: input.generatedAt,
    evidenceClass: "fixture_repeated_generated_tool",
    evidencePath: input.evidencePath,
    scenario: {
      id: input.scenario.id,
      success: input.scenario.success === true,
      result: {
        capability: input.capability,
        elapsedMs: input.elapsedMs,
        rerunMatched: input.scenario.result?.rerunMatched === true,
        rerunArtifactMatched: input.scenario.result?.rerunArtifactMatched === true
      }
    },
    sample: {
      capability: input.capability,
      mode: input.mode,
      status: input.matched ? "completed" : "failed",
      elapsedMs: input.elapsedMs,
      matched: input.matched,
      artifactMatched: input.artifactMatched,
      fixtureBacked: true
    }
  };
}

function summarizeRepeatedSamples(samples) {
  const elapsedValues = samples
    .map((sample) => Number(sample.sample?.elapsedMs))
    .filter(Number.isFinite);
  const generatedClasses = [...new Set(samples.map((sample) => sample.sample?.capability).filter(Boolean))].sort();
  const sampleCountByClass = Object.fromEntries(generatedClasses.map((capability) => [
    capability,
    samples.filter((sample) => sample.sample?.capability === capability).length
  ]));
  return {
    sampleCount: samples.length,
    generatedClasses,
    sampleCountByClass,
    p95LatencyMs: elapsedValues.length ? percentile(elapsedValues, 0.95) : undefined,
    rerunMatchedCount: samples.filter((sample) => sample.sample?.mode === "rerun" && sample.sample?.matched === true).length,
    rerunArtifactMatchedCount: samples.filter((sample) => sample.sample?.mode === "rerun" && sample.sample?.artifactMatched === true).length,
    pathRedactionPresent: samples.length > 0 && samples.every((sample) => Number(sample.redaction?.absolutePathLeakCount ?? 1) === 0)
  };
}

function appendRepeatedSampleLedger(path, samples) {
  if (!samples.length) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`, "utf8");
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
  return (text.match(/[A-Z]:[\\/]/gi) ?? []).length;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function elapsedBetweenMs(startedAt, completedAt) {
  const start = Date.parse(startedAt ?? "");
  const end = Date.parse(completedAt ?? "");
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined;
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
