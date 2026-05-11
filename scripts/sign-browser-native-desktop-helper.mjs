#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const helperPath = path.resolve("dist/browser-native-desktop-helper/browser-native-desktop-helper.exe");
const signingRequested = process.env.CODEX_WIDGET_SIGN_HELPERS === "1";
const requireSigned = process.env.CODEX_WIDGET_REQUIRE_SIGNED_HELPERS === "1";
const thumbprint = process.env.CODEX_WIDGET_SIGN_CERT_THUMBPRINT?.trim();
const certPath = process.env.CODEX_WIDGET_SIGN_CERT_PATH?.trim();
const certPassword = process.env.CODEX_WIDGET_SIGN_CERT_PASSWORD ?? "";
const timestampUrl = process.env.CODEX_WIDGET_SIGN_TIMESTAMP_URL?.trim() || "http://timestamp.digicert.com";

if (process.platform !== "win32") {
  console.log("browser native desktop helper signing skipped: Windows-only helper");
  process.exit(0);
}

if (!existsSync(helperPath)) {
  throw new Error(`Missing built native desktop helper. Run npm run build:browser-native-desktop-helper first: ${helperPath}`);
}

if (!signingRequested) {
  console.log("browser native desktop helper signing skipped: set CODEX_WIDGET_SIGN_HELPERS=1 to sign");
  process.exit(0);
}

if (!thumbprint && !certPath) {
  const message = "browser native desktop helper signing requested, but no certificate was configured";
  if (requireSigned) {
    throw new Error(`${message}. Set CODEX_WIDGET_SIGN_CERT_THUMBPRINT or CODEX_WIDGET_SIGN_CERT_PATH.`);
  }
  console.log(`${message}; signing skipped`);
  process.exit(0);
}

const signtool = resolveSigntool();
if (!signtool) {
  throw new Error("signtool.exe was not found. Install the Windows SDK or set CODEX_WIDGET_SIGNTOOL_PATH.");
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
  throw new Error(`signtool failed with ${result.signal ?? result.status}`);
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
