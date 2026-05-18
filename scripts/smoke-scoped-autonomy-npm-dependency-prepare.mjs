#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { ScopedAutonomyRuntime } from "../dist/daemon/scoped-autonomy/index.js";
import { evaluateAutonomyPermission } from "../dist/daemon/scoped-autonomy/permissionProfile.js";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-autonomy-npm-"));
let storage;

try {
  process.env.CODEX_WIDGET_SMOKE_SECRET_TOKEN = "generated-tool-must-not-inherit-this";
  const runtimeRoot = join(tempRoot, ".runtime", "autonomy");
  const outputRoot = join(tempRoot, "outputs");
  const localPackageDir = join(tempRoot, "local-npm-package");
  mkdirSync(localPackageDir, { recursive: true });
  writeFileSync(join(localPackageDir, "package.json"), JSON.stringify({
    name: "codex-widget-local-npm-probe",
    version: "0.0.1",
    type: "module",
    main: "index.js"
  }, null, 2), "utf8");
  writeFileSync(join(localPackageDir, "index.js"), "export const probe = true;\n", "utf8");
  const forbiddenReadPath = join(tempRoot, "outside-generated-tool-read-fixture.txt");
  writeFileSync(forbiddenReadPath, "generated tool must not read this file\n", "utf8");

  storage = createStorageService({ appDataDir: tempRoot });
  const runtime = new ScopedAutonomyRuntime(storage, { runtimeRoot });
  const spec = storage.upsertAutonomyToolSpec(createNpmProbeSpec({
    id: "tool-npm-dependency-prepare-probe",
    dependencySpec: `file:${localPackageDir.replaceAll("\\", "/")}`,
    runtimeRoot
  }));
  mkdirSync(join(runtimeRoot, "tools", spec.id), { recursive: true });
  writeFileSync(spec.manifest.entrypoint, npmProbeEntrypointSource(), "utf8");

  const blockedProfile = createProfile({
    name: "npm dependency prepare blocked smoke",
    packageInstall: false,
    generatedToolExecution: false,
    packageAllowlist: ["file:*"],
    tempRoot
  });
  const blockedRun = createRun({ profileId: blockedProfile.id, tempRoot, toolSpecId: spec.id });
  const blocked = runtime.prepareToolDependencies({
    autonomyRunId: blockedRun.id,
    toolSpecId: spec.id,
    outputDir: join(outputRoot, "blocked")
  });

  assert.equal(blocked.status, "blocked", JSON.stringify(blocked.output));
  assert.equal(existsSync(join(runtimeRoot, "tools", spec.id, "dependencies", "package-lock.json")), false, "blocked dependency prepare must not create npm lockfiles");
  assert.equal(
    blocked.output.permission.missingRequirements.some((requirement) => requirement.type === "package_install"),
    true,
    "blocked dependency prepare should name the missing package_install grant"
  );

  const missingLocalReadProfile = createProfile({
    name: "npm local dependency read-root blocked smoke",
    packageInstall: true,
    generatedToolExecution: false,
    packageAllowlist: ["file:*"],
    tempRoot,
    readRoots: [join(outputRoot, "read-only-approved")]
  });
  const missingLocalReadRun = createRun({ profileId: missingLocalReadProfile.id, tempRoot, toolSpecId: spec.id });
  const missingLocalRead = runtime.prepareToolDependencies({
    autonomyRunId: missingLocalReadRun.id,
    toolSpecId: spec.id,
    outputDir: join(outputRoot, "missing-local-read")
  });
  assert.equal(missingLocalRead.status, "blocked", JSON.stringify(missingLocalRead.output));
  assert.equal(
    missingLocalRead.output.permission.missingRequirements.some((requirement) => requirement.type === "filesystem_read" && String(requirement.value).includes("local-npm-package")),
    true,
    "local file npm dependencies should require an approved filesystem_read root"
  );

  const transitivePackageDir = join(tempRoot, "local-npm-package-with-transitive-deps");
  mkdirSync(transitivePackageDir, { recursive: true });
  writeFileSync(join(transitivePackageDir, "package.json"), JSON.stringify({
    name: "codex-widget-local-npm-probe",
    version: "0.0.2",
    type: "module",
    main: "index.js",
    dependencies: {
      "left-pad": "1.3.0"
    }
  }, null, 2), "utf8");
  writeFileSync(join(transitivePackageDir, "index.js"), "export const probe = true;\n", "utf8");
  const transitiveSpec = storage.upsertAutonomyToolSpec(createNpmProbeSpec({
    id: "tool-npm-dependency-transitive-policy-probe",
    dependencySpec: `file:${transitivePackageDir.replaceAll("\\", "/")}`,
    runtimeRoot
  }));
  const transitiveProfile = createProfile({
    name: "npm local dependency transitive blocked smoke",
    packageInstall: true,
    generatedToolExecution: false,
    packageAllowlist: ["file:*"],
    tempRoot
  });
  const transitiveRun = createRun({ profileId: transitiveProfile.id, tempRoot, toolSpecId: transitiveSpec.id });
  const transitiveBlocked = runtime.prepareToolDependencies({
    autonomyRunId: transitiveRun.id,
    toolSpecId: transitiveSpec.id,
    outputDir: join(outputRoot, "transitive-blocked")
  });
  assert.equal(transitiveBlocked.status, "failed", JSON.stringify(transitiveBlocked.output));
  assert.equal(transitiveBlocked.lastError, "local_file_dependency_transitive_dependencies_blocked");
  assert.equal(
    transitiveBlocked.output.localDependencyPolicy?.blocked?.some((item) => item.reason === "local_file_package_declares_transitive_dependencies"),
    true,
    "local file npm packages with transitive dependencies must fail before npm install"
  );
  assert.equal(existsSync(join(runtimeRoot, "tools", transitiveSpec.id, "dependencies", "package-lock.json")), false, "blocked transitive local dependency must not create npm lockfiles");

  const allowedProfile = createProfile({
    name: "npm dependency prepare allowed smoke",
    packageInstall: true,
    generatedToolExecution: true,
    packageAllowlist: ["file:*"],
    tempRoot
  });
  const allowedRun = createRun({ profileId: allowedProfile.id, tempRoot, toolSpecId: spec.id });
  const completed = runtime.prepareToolDependencies({
    autonomyRunId: allowedRun.id,
    toolSpecId: spec.id,
    outputDir: join(outputRoot, "allowed")
  });

  assert.equal(completed.status, "completed", JSON.stringify(completed.output));
  assert.equal(completed.output.schemaVersion, "toolsmith-dependency-prepare.v1");
  assert.equal(completed.output.packageInstallPerformed, true);
  assert.equal(completed.output.policyReview?.schemaVersion, "toolsmith-dependency-policy-review.v1");
  assert.equal(completed.output.policyReview?.installIsolation?.ignoreScripts, true);
  assert.equal(completed.output.policyReview?.installIsolation?.noAudit, true);
  assert.equal(completed.output.policyReview?.installIsolation?.noFund, true);
  assert.equal(completed.output.policyReview?.installIsolation?.shell, false);
  assert.equal(completed.output.policyReview?.localFilePackageCount, 1);
  assert.equal(completed.output.policyReview?.externalRegistryPackageCount, 0);
  assert.equal(completed.output.policyReview?.lockfileProvenancePresent, true);
  assert.equal(completed.output.policyReview?.installedPackageProvenancePresent, true);
  assert.equal(completed.output.policyReview?.reviewOutcome, "passed_local_or_allowlisted_dependency_policy");
  assert.equal(existsSync(join(runtimeRoot, "tools", spec.id, "dependencies", "package.json")), true);
  assert.equal(existsSync(join(runtimeRoot, "tools", spec.id, "dependencies", "package-lock.json")), true);
  assert.equal(existsSync(join(runtimeRoot, "tools", spec.id, "dependencies", "node_modules", "codex-widget-local-npm-probe", "index.js")), true);
  assert.equal(completed.output.lockfiles.some((lockfile) => lockfile.basename === "package-lock.json" && typeof lockfile.sha256 === "string"), true);
  assert.equal(
    completed.output.installedPackages.some((dependency) => dependency.name === "codex-widget-local-npm-probe" && dependency.packageJson?.sha256),
    true,
    "completed dependency prepare output should record installed package provenance"
  );
  assert.equal(hasAbsolutePathLeak(completed.output), false, "completed dependency prepare output must not expose absolute local paths");
  assert.equal(JSON.stringify(completed.output).includes(localPackageDir.replaceAll("\\", "/")), false, "file: dependency version must be redacted");

  const preparedSpec = storage.readAutonomyToolSpec(spec.id);
  assert.ok(preparedSpec, "prepared tool spec should remain available before execution");
  storage.upsertAutonomyToolSpec({
    ...preparedSpec,
    status: "active"
  });

  const outsideOutputDir = join(tempRoot, "..", `codex-widget-forbidden-output-${Date.now()}`);
  const outsideOutputRun = createRun({ profileId: allowedProfile.id, tempRoot, toolSpecId: spec.id });
  const outsideOutputExecute = await runtime.execute({
    autonomyRunId: outsideOutputRun.id,
    toolSpecId: spec.id,
    request: {
      outputDir: outsideOutputDir
    }
  });
  assert.equal(outsideOutputExecute.status, "blocked", JSON.stringify(outsideOutputExecute.output));
  assert.equal(
    outsideOutputExecute.output.permission?.missingRequirements?.some((requirement) =>
      (requirement.type === "filesystem_write" || requirement.type === "filesystem_read") &&
        String(requirement.value).includes("codex-widget-forbidden-output")
    ),
    true,
    "generated tool execution must require outputDir read/write grants before runner fs flags are granted"
  );
  assert.equal(existsSync(outsideOutputDir), false, "blocked generated tool execution must not create an unapproved outputDir");

  const executed = await runtime.execute({
    autonomyRunId: allowedRun.id,
    toolSpecId: spec.id,
    request: {
      outputDir: join(outputRoot, "execute"),
      forbiddenReadPath,
      forbiddenNetworkUrl: "https://example.com/"
    }
  });

  assert.equal(executed.status, "completed", JSON.stringify({ output: executed.output, lastError: executed.lastError }));
  assert.equal(executed.output.schemaVersion, "toolsmith-npm-dependency-execute.v1");
  assert.equal(executed.output.dependencyWorkspaceProvided, true);
  assert.equal(executed.output.dependencyImported, true);
  assert.equal(executed.output.probeValue, true);
  assert.equal(executed.output.sandbox?.forbiddenReadBlocked, true, `generated tool must be blocked from reading outside declared roots: ${JSON.stringify(executed.output.sandbox)}`);
  assert.equal(executed.output.sandbox?.forbiddenNetworkBlocked, true, "generated tool must be blocked from fetching outside declared network domains");
  assert.equal(executed.output.sandbox?.forbiddenDnsBlocked, true, "generated tool must be blocked from resolving DNS outside declared network domains");
  assert.equal(executed.output.sandbox?.forbiddenDgramBlocked, true, "generated tool must be blocked from UDP sockets outside declared network domains");
  assert.equal(executed.output.sandbox?.forbiddenHttp2Blocked, true, "generated tool must be blocked from http2 outside declared network domains");
  assert.equal(executed.output.sandbox?.fullProcessEnvInherited, false, "generated tool must not inherit the daemon process environment wholesale");
  assert.equal(executed.output.artifacts.some((artifact) => artifact.role === "report" && artifact.blobId && artifact.resourceId && artifact.sha256), true);
  assert.equal(hasAbsolutePathLeak(executed.output), false, "generated tool execution output must not expose dependency workspace paths");

  const completedEvalSteps = storage.listComputerUseEvalSteps(allowedRun.evalRunId);
  const dependencyStep = completedEvalSteps.find((step) => step.kind === "toolsmith_dependency_prepare" && step.status === "completed");
  assert.ok(dependencyStep, "completed dependency prepare eval step should be recorded");
  assert.equal(hasAbsolutePathLeak(dependencyStep.output), false, "dependency prepare eval step must not expose absolute local paths");
  assert.equal(
    dependencyStep.output.permission.usedRequirements.some((requirement) => requirement.type === "package_install"),
    true,
    "completed eval step should record package_install grant usage"
  );
  assert.equal(
    dependencyStep.output.dependencyRun.output.lockfiles.some((lockfile) => lockfile.basename === "package-lock.json"),
    true,
    "completed eval step should include lockfile provenance"
  );
  assert.equal(
    dependencyStep.output.dependencyRun.output.policyReview.reviewOutcome,
    "passed_local_or_allowlisted_dependency_policy",
    "completed eval step should include dependency policy review"
  );
  const executeStep = completedEvalSteps.find((step) => step.kind === "toolsmith_execute" && step.status === "completed");
  assert.ok(executeStep, "generated tool execution eval step should be recorded");
  assert.equal(hasAbsolutePathLeak(executeStep.output), false, "generated tool execution eval step must not expose dependency workspace paths");
  assert.equal(
    executeStep.output.permission.usedRequirements.some((requirement) => requirement.type === "generated_tool_execution"),
    true,
    "generated tool execution eval step should record generated_tool_execution grant usage"
  );

  const blockedEvalSteps = storage.listComputerUseEvalSteps(blockedRun.evalRunId);
  assert.equal(blockedEvalSteps.some((step) => step.kind === "toolsmith_dependency_prepare" && step.status === "blocked"), true);

  const externalSpec = storage.upsertAutonomyToolSpec(createNpmProbeSpec({
    id: "tool-npm-dependency-external-policy-probe",
    dependencySpec: "1.3.0",
    runtimeRoot
  }));
  const externalBlockedProfile = createProfile({
    name: "npm external dependency allowlist blocked smoke",
    packageInstall: true,
    generatedToolExecution: false,
    packageAllowlist: ["file:*"],
    tempRoot
  });
  const externalBlockedRun = createRun({ profileId: externalBlockedProfile.id, tempRoot, toolSpecId: externalSpec.id });
  const externalBlocked = runtime.prepareToolDependencies({
    autonomyRunId: externalBlockedRun.id,
    toolSpecId: externalSpec.id,
    outputDir: join(outputRoot, "external-blocked")
  });
  assert.equal(externalBlocked.status, "blocked", JSON.stringify(externalBlocked.output));
  assert.equal(externalBlocked.output.policyReview?.schemaVersion, "toolsmith-dependency-policy-review.v1");
  assert.equal(externalBlocked.output.policyReview?.externalRegistryPackageCount, 1);
  const externalPolicyRow = externalBlocked.output.policyReview?.dependencies?.find((dependency) => dependency.externalRegistryPackage === true);
  assert.equal(externalPolicyRow?.packageRequirement, "npm:codex-widget-local-npm-probe@1.3.0");
  assert.equal(externalPolicyRow?.policy, "exact_package_allowlist_required");
  assert.equal(externalBlocked.output.policyReview?.promotionBoundary, "external_registry_package_requires_reviewed_allowlist_and_lockfile_policy");
  assert.equal(
    externalBlocked.output.permission.missingRequirements.some((requirement) =>
      requirement.type === "package_install" && requirement.value === "npm:codex-widget-local-npm-probe@1.3.0"
    ),
    true,
    "external npm dependency prepare should require exact package allowlist grant"
  );
  assert.equal(existsSync(join(runtimeRoot, "tools", externalSpec.id, "dependencies", "package-lock.json")), false, "blocked external dependency prepare must not create npm lockfiles");

  const externalAllowedProfile = createProfile({
    name: "npm external dependency allowlist allowed smoke",
    packageInstall: true,
    generatedToolExecution: false,
    packageAllowlist: ["npm:codex-widget-local-npm-probe@1.3.0"],
    tempRoot
  });
  const exactPackagePermission = evaluateAutonomyPermission({
    profile: externalAllowedProfile,
    requirements: [
      { type: "package_install", value: "npm:codex-widget-local-npm-probe@1.3.0", reason: "External npm package installation requires an exact package allowlist grant." }
    ]
  });
  assert.equal(exactPackagePermission.allowed, true, JSON.stringify(exactPackagePermission));
  assert.equal(exactPackagePermission.usedRequirements[0]?.value, "npm:codex-widget-local-npm-probe@1.3.0");

  console.log("scoped autonomy npm dependency prepare smoke ok");
} finally {
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
        readRoots: input.readRoots ?? [input.tempRoot],
        writeRoots: input.writeRoots ?? [input.tempRoot]
      },
      commands: {
        allowPrefixes: ["npm", "node"],
        denyPatterns: ["password", "token", "cookie", "secret"]
      },
      packageInstall: input.packageInstall,
      packageAllowlist: input.packageAllowlist,
      generatedToolMaterialization: false,
      generatedToolExecution: input.generatedToolExecution,
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
      id: `scoped-autonomy:npm-dependency-prepare:${input.profileId}`,
      title: "Toolsmith npm dependency prepare smoke",
      modalities: ["terminal"],
      source: "smoke",
      prompt: "Prepare a generated tool npm dependency inside the isolated runtime workspace.",
      safetyBoundaries: [
        "package_install_requires_explicit_grant",
        "dependency_install_isolated_to_runtime_workspace",
        "lockfile_provenance_must_be_recorded"
      ]
    },
    modalities: ["terminal"],
    prompt: "Prepare a generated tool npm dependency inside the isolated runtime workspace.",
    metrics: {
      scopedAutonomy: true,
      dependencyPrepareSmoke: true
    }
  });
  return storage.createAutonomyRun({
    goal: "Prepare generated tool dependencies.",
    permissionProfileId: input.profileId,
    evalRunId: evalRun.id,
    status: "smoke_testing",
    toolSpecIds: [input.toolSpecId],
    output: {
      tempRoot: "[redacted]",
      purpose: "npm_dependency_prepare_smoke"
    }
  });
}

