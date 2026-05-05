#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const checks = [];
const blockers = [];

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
  }
];

for (const artifact of artifacts) {
  assertFileCheck(artifact.id, artifact.path);
}

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
const summary = {
  generatedAt: new Date().toISOString(),
  version,
  strictManualGates,
  minSoakMs,
  multiHourSoakMs,
  checks,
  blockers,
  status: automatedFailed ? "fail" : manualBlocked ? "manual-blocked" : "pass"
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
      detail: [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    });
    return;
  }

  checks.push({
    id,
    status: "pass",
    detail: result.stdout.trim().split(/\r?\n/).at(-1) ?? ""
  });
}

function assertFileCheck(id, path) {
  if (!existsSync(path)) {
    checks.push({ id, status: "fail", detail: `missing ${path}` });
    return;
  }

  const size = statSync(path).size;
  checks.push({
    id,
    status: size > 0 ? "pass" : "fail",
    detail: `${path} (${formatBytes(size)})`
  });
}

function readJsonReport(path, id) {
  if (!existsSync(path)) {
    checks.push({ id, status: "fail", detail: `missing ${path}` });
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
      ? `${path} duration=${Math.round(durationMs / 1000)}s samples=${runtimeSamples} pongs=${pongCount} workingSet=${endWorkingSetMb}MB`
      : failures.join("; ")
  });
}

function manualGate(id, passed, reason) {
  if (passed) {
    checks.push({ id, status: "pass", detail: "confirmed" });
    return;
  }

  blockers.push({ id, reason });
  checks.push({ id, status: strictManualGates ? "fail" : "manual", detail: reason });
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
        ? `${path} store=${report.store} submittedAt=${report.submittedAt}`
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
