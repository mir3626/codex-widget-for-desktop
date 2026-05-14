#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { ScopedAutonomyRuntime, sanitizeAutonomyInput } from "../dist/daemon/scoped-autonomy/index.js";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-scoped-autonomy-"));
let storage;

try {
  storage = createStorageService({ appDataDir: tempRoot });
  assert.equal(storage.health().schemaVersion >= 5, true, "scoped autonomy migration should apply");

  const outputRoot = join(tempRoot, "exports");
  const profile = storage.createAutonomyPermissionProfile({
    name: "smoke scoped autonomy",
    mode: "scoped_yolo",
    grants: {
      networkDomains: ["openai.com", "help.openai.com", "platform.openai.com", "example.com"],
      browserDomains: ["openai.com"],
      filesystem: {
        readRoots: [tempRoot],
        writeRoots: [tempRoot]
      },
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      maxRuntimeMs: 10_000,
      maxOutputBytes: 1024 * 1024
    }
  });

  const runtime = new ScopedAutonomyRuntime(storage, { runtimeRoot: join(tempRoot, ".runtime", "autonomy") });
  const plan = runtime.plan({
    goal: "OpenAI 홈페이지에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.",
    permissionProfileId: profile.id,
    outputRoot,
    availableCapabilities: []
  });
  assert.equal(plan.permission.allowed, true, plan.permission.reason);
  assert.equal(plan.gaps.some((gap) => gap.requestedCapability === "web_research_to_pdf"), true);
  assert.equal(storage.listAutonomyCapabilityGaps(plan.run.id).length, 1);

  const spec = runtime.materializeTool({ autonomyRunId: plan.run.id, gapId: plan.gaps[0].id });
  assert.equal(spec.status, "materialized");
  assert.equal(spec.artifacts.some((artifact) => artifact.role === "entrypoint" && existsSync(artifact.path)), true);

  const smokeRun = await runtime.runSmoke({ autonomyRunId: plan.run.id, toolSpecId: spec.id });
  assert.equal(smokeRun.status, "completed", smokeRun.lastError);
  const smokedSpec = storage.readAutonomyToolSpec(spec.id);
  assert.equal(smokedSpec.status, "active");

  const executeOutputDir = join(outputRoot, "codex-report");
  const execution = await runtime.execute({
    autonomyRunId: plan.run.id,
    toolSpecId: spec.id,
    request: {
      title: "OpenAI Codex command support report",
      outputDir: executeOutputDir,
      sourceDocuments: [
        {
          title: "OpenAI Codex fixture",
          url: "https://openai.com/codex",
          text: "Codex supports command-line oriented development workflows, repository inspection, edits, tests, and handoff reporting."
        }
      ]
    }
  });
  assert.equal(execution.status, "completed", execution.lastError);
  const pdfPath = join(executeOutputDir, "report.pdf");
  const markdownPath = join(executeOutputDir, "report.md");
  assert.equal(existsSync(pdfPath), true, "PDF artifact should be written");
  assert.equal(existsSync(markdownPath), true, "Markdown artifact should be written");
  assert.equal(readFileSync(pdfPath).subarray(0, 5).toString("ascii"), "%PDF-");

  const completedRun = storage.readAutonomyRun(plan.run.id);
  assert.equal(completedRun.status, "completed");
  const evalSteps = storage.listComputerUseEvalSteps(completedRun.evalRunId);
  assert.equal(evalSteps.some((step) => step.kind === "scoped_autonomy_plan"), true);
  assert.equal(evalSteps.some((step) => step.kind === "toolsmith_materialize"), true);
  assert.equal(evalSteps.some((step) => step.kind === "toolsmith_smoke"), true);
  assert.equal(evalSteps.some((step) => step.kind === "toolsmith_execute"), true);
  assert.equal(evalSteps.some((step) => step.kind === "scoped_autonomy_verification"), true);
  assert.equal(storage.listComputerUseEvalResources(completedRun.evalRunId).some((resource) => resource.role === "autonomy_pdf"), true);

  const redacted = sanitizeAutonomyInput({
    sourceDocuments: [{ text: "token=abc123 should never persist raw" }]
  });
  assert.equal(redacted.sourceDocuments[0].text, "[redacted]");

  const blockedProfile = storage.createAutonomyPermissionProfile({
    name: "blocked scoped autonomy",
    mode: "scoped_yolo",
    grants: {
      networkDomains: ["openai.com"],
      filesystem: { readRoots: [tempRoot], writeRoots: [tempRoot] },
      generatedToolMaterialization: true,
      generatedToolExecution: false,
      generatedCode: true
    }
  });
  const blockedPlan = runtime.plan({
    goal: "OpenAI 홈페이지에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.",
    permissionProfileId: blockedProfile.id,
    outputRoot,
    availableCapabilities: []
  });
  assert.equal(blockedPlan.permission.allowed, false);
  assert.equal(blockedPlan.run.status, "blocked");

  console.log("scoped autonomy toolsmith smoke ok");
} finally {
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
