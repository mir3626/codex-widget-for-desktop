#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const extensionDir = path.resolve("providers/browser-dom-extension");
const manifestPath = path.join(extensionDir, "manifest.json");
const listingPath = path.join(extensionDir, "store-listing.md");
const privacyPath = path.join(extensionDir, "privacy.md");
const reviewNotesPath = path.join(extensionDir, "review-notes.md");
const packagePath = path.resolve("dist/providers/codex-widget-dom-extension-0.1.0.zip");
const submissionManifestPath = path.resolve("dist/browser-store-submission/codex-widget-dom-extension-0.1.0/submission-manifest.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const listing = await readFile(listingPath, "utf8");
const privacy = await readFile(privacyPath, "utf8");
const reviewNotes = await readFile(reviewNotesPath, "utf8");

const packageRun = spawnSync(process.execPath, ["scripts/package-browser-extension.mjs"], {
  encoding: "utf8"
});
if (packageRun.status !== 0) {
  throw new Error([packageRun.stdout, packageRun.stderr].filter(Boolean).join("\n"));
}
const packetRun = spawnSync(process.execPath, ["scripts/prepare-browser-store-submission.mjs"], {
  encoding: "utf8"
});
if (packetRun.status !== 0) {
  throw new Error([packetRun.stdout, packetRun.stderr].filter(Boolean).join("\n"));
}

assertText(manifest.name, 45, "manifest.name");
assertText(manifest.description, 132, "manifest.description");
for (const iconSize of ["16", "48", "128"]) {
  assertFile(path.join(extensionDir, manifest.icons?.[iconSize] ?? ""), `manifest icon ${iconSize}`);
}

for (const permission of ["activeTab", "alarms", "bookmarks", "contentSettings", "scripting", "storage", "tabs", "nativeMessaging"]) {
  assertIncludes(manifest.permissions, permission, "manifest.permissions");
  assertIncludesText(listing, `\`${permission}\``, `store listing permission rationale for ${permission}`);
  assertIncludesText(reviewNotes, `\`${permission}\``, `review notes permission rationale for ${permission}`);
}

for (const hostPermission of ["http://127.0.0.1/*", "http://localhost/*"]) {
  assertIncludes(manifest.host_permissions, hostPermission, "manifest.host_permissions");
  assertIncludesText(listing, hostPermission, `store listing host permission ${hostPermission}`);
}

for (const marker of [
  "browser bridge",
  "does not observe or act on sites until permission is granted",
  "does not sell",
  "does not load remote code",
  "native messaging host"
]) {
  assertIncludesText(`${listing}\n${privacy}\n${reviewNotes}`.toLowerCase(), marker, `store metadata marker ${marker}`);
}

assertFile(packagePath, "packaged extension zip");
assertFile(submissionManifestPath, "browser store submission manifest");

console.log("browser store readiness smoke ok");

function assertText(value, maxLength, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be non-empty.`);
  }
  if (value.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters.`);
  }
}

function assertFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  if (statSync(filePath).size <= 0) {
    throw new Error(`${label} is empty: ${filePath}`);
  }
}

function assertIncludes(values, expected, label) {
  if (!Array.isArray(values) || !values.includes(expected)) {
    throw new Error(`${label} must include ${JSON.stringify(expected)}`);
  }
}

function assertIncludesText(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`${label} is missing ${JSON.stringify(expected)}`);
  }
}
