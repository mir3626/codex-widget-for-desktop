#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeBrowserNativeDesktopHelperContract } from "./lib/browser-native-desktop-helper-contract.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const strictManualGates = process.argv.includes("--require-manual-gates") || process.env.CODEX_WIDGET_RELEASE_REQUIRE_MANUAL_GATES === "1";
const minSoakMs = normalizePositiveNumber(process.env.CODEX_WIDGET_RELEASE_READINESS_MIN_SOAK_MS, 60_000);
const multiHourSoakMs = normalizePositiveNumber(process.env.CODEX_WIDGET_RELEASE_MULTI_HOUR_SOAK_MS, 2 * 60 * 60 * 1000);
const reportPath = resolve(
  process.env.CODEX_WIDGET_RELEASE_SOAK_REPORT?.trim() || join(root, "dist", "reports", "release-soak-latest.json")
);
const outputPath = resolve(
  process.env.CODEX_WIDGET_RELEASE_READINESS_REPORT?.trim() || join(root, "dist", "reports", "release-readiness-latest.json")
);
const browserStoreSubmissionReportPath = resolve(
  process.env.CODEX_WIDGET_BROWSER_STORE_SUBMISSION_REPORT?.trim() || join(root, "dist", "reports", "browser-store-submission-confirmation.json")
);
const deferredGatesPath = resolve(
  process.env.CODEX_WIDGET_RELEASE_DEFERRED_GATES?.trim() || join(root, "docs", "release", "deferred-gates.json")
);

const checks = [];
const blockers = [];
const deferredGates = readDeferredGates(deferredGatesPath);
const nativeHelperPath = join(root, "dist", "browser-native-desktop-helper", "browser-native-desktop-helper.exe");

runCheck("browser-store-readiness", process.execPath, ["scripts/smoke-browser-store-readiness.mjs"]);
runCheck("browser-store-submission-packet", process.execPath, ["scripts/prepare-browser-store-submission.mjs"]);
runCheck("release-resources", process.execPath, ["scripts/smoke-release-resources.mjs"]);

const artifacts = [
  {
    id: "release-exe",
    path: join(root, "src-tauri", "target", "release", "codex-widget-for-desktop.exe")
  },
  {
    id: "release-msi",
    path: join(root, "src-tauri", "target", "release", "bundle", "msi", `Codex Widget_${version}_x64_en-US.msi`)
  },
  {
    id: "release-nsis",
    path: join(root, "src-tauri", "target", "release", "bundle", "nsis", `Codex Widget_${version}_x64-setup.exe`)
  },
  {
    id: "browser-extension-zip",
    path: join(root, "dist", "providers", `codex-widget-dom-extension-${version}.zip`)
  },
  {
    id: "browser-native-desktop-helper",
    path: nativeHelperPath
  }
];

for (const artifact of artifacts) {
  assertFileCheck(artifact.id, artifact.path);
}

const nativeHelperContract = probeBrowserNativeDesktopHelperContract({ helperPath: nativeHelperPath });
recordNativeHelperContractCheck(nativeHelperContract);

const nativeHelperSigning = readNativeHelperSigningGate(nativeHelperPath);
manualGate(
  "browser-native-helper-signing",
  nativeHelperSigning.valid,
  nativeHelperSigning.reason
);

const soakReport = readJsonReport(reportPath, "release-soak-report");
if (soakReport) {
  assertSoakReport(soakReport, reportPath);
}

const browserStoreSubmission = readBrowserStoreSubmissionConfirmation(browserStoreSubmissionReportPath);
manualGate(
  "browser-store-submission",
  process.env.CODEX_WIDGET_BROWSER_STORE_SUBMITTED === "1" || browserStoreSubmission.confirmed,
  browserStoreSubmission.reason || "Browser store account submission has not been confirmed."
);
manualGate(
  "multi-hour-soak",
  process.env.CODEX_WIDGET_RELEASE_MULTI_HOUR_SOAK_ACCEPTED === "1" || Number(soakReport?.durationMs ?? 0) >= multiHourSoakMs,
  `A true multi-hour soak has not been confirmed. Required duration is ${Math.round(multiHourSoakMs / 60 / 1000)} minutes.`
);

