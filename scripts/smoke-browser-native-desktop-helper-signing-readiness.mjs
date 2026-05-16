#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { probeBrowserNativeDesktopHelperContract } from "./lib/browser-native-desktop-helper-contract.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const helperPath = join(root, "dist", "browser-native-desktop-helper", "browser-native-desktop-helper.exe");

if (process.platform !== "win32") {
  console.log("browser native desktop helper signing readiness smoke skipped: Windows-only helper");
  process.exit(0);
}

if (!existsSync(helperPath)) {
  throw new Error(`Missing built native desktop helper. Run npm run build:browser-native-desktop-helper first: ${helperPath}`);
}

const contractReport = probeBrowserNativeDesktopHelperContract({ helperPath });
assert.equal(contractReport.status, "pass", `helper contract readiness should pass: ${JSON.stringify(contractReport, null, 2)}`);
const contractReportText = JSON.stringify(contractReport);
assert.equal(contractReportText.includes(root), false, "helper contract report must not contain absolute repository paths");
assert.equal(contractReport.schemaVersion, "browser-native-desktop-helper-contract-readiness.v1");
assert.equal(contractReport.evidence.statusManifest?.schemaVersion, "browser-native-desktop-helper-capability-manifest.v2");
assert.equal(contractReport.evidence.statusManifest?.supportedCommands?.includes("watch_preflight"), true);
assert.equal(contractReport.evidence.statusManifest?.blockedHelperV2Commands?.includes("file_picker_select"), true);
assert.equal(contractReport.evidence.watchPreflight?.schemaVersion, "foreground-watch-preflight.v1");
assert.equal(contractReport.evidence.watchPreflight?.actualInputSent, false);
assert.equal(contractReport.evidence.monitoredWatchPreflight?.continuousMonitoring, true);
assert.equal(contractReport.evidence.monitoredWatchPreflight?.actualInputSent, false);
assert.equal(Number(contractReport.evidence.monitoredWatchPreflight?.monitorSampleCount ?? 0) >= 1, true);
assert.equal(contractReport.evidence.foregroundWatchExecutor?.schemaVersion, "browser-native-desktop-helper-foreground-watch-executor.v1");
assert.equal(contractReport.evidence.foregroundWatchExecutor?.enabled, false);
assert.equal(contractReport.evidence.foregroundWatchExecutor?.actualInputSent, false);
assert.equal(contractReport.evidence.foregroundWatchExecutor?.releaseGate, "browser-native-helper-signing");
const disabledCommands = contractReport.evidence.disabledHelperV2Commands ?? [];
assert.equal(disabledCommands.some((entry) => entry.command === "file_picker_select" && entry.localFilePathDisclosed === false && entry.actualInputSent === false), true);
assert.equal(disabledCommands.some((entry) => entry.command === "browser_permission_popup_click" && entry.nativePopupClick === false && entry.permissionChanged === false), true);
assert.equal(disabledCommands.some((entry) => entry.command === "capture_screenshot" && entry.screenshotCaptured === false), true);
assert.equal(disabledCommands.some((entry) => entry.command === "clipboard_set_scoped" && entry.clipboardContentLogged === false), true);

const tempDir = mkdtempSync(join(tmpdir(), "browser-native-helper-signing-readiness-"));
try {
  const secret = "codex-widget-signing-secret-smoke-value";
  const softReportPath = join(tempDir, "soft-readiness.json");
  const soft = runSigningPreflight({
    CODEX_WIDGET_SIGNING_REPORT: softReportPath,
    CODEX_WIDGET_SIGN_CERT_PASSWORD: secret,
    CODEX_WIDGET_REQUIRE_SIGNED_HELPERS: "0"
  });
  assert.equal(soft.status, 0, `soft signing preflight should not fail in development mode: ${soft.stderr || soft.stdout}`);
  const softReportText = readFileSync(softReportPath, "utf8");
  assert.equal(softReportText.includes(secret), false, "signing report must not contain certificate password");
  assert.equal(softReportText.includes(root), false, "signing report must not contain absolute repository paths");
  const softReport = JSON.parse(softReportText);
  assert.equal(softReport.schemaVersion, "browser-native-desktop-helper-signing.v1");
  assert.equal(softReport.status, "blocked");
  assert.equal(softReport.reason, "certificate_not_configured");
  assert.equal(softReport.signingRequested, true);
  assert.equal(softReport.dryRun, true);
  assert.equal(softReport.signingMethod.type, "none");
  assert.equal(softReport.helper.exists, true);
  assert.match(softReport.helper.sha256, /^[a-f0-9]{64}$/i);
  assert.equal(typeof softReport.signature.status, "string");

  const strictReportPath = join(tempDir, "strict-readiness.json");
  const strict = runSigningPreflight({
    CODEX_WIDGET_SIGNING_REPORT: strictReportPath,
    CODEX_WIDGET_SIGN_CERT_PASSWORD: secret,
    CODEX_WIDGET_REQUIRE_SIGNED_HELPERS: "1"
  });
  assert.notEqual(strict.status, 0, "strict signing preflight must fail when no certificate or signing service is configured");
  const strictReportText = readFileSync(strictReportPath, "utf8");
  assert.equal(strictReportText.includes(secret), false, "strict signing report must not contain certificate password");
  const strictReport = JSON.parse(strictReportText);
  assert.equal(strictReport.status, "blocked");
  assert.equal(strictReport.reason, "certificate_not_configured");

  console.log("browser native desktop helper signing readiness smoke ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function runSigningPreflight(overrides) {
  return spawnSync(process.execPath, ["scripts/sign-browser-native-desktop-helper.mjs"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      CODEX_WIDGET_SIGN_HELPERS: "1",
      CODEX_WIDGET_SIGNING_DRY_RUN: "1",
      CODEX_WIDGET_SIGN_CERT_THUMBPRINT: "",
      CODEX_WIDGET_SIGN_CERT_PATH: "",
      CODEX_WIDGET_SIGNTOOL_PATH: "",
      ...overrides
    }
  });
}