function createNpmProbeSpec(input) {
  const now = new Date().toISOString();
  const entrypoint = join(input.runtimeRoot, "tools", input.id, "npm-dependency-probe.mjs");
  return {
    id: input.id,
    name: "NPM Dependency Prepare Probe",
    capability: "terminal_generated_tool",
    version: "0.1.0",
    status: "materialized",
    templateId: "terminal_generated_tool.npm_dependency_prepare_probe",
    entrypointKind: "node_script",
    description: "Smoke-only generated tool spec that exercises isolated npm dependency preparation and provenance.",
    requiredGrants: [
      { type: "generated_tool_execution", value: "terminal_generated_tool", reason: "The smoke generated tool must execute after dependency preparation." },
      { type: "command", value: "node", reason: "The smoke generated tool runs as a Node entrypoint." },
      { type: "risk_class", value: "side_effect", reason: "The smoke generated tool writes a deterministic report artifact." }
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
        templateId: "terminal_generated_tool.npm_dependency_prepare_probe",
        sourceHashes: {},
        iterations: 1,
        generatedAt: now
      },
      stability: {
        rating: "unknown",
        rerunCount: 0,
        externalDependencyWarnings: ["Uses a local file: npm package fixture to avoid network-dependent smoke results."]
      }
    },
    createdAt: now,
    updatedAt: now
  };
}

