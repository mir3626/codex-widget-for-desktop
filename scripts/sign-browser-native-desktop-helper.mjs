#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const helperPath = path.resolve("dist/browser-native-desktop-helper/browser-native-desktop-helper.exe");
const signingRequested = process.env.CODEX_WIDGET_SIGN_HELPERS === "1";
const requireSigned = process.env.CODEX_WIDGET_REQUIRE_SIGNED_HELPERS === "1";
const dryRun = process.env.CODEX_WIDGET_SIGNING_DRY_RUN === "1";
const thumbprint = process.env.CODEX_WIDGET_SIGN_CERT_THUMBPRINT?.trim();
const certPath = process.env.CODEX_WIDGET_SIGN_CERT_PATH?.trim();
const certPassword = process.env.CODEX_WIDGET_SIGN_CERT_PASSWORD ?? "";
const timestampUrl = process.env.CODEX_WIDGET_SIGN_TIMESTAMP_URL?.trim() || "http://timestamp.digicert.com";
const reportPath = path.resolve(process.env.CODEX_WIDGET_SIGNING_REPORT?.trim() || "dist/reports/browser-native-desktop-helper-signing-latest.json");

if (process.platform !== "win32") {
  writeSigningReport({
    status: "skipped",
    reason: "windows_only_helper",
    helper: readHelperEvidence(helperPath),
    signature: { checked: false, status: "not_windows" }
  });
  console.log("browser native desktop helper signing skipped: Windows-only helper");
  process.exit(0);
}

if (!existsSync(helperPath)) {
  writeSigningReport({
    status: "failed",
    reason: "helper_missing",
    helper: readHelperEvidence(helperPath),
    signature: { checked: false, status: "unavailable" }
  });
  throw new Error(`Missing built native desktop helper. Run npm run build:browser-native-desktop-helper first: ${helperPath}`);
}

const beforeSignature = readAuthenticodeSignature(helperPath);

if (!signingRequested) {
  writeSigningReport({
    status: "skipped",
    reason: "signing_not_requested",
    helper: readHelperEvidence(helperPath),
    signature: beforeSignature
  });
  console.log("browser native desktop helper signing skipped: set CODEX_WIDGET_SIGN_HELPERS=1 to sign");
  process.exit(0);
}

if (!thumbprint && !certPath) {
  const message = "browser native desktop helper signing requested, but no certificate was configured";
  writeSigningReport({
    status: "blocked",
    reason: "certificate_not_configured",
    helper: readHelperEvidence(helperPath),
    signature: beforeSignature
  });
  if (requireSigned) {
    throw new Error(`${message}. Set CODEX_WIDGET_SIGN_CERT_THUMBPRINT or CODEX_WIDGET_SIGN_CERT_PATH.`);
  }
  console.log(`${message}; signing skipped`);
  process.exit(0);
}

if (certPath && !existsSync(certPath)) {
  writeSigningReport({
    status: "failed",
    reason: "certificate_file_missing",
    helper: readHelperEvidence(helperPath),
    signature: beforeSignature
  });
  throw new Error(`Configured signing certificate file does not exist: ${certPath}`);
}

const signtool = resolveSigntool();
if (!signtool) {
  writeSigningReport({
    status: dryRun ? "blocked" : "failed",
    reason: "signtool_missing",
    helper: readHelperEvidence(helperPath),
    signature: beforeSignature
  });
  if (dryRun && !requireSigned) {
    console.log("browser native desktop helper signing dry-run blocked: signtool.exe was not found");
    process.exit(0);
  }
  throw new Error("signtool.exe was not found. Install the Windows SDK or set CODEX_WIDGET_SIGNTOOL_PATH.");
}

if (dryRun) {
  writeSigningReport({
    status: beforeSignature.status === "Valid" ? "already_signed" : "dry_run",
    reason: beforeSignature.status === "Valid" ? "helper_already_has_valid_signature" : "dry_run_no_signature_mutation",
    helper: readHelperEvidence(helperPath),
    signature: beforeSignature,
    signtool: redactPath(signtool)
  });
  console.log(`browser native desktop helper signing dry-run ok: ${redactSigningMethod()}`);
  process.exit(0);
}

const args = ["sign", "/fd", "SHA256", "/tr", timestampUrl, "/td", "SHA256"];
if (thumbprint) {
  args.push("/sha1", thumbprint);
} else {
  args.push("/f", certPath);
  if (certPassword) {
    args.push("/p", certPassword);
  }
}
args.push(helperPath);