const automatedFailed = checks.some((check) => check.status === "fail");
const manualBlocked = blockers.length > 0;
const deferred = checks.some((check) => check.status === "deferred");
const summary = {
  generatedAt: new Date().toISOString(),
  version,
  strictManualGates,
  minSoakMs,
  multiHourSoakMs,
  deferredGatesPath: displayPath(deferredGatesPath),
  pathsRedacted: true,
  nativeHelperContract,
  checks,
  blockers,
  status: automatedFailed ? "fail" : manualBlocked ? "manual-blocked" : deferred ? "deferred" : "pass"
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);

for (const check of checks) {
  console.log(`[release:readiness] ${check.status} ${check.id}${check.detail ? ` - ${check.detail}` : ""}`);
}
if (blockers.length > 0) {
  for (const blocker of blockers) {
    console.log(`[release:readiness] manual-blocker ${blocker.id} - ${blocker.reason}`);
  }
}
console.log(`[release:readiness] report ${outputPath}`);

if (automatedFailed || (strictManualGates && manualBlocked)) {
  if (strictManualGates && manualBlocked) {
    throw new Error(`Release readiness blocked: ${blockers.map((blocker) => blocker.id).join(", ") || "automated check failed"}`);
  }
  throw new Error("Release readiness automated checks failed.");
}

console.log(`[release:readiness] ${summary.status}`);

function runCheck(id, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    checks.push({
      id,
      status: "fail",
      detail: sanitizeDetail([result.stdout, result.stderr].filter(Boolean).join("\n").trim())
    });
    return;
  }

  checks.push({
    id,
    status: "pass",
    detail: sanitizeDetail(result.stdout.trim().split(/\r?\n/).at(-1) ?? "")
  });
}

function assertFileCheck(id, path) {
  if (!existsSync(path)) {
    checks.push({ id, status: "fail", detail: `missing ${displayPath(path)}` });
    return;
  }

  const size = statSync(path).size;
  checks.push({
    id,
    status: size > 0 ? "pass" : "fail",
    detail: `${displayPath(path)} (${formatBytes(size)})`
  });
}

function recordNativeHelperContractCheck(contract) {
  const status = contract.status === "pass" ? "pass" : "fail";
  const manifest = contract.evidence?.statusManifest;
  const watch = contract.evidence?.watchPreflight;
  const monitor = contract.evidence?.monitoredWatchPreflight;
  const executor = contract.evidence?.foregroundWatchExecutor;
  const disabledHelperV2Commands = Array.isArray(contract.evidence?.disabledHelperV2Commands)
    ? contract.evidence.disabledHelperV2Commands.length
    : 0;
  const detail = status === "pass"
    ? [
        `helper=${contract.helper?.basename ?? "unknown"}`,
        `manifest=${manifest?.schemaVersion ?? "missing"}`,
        `watch=${watch?.schemaVersion ?? "missing"}`,
        `monitorSamples=${monitor?.monitorSampleCount ?? 0}`,
        `executorEnabled=${executor?.enabled === true ? "true" : "false"}`,
        `disabledV2Commands=${disabledHelperV2Commands}`
      ].join(" ")
    : `blockers=${(contract.blockers ?? []).join(",") || "unknown"}`;
  checks.push({
    id: "browser-native-helper-contract",
    status,
    detail
  });
}

function readJsonReport(path, id) {
  if (!existsSync(path)) {
    checks.push({ id, status: "fail", detail: `missing ${displayPath(path)}` });
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    checks.push({ id, status: "fail", detail: error instanceof Error ? error.message : "invalid JSON" });
    return null;
  }
}

