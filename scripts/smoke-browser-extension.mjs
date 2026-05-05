import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const extensionDir = path.resolve("providers/browser-dom-extension");
const manifestPath = path.join(extensionDir, "manifest.json");
const serviceWorkerPath = path.join(extensionDir, "service-worker.js");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assertEqual(manifest.manifest_version, 3, "manifest_version");
assertIncludes(manifest.permissions, "activeTab", "permissions");
assertIncludes(manifest.permissions, "scripting", "permissions");
assertIncludes(manifest.host_permissions, "http://127.0.0.1:4128/*", "host_permissions");
assertEqual(manifest.background?.service_worker, "service-worker.js", "background.service_worker");

const check = spawnSync(process.execPath, ["--check", serviceWorkerPath], {
  encoding: "utf8"
});
if (check.status !== 0) {
  throw new Error([check.stdout, check.stderr].filter(Boolean).join("\n"));
}

const serviceWorker = await readFile(serviceWorkerPath, "utf8");
for (const marker of [
  "chrome.action.onClicked",
  "chrome.scripting.executeScript",
  "/providers/dom/snapshot",
  "window.getSelection",
  "document.body"
]) {
  if (!serviceWorker.includes(marker)) {
    throw new Error(`Extension service worker is missing marker: ${marker}`);
  }
}

console.log("browser DOM extension smoke ok");

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(values, expected, label) {
  if (!Array.isArray(values) || !values.includes(expected)) {
    throw new Error(`${label} must include ${JSON.stringify(expected)}`);
  }
}
