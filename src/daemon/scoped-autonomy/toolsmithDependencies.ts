import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AutonomyGeneratedToolManifest,
  AutonomyGeneratedToolSpec,
  AutonomyPermissionRequirement
} from "../../shared/protocol.js";
import { redactPath, redactPathLikeString } from "./toolsmithRedaction.js";
import { asRecord, sha256Bytes } from "./toolsmithShared.js";
import { uniqueRequirements } from "./toolsmithPermissions.js";

export function dependencyPreparationRequirements(
  spec: AutonomyGeneratedToolSpec,
  workspace: string
): AutonomyPermissionRequirement[] {
  const manifest = spec.manifest;
  if (!manifest) {
    return [];
  }
  const requirements: AutonomyPermissionRequirement[] = [];
  const installableDependencies = manifest.dependencies.filter((dependency) =>
    (dependency.source === "npm" || dependency.source === "pip") &&
    dependency.installed !== true
  );
  if (installableDependencies.length > 0) {
    requirements.push(
      { type: "package_install", value: "isolated_runtime_workspace", reason: "Generated tool dependency installation must be explicitly granted." },
      { type: "filesystem_write", value: workspace, reason: "Generated tool dependencies must be installed only in an isolated runtime workspace." },
      { type: "risk_class", value: "side_effect", reason: "Dependency installation mutates the isolated runtime workspace." }
    );
  }
  for (const dependency of installableDependencies.filter((dependency) => dependency.source === "npm" && isLocalNpmDependency(dependency.version))) {
    const localPath = localNpmDependencyPath(dependency.version, workspace);
    if (localPath) {
      requirements.push({
        type: "filesystem_read",
        value: localPath,
        reason: "Local file npm dependencies must be inside an approved read root."
      });
    }
  }
  if (installableDependencies.some((dependency) => dependency.source === "npm")) {
    requirements.push({ type: "command", value: "npm", reason: "npm is required to prepare generated tool dependencies." });
  }
  for (const dependency of installableDependencies.filter((dependency) => dependency.source === "npm" && !isLocalNpmDependency(dependency.version))) {
    requirements.push({
      type: "package_install",
      value: npmPackageRequirementValue(dependency.name, dependency.version),
      reason: "External npm package installation requires an exact package allowlist grant."
    });
  }
  if (installableDependencies.some((dependency) => dependency.source === "pip")) {
    requirements.push({ type: "command", value: "python", reason: "python/pip is required to prepare generated tool dependencies." });
  }
  return uniqueRequirements(requirements);
}

export function prepareDependencyWorkspace(input: {
  workspace: string;
  manifest?: AutonomyGeneratedToolManifest;
  pdfRenderer: string;
  policyReview?: Record<string, unknown>;
}): Record<string, unknown> {
  const manifest = input.manifest;
  const dependencies = manifest?.dependencies ?? [];
  const warnings: string[] = [];
  const prepared: Array<Record<string, unknown>> = [];
  const lockfiles: Array<Record<string, unknown>> = [];
  const installedPackages: Array<Record<string, unknown>> = [];
  const npmDependencies = dependencies.filter((dependency) => dependency.source === "npm" && dependency.installed !== true);
  const pipDependencies = dependencies.filter((dependency) => dependency.source === "pip" && dependency.installed !== true);

  for (const dependency of dependencies) {
    prepared.push({
      name: dependency.name,
      version: dependency.version,
      source: dependency.source,
      declaredInstalled: dependency.installed,
      prepared: dependency.installed === true || dependency.source === "builtin" || dependency.source === "none" || dependency.source === "system",
      note: dependency.source === "system"
        ? systemDependencyNote(dependency.name, input.pdfRenderer)
        : undefined
    });
  }

  if (pipDependencies.length > 0) {
    return {
      ok: false,
      error: "pip_dependency_prepare_not_supported_yet",
      workspace: redactPath(input.workspace),
      dependencies: prepared,
      policyReview: input.policyReview,
      warnings: ["pip_dependency_prepare_blocked_until_virtualenv_policy_exists"]
    };
  }

  if (npmDependencies.length > 0) {
    mkdirSync(input.workspace, { recursive: true });
    const localDependencyPolicy = validateLocalFileNpmDependencies(npmDependencies, input.workspace);
    if (!localDependencyPolicy.ok) {
      return {
        ok: false,
        error: "local_file_dependency_transitive_dependencies_blocked",
        workspace: redactPath(input.workspace),
        dependencies: prepared,
        policyReview: input.policyReview,
        localDependencyPolicy,
        warnings: ["local_file_dependencies_must_not_declare_transitive_dependencies"]
      };
    }
    const packageJsonPath = join(input.workspace, "package.json");
    const packageJson = {
      private: true,
      name: "codex-widget-generated-tool-dependencies",
      version: "0.0.0",
      dependencies: Object.fromEntries(npmDependencies.map((dependency) => [
        dependency.name,
        dependency.version ?? "latest"
      ]))
    };
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    const installArgs = [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      input.workspace
    ];
    const npm = npmSpawnCommand(installArgs);
    const install = spawnSync(npm.command, npm.args, {
      encoding: "utf8",
      env: buildDependencyInstallEnvironment(input.workspace),
      shell: false,
      timeout: 120_000,
      windowsHide: true
    });
    if (install.status !== 0) {
      return {
        ok: false,
        error: "npm_dependency_prepare_failed",
        workspace: redactPath(input.workspace),
        dependencies: prepared,
        policyReview: input.policyReview,
        stderr: String(install.stderr || install.error?.message || "").slice(0, 2000),
        warnings
      };
    }
    for (const dependency of npmDependencies) {
      const packageJsonFile = join(input.workspace, "node_modules", ...dependency.name.split("/"), "package.json");
      if (!existsSync(packageJsonFile)) {
        warnings.push(`npm_dependency_package_json_missing:${dependency.name}`);
        continue;
      }
      const bytes = readFileSync(packageJsonFile);
      let installedVersion: unknown = dependency.version;
      try {
        installedVersion = asRecord(JSON.parse(bytes.toString("utf8"))).version ?? dependency.version;
      } catch {
        warnings.push(`npm_dependency_package_json_parse_failed:${dependency.name}`);
      }
      installedPackages.push({
        name: dependency.name,
        version: installedVersion,
        source: "npm",
        packageJson: {
          path: redactPath(packageJsonFile),
          size: bytes.byteLength,
          sha256: sha256Bytes(bytes)
        }
      });
    }
    for (const lockfile of ["package.json", "package-lock.json"]) {
      const path = join(input.workspace, lockfile);
      if (!existsSync(path)) {
        continue;
      }
      const bytes = readFileSync(path);
      lockfiles.push({
        path: redactPath(path),
        basename: lockfile,
        size: bytes.byteLength,
        sha256: sha256Bytes(bytes)
      });
    }
  }

  if (dependencies.some((dependency) => dependency.name === "pandoc" && dependency.source === "system") && input.pdfRenderer !== "pandoc") {
    warnings.push("pandoc_not_required_builtin_pdf_renderer_selected");
  }

  return {
    ok: true,
    schemaVersion: "toolsmith-dependency-prepare.v1",
    workspace: redactPath(input.workspace),
    packageInstallPerformed: npmDependencies.length > 0,
    dependencies: prepared,
    installedPackages,
    lockfiles,
    policyReview: finalizeDependencyPolicyReview(input.policyReview, {
      lockfiles,
      installedPackages
    }),
    warnings
  };
}

