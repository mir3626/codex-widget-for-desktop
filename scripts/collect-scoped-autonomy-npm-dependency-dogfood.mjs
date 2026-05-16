#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { ScopedAutonomyRuntime } from "../dist/daemon/scoped-autonomy/index.js";

const DATE = process.env.CODEX_WIDGET_DOGFOOD_DATE ?? formatSeoulDate(new Date());
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `scoped-autonomy-npm-dependency-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `scoped-autonomy-npm-dependency-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `scoped-autonomy-npm-dependency-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const sampleLedgerPath = join(repoRoot, "docs", "reports", "assets", "scoped-autonomy-npm-dependency-runs.jsonl");
const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-npm-dependency-dogfood-"));
let storage;

try {
  rmSync(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(assetDir, { recursive: true });
  storage = createStorageService({ appDataDir: tempRoot });
  const runtimeRoot = join(tempRoot, ".runtime", "autonomy");
  const runtime = new ScopedAutonomyRuntime(storage, { runtimeRoot });
  const generatedAt = new Date().toISOString();
  const scenarios = [];

  for (const iteration of [1, 2]) {
    scenarios.push(await runPackageConsumingGeneratedTool({ storage, runtime, runtimeRoot, iteration }));
  }

  const samples = buildSampleLedgerEntries({
    generatedAt,
    evidencePath: relativeRepoPath(evidencePath),
    scenarios
  });
  const redactedScenarios = redactPaths(scenarios);
  const rawEvidence = {
    schemaVersion: "scoped-autonomy-npm-dependency-dogfood.v1",
    generatedAt,
    storageSchemaVersion: storage.health().schemaVersion,
    evidenceClass: "local_npm_dependency",
    scenarios: redactedScenarios,
    metrics: summarizeScenarios(redactedScenarios, samples),
    sampleLedger: relativeRepoPath(sampleLedgerPath),
    improvementItems: [
      "This dogfood proves package-consuming generated-tool execution with isolated local npm dependencies.",
      "The fixture uses a local file package to avoid network-dependent package registry behavior.",
      "Promotion remains blocked for external package install policy until package allowlist, provenance, and lock review rules are productized."
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
  appendSampleLedger(sampleLedgerPath, samples);

  assert.equal(evidence.scenarios.every((scenario) => scenario.success), true);
  assert.equal(evidence.metrics.repeatedSamplesPresent, true);
  assert.equal(evidence.metrics.packageInstallProvenancePresent, true);
  assert.equal(evidence.metrics.dependencyExecutionImportPresent, true);
  assert.equal(evidence.metrics.rerunStabilityPresent, true);
  assert.equal(evidence.metrics.pathRedactionPresent, true);
  assert.equal(evidence.redaction.absolutePathLeakCount, 0, "npm dependency dogfood evidence must not leak absolute local paths");
  assert.equal(countAbsolutePathLeaks(samples.map((sample) => JSON.stringify(sample)).join("\n")), 0, "npm dependency sample ledger must not leak absolute local paths");
  console.log(`scoped autonomy npm dependency dogfood evidence written: ${reportPath}`);
} finally {
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function runPackageConsumingGeneratedTool({ storage, runtime, runtimeRoot, iteration }) {
  const outputRoot = join(assetDir, `npm-dependency-${iteration}`);
  const localPackageDir = join(tempRoot, `local-npm-package-${iteration}`);
  mkdirSync(localPackageDir, { recursive: true });
  writeFileSync(join(localPackageDir, "package.json"), JSON.stringify({
    name: "codex-widget-local-npm-probe",
    version: `0.0.${iteration}`,
    type: "module",
    main: "index.js"
  }, null, 2), "utf8");
  writeFileSync(join(localPackageDir, "index.js"), "export const probe = true;\n", "utf8");

  const spec = storage.upsertAutonomyToolSpec(createNpmProbeSpec({
    id: `tool-npm-dependency-dogfood-probe-${iteration}`,
    dependencySpec: `file:${localPackageDir.replaceAll("\\", "/")}`,
    runtimeRoot
  }));
  mkdirSync(join(runtimeRoot, "tools", spec.id), { recursive: true });
  writeFileSync(spec.manifest.entrypoint, npmProbeEntrypointSource(), "utf8");

  const profile = createProfile({
    name: `npm dependency dogfood ${iteration}`,
    readRoots: [tempRoot, assetDir],
    writeRoots: [tempRoot, assetDir]
  });
  const run = createRun({ profileId: profile.id, toolSpecId: spec.id, iteration });
  const startedAt = Date.now();
  const dependencyRun = runtime.prepareToolDependencies({
    autonomyRunId: run.id,
    toolSpecId: spec.id,
    outputDir: join(outputRoot, "prepare")
  });
  storage.upsertAutonomyToolSpec({
    ...storage.readAutonomyToolSpec(spec.id),
    status: "active"
  });
  const execution = await runtime.execute({
    autonomyRunId: run.id,
    toolSpecId: spec.id,
    request: {
      outputDir: join(outputRoot, "execute")
    }
  });
  const rerun = await runtime.rerunToolRun({ toolRunId: execution.id });
  const completedRun = storage.readAutonomyRun(run.id);
  const evalSteps = storage.listComputerUseEvalSteps(run.evalRunId);
  const evalResources = storage.listComputerUseEvalResources(run.evalRunId);
  const dependencyStep = evalSteps.find((step) => step.kind === "toolsmith_dependency_prepare" && step.status === "completed");
  const executeStep = evalSteps.find((step) => step.kind === "toolsmith_execute" && step.status === "completed");
  const artifact = Array.isArray(execution.output?.artifacts) ? execution.output.artifacts[0] : null;
  const rerunComparison = rerun.output?.rerunComparison ?? {};
  const scenario = {
    id: `npm-dependency-generated-tool-${iteration}`,
    capability: "terminal_generated_tool",
    sourceClass: "local_file_npm_dependency",
    userScenario: "A scoped user asks Toolsmith to run a generated Node tool that consumes a prepared npm dependency.",
    architectureWorkflow: [
      "permission profile allows package_install, generated_tool_execution, npm/node command prefixes, and bounded runtime/output roots",
      "Toolsmith prepares dependencies inside the generated tool runtime workspace",
      "dependency preparation records installed package provenance without exposing local file package paths",
      "generated Node entrypoint receives only CODEX_WIDGET_TOOL_DEPENDENCY_ROOT and imports the prepared package",
      "execution stores a blob-backed artifact and rerun compares stable output"
    ],
    success: Boolean(dependencyRun.status === "completed"
      && execution.status === "completed"
      && rerun.status === "completed"
      && execution.output?.dependencyImported === true
      && execution.output?.probeValue === true
      && rerunComparison.matched === true
      && dependencyStep
      && executeStep
      && artifact?.blobId
      && artifact?.resourceId),
    result: {
      runId: run.id,
      status: completedRun?.status,
      toolSpecId: spec.id,
      dependencyPrepareRunId: dependencyRun.id,
      executeToolRunId: execution.id,
      rerunToolRunId: rerun.id,
      outputRoot: relativeRepoPath(outputRoot),
      elapsedMs: Date.now() - startedAt,
      prepareElapsedMs: dependencyRun.elapsedMs,
      executeElapsedMs: execution.elapsedMs,
      rerunElapsedMs: rerun.elapsedMs,
      packageInstallPerformed: dependencyRun.output?.packageInstallPerformed === true,
      installedPackageCount: Array.isArray(dependencyRun.output?.installedPackages) ? dependencyRun.output.installedPackages.length : 0,
      installedPackages: dependencyRun.output?.installedPackages ?? [],
      dependencyPolicyReview: dependencyRun.output?.policyReview,
      dependencyPolicyReviewOutcome: dependencyRun.output?.policyReview?.reviewOutcome,
      dependencyWorkspaceProvided: execution.output?.dependencyWorkspaceProvided === true,
      dependencyImported: execution.output?.dependencyImported === true,
      probeValue: execution.output?.probeValue === true,
      artifactStored: Boolean(artifact?.blobId && artifact?.resourceId && artifact?.sha256),
      artifactRole: artifact?.role,
      evalDependencyStepStatus: dependencyStep?.status,
      evalExecuteStepStatus: executeStep?.status,
      evalResourceCount: evalResources.length,
      rerunMatched: rerunComparison.matched === true,
      rerunArtifactMatched: rerunComparison.artifactComparison?.matched === true,
      permissionEvidence: {
        packageInstallUsed: dependencyStep?.output?.permission?.usedRequirements?.some((requirement) => requirement.type === "package_install") === true,
        generatedToolExecutionUsed: executeStep?.output?.permission?.usedRequirements?.some((requirement) => requirement.type === "generated_tool_execution") === true
      }
    },
    followUp: [
      "Add reviewed external package allowlist policy before treating network package install as promotable.",
      "Keep generated package execution behind explicit package_install and generated_tool_execution grants."
    ]
  };
  scenario.redaction = {
    absolutePathLeakCount: countAbsolutePathLeaks(JSON.stringify(redactPaths(scenario)))
  };
  return redactPaths(scenario);
}

function createProfile(input) {
  return storage.createAutonomyPermissionProfile({
    name: input.name,
    mode: "scoped_yolo",
    scope: "persistent",
    grants: {
      network: false,
      networkDomains: [],
      filesystem: {
        readRoots: input.readRoots,
        writeRoots: input.writeRoots
      },
      commands: {
        allowPrefixes: ["npm", "node"],
        denyPatterns: ["password", "token", "cookie", "secret"]
      },
      packageInstall: true,
      generatedToolMaterialization: false,
      generatedToolExecution: true,
      generatedCode: false,
      osMutation: false,
      credentialAccess: "never",
      riskClasses: ["side_effect"],
      maxRuntimeMs: 120_000,
      maxOutputBytes: 1024 * 1024,
      maxIterations: 1
    }
  });
}

function createRun(input) {
  const evalRun = storage.createComputerUseEvalRun({
    scenario: {
      id: `scoped-autonomy:npm-dependency-dogfood:${input.iteration}`,
      title: "Toolsmith npm dependency dogfood",
      modalities: ["terminal"],
      source: "dogfood",
      prompt: "Prepare and execute a generated tool that consumes an isolated npm dependency.",
      safetyBoundaries: [
        "package_install_requires_explicit_grant",
        "dependency_install_isolated_to_runtime_workspace",
        "generated_tool_execution_requires_explicit_grant",
        "dependency_workspace_paths_must_be_redacted"
      ]
    },
    modalities: ["terminal"],
    prompt: "Prepare and execute a generated tool that consumes an isolated npm dependency.",
    metrics: {
      scopedAutonomy: true,
      dependencyDogfood: true
    }
  });
  return storage.createAutonomyRun({
    goal: "Prepare and execute generated tool dependencies.",
    permissionProfileId: input.profileId,
    evalRunId: evalRun.id,
    status: "smoke_testing",
    toolSpecIds: [input.toolSpecId],
    output: {
      tempRoot: "[redacted]",
      purpose: "npm_dependency_dogfood"
    }
  });
}

function createNpmProbeSpec(input) {
  const now = new Date().toISOString();
  const entrypoint = join(input.runtimeRoot, "tools", input.id, "npm-dependency-probe.mjs");
  return {
    id: input.id,
    name: "NPM Dependency Dogfood Probe",
    capability: "terminal_generated_tool",
    version: "0.1.0",
    status: "materialized",
    templateId: "terminal_generated_tool.npm_dependency_dogfood_probe",
    entrypointKind: "node_script",
    description: "Dogfood generated tool spec that exercises isolated npm dependency preparation and execution.",
    requiredGrants: [
      { type: "generated_tool_execution", value: "terminal_generated_tool", reason: "The generated tool must execute after dependency preparation." },
      { type: "command", value: "node", reason: "The generated tool runs as a Node entrypoint." },
      { type: "risk_class", value: "side_effect", reason: "The generated tool writes a deterministic report artifact." }
    ],
    smokeTests: [],
    artifacts: [
      {
        role: "entrypoint",
        path: entrypoint,
        mime: "application/javascript",
        size: 0,
        sha256: "",
        createdAt: now
      }
    ],
    manifest: {
      schemaVersion: "autonomy-tool-manifest.v1",
      toolId: input.id,
      capability: "terminal_generated_tool",
      entrypoint,
      commandAllowlist: ["node"],
      dependencies: [
        { name: "node", source: "system", installed: true },
        { name: "codex-widget-local-npm-probe", version: input.dependencySpec, source: "npm", installed: false }
      ],
      smokeCommands: [],
      artifactContract: [],
      rollback: [
        { type: "delete_path", target: join(input.runtimeRoot, "tools", input.id, "dependencies") },
        { type: "deactivate_tool", target: input.id }
      ],
      provenance: {
        generatedBy: "ad_hoc_generator",
        templateId: "terminal_generated_tool.npm_dependency_dogfood_probe",
        sourceHashes: {},
        iterations: 1,
        generatedAt: now
      },
      stability: {
        rating: "unknown",
        rerunCount: 0,
        externalDependencyWarnings: ["Uses a local file: npm package fixture to avoid network-dependent dogfood results."]
      }
    },
    createdAt: now,
    updatedAt: now
  };
}

function npmProbeEntrypointSource() {
  return `import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", async () => {
  const request = JSON.parse(stdin || "{}");
  const input = request.input && typeof request.input === "object" ? request.input : {};
  const dependencyRoot = process.env.CODEX_WIDGET_TOOL_DEPENDENCY_ROOT;
  let dependencyImported = false;
  let probeValue = false;
  let dependencyImportError = null;
  if (dependencyRoot) {
    try {
      const modulePath = join(dependencyRoot, "node_modules", "codex-widget-local-npm-probe", "index.js");
      dependencyImported = existsSync(modulePath);
      if (dependencyImported) {
        const module = await import(pathToFileURL(modulePath).href);
        probeValue = module.probe === true;
      }
    } catch (error) {
      dependencyImportError = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "dependency_import_failed";
    }
  }
  const outputDir = typeof input.outputDir === "string" ? input.outputDir : "";
  const artifacts = [];
  if (outputDir) {
    mkdirSync(outputDir, { recursive: true });
    const reportPath = join(outputDir, "npm-dependency-execution-result.json");
    writeFileSync(reportPath, JSON.stringify({
      dependencyWorkspaceProvided: Boolean(dependencyRoot),
      dependencyImported,
      probeValue
    }, null, 2), "utf8");
    artifacts.push({ role: "report", path: reportPath, mime: "application/json" });
  }
  process.stdout.write(JSON.stringify({
    ok: dependencyImported && probeValue,
    schemaVersion: "toolsmith-npm-dependency-execute.v1",
    dependencyWorkspaceProvided: Boolean(dependencyRoot),
    dependencyImported,
    probeValue,
    dependencyImportError,
    artifacts
  }));
});
`;
}

function buildSampleLedgerEntries(input) {
  const entries = [];
  for (const scenario of input.scenarios) {
    for (const mode of ["execute", "rerun"]) {
      const elapsedMs = mode === "execute"
        ? Number(scenario.result?.executeElapsedMs ?? scenario.result?.elapsedMs ?? 0)
        : Number(scenario.result?.rerunElapsedMs ?? 0);
      const sample = {
        schemaVersion: "scoped-autonomy-npm-dependency-sample.v1",
        evidenceClass: "local_npm_dependency",
        generatedAt: input.generatedAt,
        evidencePath: input.evidencePath,
        scenario: {
          id: scenario.id,
          capability: scenario.capability,
          success: scenario.success
        },
        sample: {
          mode,
          status: "completed",
          capability: scenario.capability,
          packageInstallPerformed: scenario.result?.packageInstallPerformed === true,
          dependencyImported: scenario.result?.dependencyImported === true,
          installedPackageCount: scenario.result?.installedPackageCount,
          artifactStored: scenario.result?.artifactStored === true,
          matched: mode === "rerun" ? scenario.result?.rerunMatched === true : undefined,
          artifactMatched: mode === "rerun" ? scenario.result?.rerunArtifactMatched === true : undefined,
          elapsedMs
        }
      };
      entries.push({
        ...sample,
        redaction: {
          absolutePathLeakCount: countAbsolutePathLeaks(JSON.stringify(sample))
        }
      });
    }
  }
  return entries;
}

function summarizeScenarios(scenarios, samples) {
  const p95Values = samples.map((sample) => Number(sample.sample?.elapsedMs)).filter(Number.isFinite);
  const executeSamples = samples.filter((sample) => sample.sample?.mode === "execute");
  const rerunSamples = samples.filter((sample) => sample.sample?.mode === "rerun");
  return {
    scenarioCount: scenarios.length,
    successCount: scenarios.filter((scenario) => scenario.success === true).length,
    sampleCount: samples.length,
    executeSampleCount: executeSamples.length,
    rerunSampleCount: rerunSamples.length,
    repeatedSamplesPresent: executeSamples.length >= 2 && rerunSamples.length >= 2,
    p95LatencySampleCount: p95Values.length,
    p95LatencyMs: p95Values.length ? percentile(p95Values, 0.95) : undefined,
    packageInstallProvenancePresent: scenarios.every((scenario) =>
      scenario.result?.packageInstallPerformed === true &&
      Number(scenario.result?.installedPackageCount ?? 0) >= 1 &&
      Array.isArray(scenario.result?.installedPackages) &&
      scenario.result.installedPackages.some((dependency) => dependency.packageJson?.sha256)
    ),
    dependencyPolicyReviewPresent: scenarios.every((scenario) =>
      scenario.result?.dependencyPolicyReview?.schemaVersion === "toolsmith-dependency-policy-review.v1" &&
      scenario.result?.dependencyPolicyReview?.reviewOutcome === "passed_local_or_allowlisted_dependency_policy" &&
      scenario.result?.dependencyPolicyReview?.installIsolation?.ignoreScripts === true &&
      scenario.result?.dependencyPolicyReview?.installIsolation?.shell === false
    ),
    dependencyExecutionImportPresent: scenarios.every((scenario) =>
      scenario.result?.dependencyWorkspaceProvided === true &&
      scenario.result?.dependencyImported === true &&
      scenario.result?.probeValue === true
    ),
    evalEvidencePresent: scenarios.every((scenario) =>
      scenario.result?.evalDependencyStepStatus === "completed" &&
      scenario.result?.evalExecuteStepStatus === "completed"
    ),
    artifactEvidencePresent: scenarios.every((scenario) =>
      scenario.result?.artifactStored === true &&
      Number(scenario.result?.evalResourceCount ?? 0) >= 1
    ),
    rerunStabilityPresent: scenarios.every((scenario) =>
      scenario.result?.rerunMatched === true &&
      scenario.result?.rerunArtifactMatched === true
    ),
    pathRedactionPresent: scenarios.every((scenario) => Number(scenario.redaction?.absolutePathLeakCount ?? 1) === 0) &&
      samples.every((sample) => Number(sample.redaction?.absolutePathLeakCount ?? 1) === 0)
  };
}

function renderReport(evidence) {
  const lines = [
    "# Scoped Autonomy NPM Dependency Dogfood",
    "",
    `Generated: ${evidence.generatedAt}`,
    `Evidence class: \`${evidence.evidenceClass}\``,
    "",
    "## Metrics",
    "",
    `- scenarios: ${evidence.metrics.scenarioCount}`,
    `- samples: ${evidence.metrics.sampleCount}`,
    `- p95 latency ms: ${evidence.metrics.p95LatencyMs}`,
    `- package install provenance: ${evidence.metrics.packageInstallProvenancePresent}`,
    `- dependency import execution: ${evidence.metrics.dependencyExecutionImportPresent}`,
    `- rerun stability: ${evidence.metrics.rerunStabilityPresent}`,
    `- path redaction: ${evidence.metrics.pathRedactionPresent}`,
    "",
    "## Scenarios",
    ""
  ];
  for (const scenario of evidence.scenarios) {
    lines.push(`### ${scenario.id}`);
    lines.push("");
    lines.push(`- success: \`${scenario.success}\``);
    lines.push(`- capability: \`${scenario.capability}\``);
    lines.push(`- source class: \`${scenario.sourceClass}\``);
    lines.push(`- installed packages: \`${scenario.result.installedPackageCount}\``);
    lines.push(`- dependency imported: \`${scenario.result.dependencyImported}\``);
    lines.push(`- artifact stored: \`${scenario.result.artifactStored}\``);
    lines.push(`- rerun matched: \`${scenario.result.rerunMatched}\``);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function appendSampleLedger(path, rows) {
  mkdirSync(join(repoRoot, "docs", "reports", "assets"), { recursive: true });
  for (const row of rows) {
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
  }
}

function redactPaths(value) {
  if (typeof value === "string") {
    return redactPathLikeString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactPaths);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if ((key === "path" || key.endsWith("Path") || key.endsWith("Dir") || key.endsWith("Root")) && typeof nested === "string") {
      output[key] = redactPath(nested);
    } else {
      output[key] = redactPaths(nested);
    }
  }
  return output;
}

function redactPathLikeString(value) {
  const normalized = value.replace(/\\/g, "/");
  if (/^file:(\/\/\/)?[A-Za-z]:\//i.test(normalized)) {
    return `file:<redacted>/${normalized.split("/").filter(Boolean).at(-1) ?? "path"}`;
  }
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) {
    return redactPath(normalized);
  }
  return value;
}

function redactPath(path) {
  const normalized = String(path).replace(/\\/g, "/");
  return `<redacted>/${normalized.split("/").filter(Boolean).at(-1) ?? "path"}`;
}

function relativeRepoPath(path) {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

function countAbsolutePathLeaks(text) {
  return (String(text).match(/(^|[^A-Za-z])[A-Z]:[\\/]/g) ?? []).length +
    (String(text).match(/file:(\/\/\/)?[A-Z]:[\\/]/gi) ?? []).length;
}

function percentile(values, ratio) {
  if (!values.length) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function formatSeoulDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}
