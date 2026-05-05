#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseRoot = join(root, "src-tauri", "target", "release");
const msiScript = join(releaseRoot, "wix", "x64", "main.wxs");
const nsisScript = join(releaseRoot, "nsis", "x64", "installer.nsi");
const msiArtifact = join(releaseRoot, "bundle", "msi", "Codex Widget_0.1.0_x64_en-US.msi");
const nsisArtifact = join(releaseRoot, "bundle", "nsis", "Codex Widget_0.1.0_x64-setup.exe");
const requiredFragments = [
  "dist\\daemon-bundle\\standalone.js",
  "dist\\node-runtime\\node.exe",
  "dist\\node-runtime\\node-runtime.json",
  "dist\\ocr-runtime\\ocr-runtime.json",
  "providers\\screen-capture-helper\\capture-screen.ps1",
  "providers\\browser-dom-extension\\manifest.json",
  "providers\\browser-native-host\\native-host.mjs",
  "providers\\browser-native-host\\codex-widget-dom-native-host.cmd",
  "providers\\browser-native-host\\install-native-messaging-host.ps1"
];

for (const path of [msiScript, nsisScript, msiArtifact, nsisArtifact]) {
  assertFile(path);
}

const msiText = readFileSync(msiScript, "utf8");
const nsisText = readFileSync(nsisScript, "utf8");
for (const fragment of requiredFragments) {
  assertIncludes(msiText, fragment, msiScript);
  assertIncludes(nsisText, fragment, nsisScript);
}

console.log("release resources smoke ok: bundled daemon, node runtime, OCR runtime manifest, screen helper, DOM extension, and browser native host are in MSI/NSIS scripts");

function assertFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing release artifact: ${path}`);
  }
  const size = statSync(path).size;
  if (size <= 0) {
    throw new Error(`Release artifact is empty: ${path}`);
  }
}

function assertIncludes(text, fragment, path) {
  if (!text.includes(fragment)) {
    throw new Error(`Expected ${path} to include ${fragment}`);
  }
}