export function buildDependencyPolicyReview(
  manifest: AutonomyGeneratedToolManifest | undefined,
  workspace: string
): Record<string, unknown> {
  const dependencies = manifest?.dependencies ?? [];
  const dependencyReviews = dependencies.map((dependency) => {
    const installable = (dependency.source === "npm" || dependency.source === "pip") && dependency.installed !== true;
    const localFilePackage = dependency.source === "npm" && installable && isLocalNpmDependency(dependency.version);
    const externalRegistryPackage = dependency.source === "npm" && installable && !localFilePackage;
    const unsupportedPipPackage = dependency.source === "pip" && installable;
    return {
      name: dependency.name,
      source: dependency.source,
      version: redactPathLikeString(dependency.version ?? ""),
      installable,
      localFilePackage,
      externalRegistryPackage,
      unsupportedPipPackage,
      packageRequirement: externalRegistryPackage
        ? npmPackageRequirementValue(dependency.name, dependency.version)
        : localFilePackage
          ? "file:*"
          : undefined,
      policy: unsupportedPipPackage
        ? "blocked_until_virtualenv_policy_exists"
        : externalRegistryPackage
          ? "exact_package_allowlist_required"
          : localFilePackage
            ? "local_file_package_allowed_by_default_policy"
            : "no_install_required"
    };
  });
  const installableNpmCount = dependencyReviews.filter((dependency) => dependency.source === "npm" && dependency.installable === true).length;
  const externalRegistryPackageCount = dependencyReviews.filter((dependency) => dependency.externalRegistryPackage === true).length;
  const localFilePackageCount = dependencyReviews.filter((dependency) => dependency.localFilePackage === true).length;
  const unsupportedPipPackageCount = dependencyReviews.filter((dependency) => dependency.unsupportedPipPackage === true).length;
  return {
    schemaVersion: "toolsmith-dependency-policy-review.v1",
    workspace: redactPath(workspace),
    installIsolation: {
      prefix: redactPath(workspace),
      ignoreScripts: true,
      noAudit: true,
      noFund: true,
      shell: false,
      timeoutMs: 120_000
    },
    dependencies: dependencyReviews,
    packageAllowlistPolicy: {
      defaultLocalFilePattern: "file:*",
      externalRequirementFormat: "npm:name@version",
      exactExternalAllowlistRequired: true
    },
    externalRegistryPackageCount,
    localFilePackageCount,
    unsupportedPipPackageCount,
    lockfileRequired: installableNpmCount > 0,
    installedPackageProvenanceRequired: installableNpmCount > 0,
    promotionBoundary: externalRegistryPackageCount > 0
      ? "external_registry_package_requires_reviewed_allowlist_and_lockfile_policy"
      : "local_file_dependency_fixture_only"
  };
}