const result = spawnSync(signtool, args, {
  stdio: "inherit",
  windowsHide: true
});

if (result.status !== 0) {
  writeSigningReport({
    status: "failed",
    reason: "signtool_failed",
    helper: readHelperEvidence(helperPath),
    signature: readAuthenticodeSignature(helperPath),
    signtool: redactPath(signtool)
  });
  throw new Error(`signtool failed with ${result.signal ?? result.status}`);
}

const afterSignature = readAuthenticodeSignature(helperPath);
writeSigningReport({
  status: afterSignature.status === "Valid" ? "signed" : "failed",
  reason: afterSignature.status === "Valid" ? "signed_and_verified" : "signature_verification_failed_after_sign",
  helper: readHelperEvidence(helperPath),
  signature: afterSignature,
  signtool: redactPath(signtool)
});

if (afterSignature.status !== "Valid") {
  throw new Error(`signtool completed but helper signature is not valid: ${afterSignature.status} ${afterSignature.statusMessage ?? ""}`.trim());
}

console.log(`browser native desktop helper signed: ${helperPath}`);

function resolveSigntool() {
  const configured = process.env.CODEX_WIDGET_SIGNTOOL_PATH?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  const where = spawnSync("where.exe", ["signtool.exe"], {
    encoding: "utf8",
    windowsHide: true
  });
  const first = where.stdout
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && existsSync(line));
  return first;
}

function readHelperEvidence(filePath) {
  const exists = existsSync(filePath);
  if (!exists) {
    return {
      path: redactPath(filePath),
      exists: false
    };
  }
  const bytes = readFileSync(filePath);
  const stats = statSync(filePath);
  return {
    path: redactPath(filePath),
    exists: true,
    size: stats.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    modifiedAt: stats.mtime.toISOString()
  };
}

function readAuthenticodeSignature(filePath) {
  const command = [
    "$ErrorActionPreference = 'Continue'",
    "$sig = Get-AuthenticodeSignature -LiteralPath $env:CODEX_WIDGET_HELPER_PATH",
    "[pscustomobject]@{ Status = [string]$sig.Status; StatusMessage = [string]$sig.StatusMessage; SignerCertificate = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null } } | ConvertTo-Json -Compress"
  ].join("; ");
  const result = runPowerShell(command, filePath);
  if (result.status !== 0 || !result.stdout.trim()) {
    return {
      checked: false,
      status: "unavailable",
      statusMessage: redactSignatureMessage(result.stderr?.trim(), filePath)
    };
  }
  try {
    const signature = JSON.parse(result.stdout.trim());
    return {
      checked: true,
      status: String(signature.Status ?? ""),
      statusMessage: redactSignatureMessage(signature.StatusMessage ? String(signature.StatusMessage) : undefined, filePath),
      signerCertificate: signature.SignerCertificate ? String(signature.SignerCertificate) : undefined
    };
  } catch (error) {
    return {
      checked: false,
      status: "error",
      statusMessage: error instanceof Error ? error.message : "invalid signature JSON"
    };
  }
}

function runPowerShell(command, filePath) {
  const env = {
    ...process.env,
    CODEX_WIDGET_HELPER_PATH: filePath
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

function writeSigningReport(summary) {
  const report = {
    schemaVersion: "browser-native-desktop-helper-signing.v1",
    generatedAt: new Date().toISOString(),
    helperKind: "browser-native-desktop-helper",
    requireSigned,
    signingRequested,
    dryRun,
    signingMethod: redactSigningMethod(),
    timestampUrlHost: safeUrlHost(timestampUrl),
    ...summary
  };
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function redactSigningMethod() {
  if (thumbprint) {
    return {
      type: "certificate_store_thumbprint",
      thumbprintSuffix: thumbprint.slice(-8)
    };
  }
  if (certPath) {
    return {
      type: "pfx_file",
      certificateFileName: path.basename(certPath),
      passwordProvided: certPassword.length > 0
    };
  }
  return { type: "none" };
}

function redactPath(filePath) {
  return {
    basename: path.basename(filePath),
    extension: path.extname(filePath).toLowerCase()
  };
}

function redactSignatureMessage(message, filePath) {
  if (!message) {
    return undefined;
  }
  return message
    .replaceAll(filePath, "[helper]")
    .replaceAll(path.resolve(filePath), "[helper]");
}

function safeUrlHost(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return "invalid";
  }
}