function assertSoakReport(report, path) {
  const durationMs = Number(report.durationMs ?? 0);
  const runtimeSamples = Number(report.health?.runtimeSamples ?? 0);
  const pongCount = Number(report.health?.pongCount ?? 0);
  const activeRequests = Number(report.health?.activeRequests ?? Number.NaN);
  const hasRootProcess = report.health?.hasRootProcess === true;
  const hasDaemonProcess = report.health?.hasDaemonProcess === true;
  const endWorkingSetMb = Number(report.memory?.endWorkingSetMb ?? Number.NaN);
  const maxWorkingSetMb = Number(report.thresholds?.maxWorkingSetMb ?? Number.NaN);
  const growthMb = Number(report.memory?.growthMb ?? Number.NaN);
  const maxGrowthMb = Number(report.thresholds?.maxGrowthMb ?? Number.NaN);

  const failures = [];
  if (durationMs < minSoakMs) {
    failures.push(`duration ${durationMs}ms < ${minSoakMs}ms`);
  }
  if (runtimeSamples < Math.max(3, Math.floor(durationMs / 7000))) {
    failures.push(`runtimeSamples ${runtimeSamples} too low`);
  }
  if (pongCount < Math.max(3, Math.floor(durationMs / 4000))) {
    failures.push(`pongCount ${pongCount} too low`);
  }
  if (activeRequests !== 0) {
    failures.push(`activeRequests ${activeRequests}`);
  }
  if (!hasRootProcess) {
    failures.push("missing root process");
  }
  if (!hasDaemonProcess) {
    failures.push("missing daemon process");
  }
  if (Number.isFinite(maxWorkingSetMb) && endWorkingSetMb > maxWorkingSetMb) {
    failures.push(`working set ${endWorkingSetMb}MB > ${maxWorkingSetMb}MB`);
  }
  if (Number.isFinite(maxGrowthMb) && growthMb > maxGrowthMb) {
    failures.push(`growth ${growthMb}MB > ${maxGrowthMb}MB`);
  }

  checks.push({
    id: "release-soak-report",
    status: failures.length === 0 ? "pass" : "fail",
    detail: failures.length === 0
      ? `${displayPath(path)} duration=${Math.round(durationMs / 1000)}s samples=${runtimeSamples} pongs=${pongCount} workingSet=${endWorkingSetMb}MB`
      : failures.join("; ")
  });
}

function manualGate(id, passed, reason) {
  if (passed) {
    checks.push({ id, status: "pass", detail: "confirmed" });
    return;
  }

  const deferral = deferredGates.get(id);
  if (deferral) {
    const detail = [
      `deferred: ${deferral.reason || reason}`,
      deferral.resumeRunbook ? `resumeRunbook=${deferral.resumeRunbook}` : "",
      deferral.deferredAt ? `deferredAt=${deferral.deferredAt}` : ""
    ].filter(Boolean).join("; ");

    checks.push({ id, status: strictManualGates ? "fail" : "deferred", detail });
    if (strictManualGates) {
      blockers.push({ id, reason: `Deferred gate still required in strict mode. ${detail}` });
    }
    return;
  }

  blockers.push({ id, reason });
  checks.push({ id, status: strictManualGates ? "fail" : "manual", detail: reason });
}

function readDeferredGates(path) {
  if (!existsSync(path)) {
    return new Map();
  }

  const failures = [];
  try {
    const document = JSON.parse(readFileSync(path, "utf8"));
    const gates = document?.gates && typeof document.gates === "object" ? document.gates : {};
    const entries = new Map();

    for (const [id, gate] of Object.entries(gates)) {
      if (gate?.status !== "deferred") {
        continue;
      }
      if (typeof gate.reason !== "string" || !gate.reason.trim()) {
        failures.push(`${id}: reason is required`);
        continue;
      }
      if (gate.deferredAt && Number.isNaN(Date.parse(gate.deferredAt))) {
        failures.push(`${id}: deferredAt must be a valid timestamp`);
        continue;
      }
      entries.set(id, {
        reason: gate.reason.trim(),
        deferredAt: String(gate.deferredAt ?? "").trim(),
        resumeRunbook: String(gate.resumeRunbook ?? "").trim()
      });
    }

    if (failures.length > 0) {
      checks.push({
        id: "deferred-gates",
        status: "fail",
        detail: failures.join("; ")
      });
      return new Map();
    }

    checks.push({
      id: "deferred-gates",
      status: "pass",
      detail: `${displayPath(path)} gates=${entries.size}`
    });
    return entries;
  } catch (error) {
    checks.push({
      id: "deferred-gates",
      status: "fail",
      detail: error instanceof Error ? error.message : "invalid JSON"
    });
    return new Map();
  }
}