function finalizeDependencyPolicyReview(
  policyReview: Record<string, unknown> | undefined,
  input: {
    lockfiles: Array<Record<string, unknown>>;
    installedPackages: Array<Record<string, unknown>>;
  }
): Record<string, unknown> | undefined {
  if (!policyReview) {
    return undefined;
  }
  const lockfileProvenancePresent = input.lockfiles.some((lockfile) =>
    lockfile.basename === "package-lock.json" && typeof lockfile.sha256 === "string"
  );
  const installedPackageProvenancePresent = input.installedPackages.every((dependency) =>
    typeof asRecord(dependency.packageJson).sha256 === "string"
  );
  return {
    ...policyReview,
    lockfileProvenancePresent,
    installedPackageProvenancePresent,
    reviewOutcome: lockfileProvenancePresent && installedPackageProvenancePresent
      ? "passed_local_or_allowlisted_dependency_policy"
      : "dependency_policy_provenance_incomplete"
  };
}

function isLocalNpmDependency(version: string | undefined): boolean {
  return typeof version === "string" && version.trim().toLowerCase().startsWith("file:");
}

function validateLocalFileNpmDependencies(
  dependencies: AutonomyGeneratedToolManifest["dependencies"],
  workspace: string
): { ok: boolean; checked: Array<Record<string, unknown>>; blocked: Array<Record<string, unknown>> } {
  const checked: Array<Record<string, unknown>> = [];
  const blocked: Array<Record<string, unknown>> = [];
  for (const dependency of dependencies.filter((item) => item.source === "npm" && isLocalNpmDependency(item.version))) {
    const localPath = localNpmDependencyPath(dependency.version, workspace);
    const packageJsonPath = localPath ? join(localPath, "package.json") : "";
    const review: Record<string, unknown> = {
      name: dependency.name,
      packageJson: packageJsonPath ? redactPath(packageJsonPath) : undefined
    };
    if (!packageJsonPath || !existsSync(packageJsonPath)) {
      blocked.push({ ...review, reason: "local_package_json_missing" });
      continue;
    }
    try {
      const manifest = asRecord(JSON.parse(readFileSync(packageJsonPath, "utf8")));
      const dependencyFields = readDeclaredDependencyFields(manifest);
      checked.push({ ...review, dependencyFields });
      if (dependencyFields.length > 0) {
        blocked.push({
          ...review,
          reason: "local_file_package_declares_transitive_dependencies",
          dependencyFields
        });
      }
    } catch {
      blocked.push({ ...review, reason: "local_package_json_parse_failed" });
    }
  }
  return {
    ok: blocked.length === 0,
    checked,
    blocked
  };
}

function readDeclaredDependencyFields(manifest: Record<string, unknown>): Array<Record<string, unknown>> {
  const fields = ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies", "devDependencies"];
  const output: Array<Record<string, unknown>> = [];
  for (const field of fields) {
    const value = manifest[field];
    if (Array.isArray(value) && value.length > 0) {
      output.push({ field, count: value.length });
    } else if (value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0) {
      output.push({ field, count: Object.keys(value as Record<string, unknown>).length });
    }
  }
  return output;
}

export function localNpmDependencyPath(version: string | undefined, workspace: string): string | undefined {
  if (!isLocalNpmDependency(version)) {
    return undefined;
  }
  const specifier = version?.trim().slice("file:".length) ?? "";
  if (!specifier) {
    return undefined;
  }
  if (specifier.startsWith("//")) {
    try {
      return resolve(fileURLToPath(`file:${specifier}`));
    } catch {
      return undefined;
    }
  }
  return resolve(isAbsolute(specifier) ? specifier : join(workspace, specifier));
}

function npmPackageRequirementValue(name: string, version: string | undefined): string {
  const normalizedVersion = version?.trim() || "latest";
  return `npm:${name}@${normalizedVersion}`;
}

function systemDependencyNote(name: string, pdfRenderer: string): string {
  if (name === "pandoc") {
    return pdfRenderer === "pandoc"
      ? "pandoc may be used when command grants and local installation allow it"
      : "builtin PDF renderer selected; pandoc remains optional";
  }
  return "system dependency is not installed by Toolsmith";
}

function npmSpawnCommand(args: string[]): { command: string; args: string[] } {
  return process.platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd", ...args] }
    : { command: "npm", args };
}

function buildDependencyInstallEnvironment(workspace: string): NodeJS.ProcessEnv {
  const cache = join(workspace, ".npm-cache");
  const userConfig = join(workspace, ".npmrc");
  const globalConfig = join(workspace, ".npm-globalrc");
  mkdirSync(cache, { recursive: true });
  writeFileSync(userConfig, "ignore-scripts=true\naudit=false\nfund=false\n", "utf8");
  writeFileSync(globalConfig, "ignore-scripts=true\naudit=false\nfund=false\n", "utf8");
  const env: NodeJS.ProcessEnv = {
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: cache,
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    NO_UPDATE_NOTIFIER: "1"
  };
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec"]) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  return env;
}