function hasAbsolutePathLeak(value) {
  const text = JSON.stringify(value);
  return /(^|[^A-Za-z])[A-Z]:[\\/]/.test(text) || /file:(\/\/\/)?[A-Z]:[\\/]/i.test(text);
}

function npmProbeEntrypointSource() {
  return `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import dns from "node:dns/promises";
import dgram from "node:dgram";
import http2 from "node:http2";
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
  let forbiddenReadBlocked = false;
  let forbiddenReadError = null;
  let forbiddenNetworkBlocked = false;
  let forbiddenNetworkError = null;
  let forbiddenDnsBlocked = false;
  let forbiddenDnsError = null;
  let forbiddenDgramBlocked = false;
  let forbiddenDgramError = null;
  let forbiddenHttp2Blocked = false;
  let forbiddenHttp2Error = null;
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
  if (typeof input.forbiddenReadPath === "string" && input.forbiddenReadPath) {
    try {
      readFileSync(input.forbiddenReadPath, "utf8");
      forbiddenReadBlocked = false;
    } catch (error) {
      forbiddenReadError = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "forbidden_read_failed";
      forbiddenReadBlocked = forbiddenReadError === "ERR_ACCESS_DENIED";
    }
  }
  if (typeof input.forbiddenNetworkUrl === "string" && input.forbiddenNetworkUrl) {
    try {
      await fetch(input.forbiddenNetworkUrl);
      forbiddenNetworkBlocked = false;
    } catch (error) {
      forbiddenNetworkError = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "forbidden_network_failed";
      forbiddenNetworkBlocked = forbiddenNetworkError === "ERR_NETWORK_ACCESS_DENIED" || forbiddenNetworkError.includes("network_access_denied");
    }
    let forbiddenNetworkHost = "";
    try {
      forbiddenNetworkHost = new URL(input.forbiddenNetworkUrl).hostname;
    } catch {
      forbiddenNetworkHost = "example.com";
    }
    try {
      await dns.resolve4(forbiddenNetworkHost);
      forbiddenDnsBlocked = false;
    } catch (error) {
      forbiddenDnsError = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "forbidden_dns_failed";
      forbiddenDnsBlocked = forbiddenDnsError === "ERR_NETWORK_ACCESS_DENIED" || forbiddenDnsError.includes("network_access_denied");
    }
    try {
      const socket = dgram.createSocket("udp4");
      try {
        socket.send(Buffer.from("x"), 53, forbiddenNetworkHost);
        forbiddenDgramBlocked = false;
      } finally {
        socket.close();
      }
    } catch (error) {
      forbiddenDgramError = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "forbidden_dgram_failed";
      forbiddenDgramBlocked = forbiddenDgramError === "ERR_NETWORK_ACCESS_DENIED" || forbiddenDgramError.includes("network_access_denied");
    }
    try {
      const session = http2.connect(input.forbiddenNetworkUrl);
      session.close();
      forbiddenHttp2Blocked = false;
    } catch (error) {
      forbiddenHttp2Error = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "forbidden_http2_failed";
      forbiddenHttp2Blocked = forbiddenHttp2Error === "ERR_NETWORK_ACCESS_DENIED" || forbiddenHttp2Error.includes("network_access_denied");
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
      probeValue,
      sandbox: {
        forbiddenReadBlocked,
        forbiddenReadError,
        forbiddenNetworkBlocked,
        forbiddenNetworkError,
        forbiddenDnsBlocked,
        forbiddenDnsError,
        forbiddenDgramBlocked,
        forbiddenDgramError,
        forbiddenHttp2Blocked,
        forbiddenHttp2Error
      }
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
    sandbox: {
      forbiddenReadBlocked,
      forbiddenReadError,
      forbiddenNetworkBlocked,
      forbiddenNetworkError,
      forbiddenDnsBlocked,
      forbiddenDnsError,
      forbiddenDgramBlocked,
      forbiddenDgramError,
      forbiddenHttp2Blocked,
      forbiddenHttp2Error,
      envKeys: Object.keys(process.env).sort(),
      fullProcessEnvInherited: Object.keys(process.env).some((key) => /TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL/i.test(key))
    },
    artifacts
  }));
});
`;
}