function readBrowserStoreSubmissionConfirmation(path) {
  if (!existsSync(path)) {
    return { confirmed: false, reason: "Browser store account submission has not been confirmed." };
  }

  try {
    const report = JSON.parse(readFileSync(path, "utf8"));
    const failures = [];
    if (report.version !== version) {
      failures.push(`version ${JSON.stringify(report.version)} != ${version}`);
    }
    if (!["chrome-web-store", "edge-add-ons"].includes(report.store)) {
      failures.push("store must be chrome-web-store or edge-add-ons");
    }
    if (Number.isNaN(Date.parse(report.submittedAt))) {
      failures.push("submittedAt must be a valid timestamp");
    }
    if (report.confirmation?.submitted !== true) {
      failures.push("confirmation.submitted must be true");
    }
    if (!String(report.listingUrl ?? "").trim() && !String(report.submissionId ?? "").trim()) {
      failures.push("listingUrl or submissionId is required");
    }
    if (report.packageName !== `codex-widget-dom-extension-${version}.zip`) {
      failures.push("packageName does not match release version");
    }
    if (!/^[a-f0-9]{64}$/i.test(String(report.packageSha256 ?? ""))) {
      failures.push("packageSha256 must be a SHA-256 hex digest");
    }

    checks.push({
      id: "browser-store-submission-report",
      status: failures.length === 0 ? "pass" : "fail",
      detail: failures.length === 0
        ? `${displayPath(path)} store=${report.store} submittedAt=${report.submittedAt}`
        : failures.join("; ")
    });

    return failures.length === 0
      ? { confirmed: true }
      : { confirmed: false, reason: `Browser store submission report is invalid: ${failures.join("; ")}` };
  } catch (error) {
    checks.push({
      id: "browser-store-submission-report",
      status: "fail",
      detail: error instanceof Error ? error.message : "invalid JSON"
    });
    return { confirmed: false, reason: "Browser store submission report is invalid." };
  }
}

function readNativeHelperSigningGate(helperPath) {
  if (process.platform !== "win32") {
    const reason = "Native helper signing must be verified on Windows release infrastructure.";
    checks.push({ id: "browser-native-helper-signature", status: "manual", detail: reason });
    return { valid: false, reason };
  }
  if (!existsSync(helperPath)) {
    const reason = `Native helper is missing: ${displayPath(helperPath)}`;
    checks.push({ id: "browser-native-helper-signature", status: "fail", detail: reason });
    return { valid: false, reason };
  }

  const command = [
    "$ErrorActionPreference = 'Continue'",
    "$sig = Get-AuthenticodeSignature -LiteralPath $env:CODEX_WIDGET_HELPER_PATH",
    "[pscustomobject]@{ Status = [string]$sig.Status; StatusMessage = [string]$sig.StatusMessage; SignerCertificate = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null } } | ConvertTo-Json -Compress"
  ].join("; ");
  const result = runPowerShellSignatureCheck(command, helperPath);
  if (result.status !== 0 || !result.stdout.trim()) {
    const reason = "Native helper signature status is unavailable.";
    checks.push({
      id: "browser-native-helper-signature",
      status: "fail",
      detail: sanitizeDetail([reason, result.stderr].filter(Boolean).join(" "))
    });
    return { valid: false, reason };
  }

  try {
    const signature = JSON.parse(result.stdout.trim());
    const detail = sanitizeDetail(`${signature.Status || "Unavailable"} ${signature.StatusMessage || ""}`.trim());
    const valid = signature.Status === "Valid";
    checks.push({
      id: "browser-native-helper-signature",
      status: valid ? "pass" : "manual",
      detail: valid
        ? `valid ${signature.SignerCertificate || "signature"}`
        : `unsigned or invalid helper: ${detail || "no Authenticode status"}`
    });
    return valid
      ? { valid: true, reason: "Native helper signature is valid." }
      : { valid: false, reason: `Native helper must be Authenticode signed before release readiness can pass. Current status: ${detail || "unavailable"}.` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid signature JSON";
    checks.push({ id: "browser-native-helper-signature", status: "fail", detail: reason });
    return { valid: false, reason };
  }
}

function runPowerShellSignatureCheck(command, helperPath) {
  const env = {
    ...process.env,
    CODEX_WIDGET_HELPER_PATH: helperPath
  };
  const pwsh = spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    env,
    windowsHide: true
  });
  if (!pwsh.error && pwsh.status === 0 && pwsh.stdout.trim()) {
    return pwsh;
  }
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    env,
    windowsHide: true
  });
}

function normalizePositiveNumber(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : fallback;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function displayPath(path) {
  const rel = relative(root, path);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    return rel || ".";
  }
  return sanitizeDetail(path);
}

function sanitizeDetail(value) {
  if (!value) {
    return "";
  }
  const rootBackslash = root;
  const rootSlash = root.replaceAll("\\", "/");
  return String(value)
    .replaceAll(rootBackslash, "<repo>")
    .replaceAll(rootSlash, "<repo>");
}
