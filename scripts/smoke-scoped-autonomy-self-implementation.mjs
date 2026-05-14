#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { ScopedAutonomyRuntime } from "../dist/daemon/scoped-autonomy/index.js";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-scoped-autonomy-self-"));
let storage;

try {
  storage = createStorageService({ appDataDir: tempRoot });
  assert.equal(storage.health().schemaVersion >= 6, true, "self-implementation migration should apply");

  const outputRoot = join(tempRoot, "outputs");
  const profile = storage.createAutonomyPermissionProfile({
    name: "self implementation smoke",
    mode: "scoped_yolo",
    scope: "persistent",
    grants: {
      network: true,
      networkDomains: ["openai.com", "platform.openai.com", "help.openai.com", "example.com"],
      filesystem: {
        readRoots: [tempRoot],
        writeRoots: [tempRoot]
      },
      commands: {
        allowPrefixes: ["node"],
        denyPatterns: ["password", "token", "cookie", "secret"]
      },
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      riskClasses: ["read_only", "reversible"],
      maxRuntimeMs: 20_000,
      maxOutputBytes: 2 * 1024 * 1024,
      maxIterations: 3
    }
  });

  const runtime = new ScopedAutonomyRuntime(storage, { runtimeRoot: join(tempRoot, ".runtime", "autonomy") });
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
        text: "Codex supports command-line oriented development workflows, repository inspection, edits, tests, and handoff reporting."
      }
    ]
  });

  assert.equal(result.run.status, "completed", JSON.stringify(result.run.output));
  assert.equal(result.spec.status, "active");
  assert.equal(result.spec.manifest.schemaVersion, "autonomy-tool-manifest.v1");
  assert.equal(Boolean(result.spec.sourceHash), true);
  assert.equal(result.toolRuns.length >= 8, true, "smoke plus seven DAG stages should be recorded");

  const finalRun = storage.readAutonomyRun(result.run.id);
  const outputDir = finalRun.output.outputDir;
  assert.equal(typeof outputDir, "string");
  assert.equal(existsSync(join(outputDir, "report.md")), true);
  assert.equal(existsSync(join(outputDir, "report.pdf")), true);
  assert.equal(existsSync(join(outputDir, "citations.json")), true);

  const evalSteps = storage.listComputerUseEvalSteps(finalRun.evalRunId);
  assert.equal(evalSteps.filter((step) => step.kind === "toolsmith_generate_source").length >= 2, true, "first smoke failure should trigger a revised source iteration");
  assert.equal(evalSteps.some((step) => step.kind === "toolsmith_smoke" && step.status === "failed"), true);
  assert.equal(evalSteps.some((step) => step.kind === "toolsmith_smoke" && step.status === "completed"), true);
  for (const kind of ["crawl_or_observe", "extract", "verify_sources", "draft_markdown", "render_pdf", "store_artifact", "verify_artifact"]) {
    assert.equal(storage.listCapabilityDagNodes(finalRun.dagRunId).some((node) => node.kind === kind && node.status === "completed"), true, `DAG node should complete: ${kind}`);
  }
  assert.equal(storage.listComputerUseEvalResources(finalRun.evalRunId).some((resource) => resource.role === "autonomy_pdf"), true);

  const inventory = storage.listAutonomyCapabilityInventory({ capability: "web_research_to_pdf" });
  assert.equal(inventory.some((item) => item.status === "generated" && item.toolSpecId === result.spec.id), true);

  const lastExecutableRun = result.toolRuns.findLast((toolRun) => toolRun.status === "completed" && toolRun.mode === "execute");
  assert.ok(lastExecutableRun, "completed execution tool run should exist");
  const rerun = await runtime.rerunToolRun({ toolRunId: lastExecutableRun.id });
  assert.equal(rerun.status, "completed", rerun.lastError);

  const debugBundle = runtime.createDebugBundle(finalRun.id);
  assert.equal(debugBundle.schemaVersion, "autonomy-debug-bundle.v1");
  assert.equal(debugBundle.redaction.rawArtifactPathsRedacted, true);
  assert.equal(debugBundle.tools.some((tool) => tool.id === result.spec.id), true);

  const rollback = runtime.rollbackRun({ autonomyRunId: finalRun.id });
  assert.equal(rollback.status, "completed", rollback.lastError);
  assert.equal(storage.readAutonomyToolSpec(result.spec.id).status, "retired");
  assert.equal(storage.readAutonomyPermissionProfile(profile.id).status, "active");

  console.log("scoped autonomy self-implementation smoke ok");
} finally {
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
