#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const helperPath = path.resolve("dist/browser-native-desktop-helper/browser-native-desktop-helper.exe");
const requireSigned = process.env.CODEX_WIDGET_REQUIRE_SIGNED_HELPERS === "1";

if (process.platform !== "win32") {
  console.log("browser native desktop helper signature smoke skipped: Windows-only helper");
  process.exit(0);
}

if (!existsSync(helperPath)) {
  throw new Error(`Missing built native desktop helper. Run npm run build:browser-native-desktop-helper first: ${helperPath}`);
}

const command = [
  "$ErrorActionPreference = 'Continue'",
  "$sig = Get-AuthenticodeSignature -LiteralPath $env:CODEX_WIDGET_HELPER_PATH",
  "[pscustomobject]@{ Status = [string]$sig.Status; StatusMessage = [string]$sig.StatusMessage; SignerCertificate = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null } } | ConvertTo-Json -Compress"
].join("; ");
const result = runPowerShell(command);

if (result.status !== 0) {
  const message = "browser native desktop helper signature status unavailable";
  if (requireSigned) {
    throw new Error(`${message}. Provide a working Authenticode verification environment and code-signing certificate.`);
  }
  console.log(`${message} (development allowed; set CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1 to fail)`);
  process.exit(0);
}

const signature = JSON.parse(result.stdout.trim());
if (signature.Status === "Valid") {
  console.log(`browser native desktop helper signature smoke ok: ${signature.SignerCertificate ?? "valid signature"}`);
  process.exit(0);
}

if (!signature.Status) {
  const message = "browser native desktop helper signature status unavailable";
  if (requireSigned) {
    throw new Error(`${message}. Provide a working Authenticode verification environment and code-signing certificate.`);
  }
  console.log(`${message} (development allowed; set CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1 to fail)`);
  process.exit(0);
}

const message = `browser native desktop helper is not signed: ${signature.Status} ${signature.StatusMessage ?? ""}`.trim();
if (requireSigned) {
  throw new Error(`${message}. Provide an Authenticode code-signing certificate or CI signing service.`);
}

console.log(`${message} (development allowed; set CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1 to fail)`);

function runPowerShell(command) {
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
