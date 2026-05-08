import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const extensionDir = path.resolve("providers/browser-dom-extension");
const manifestPath = path.join(extensionDir, "manifest.json");
const serviceWorkerPath = path.join(extensionDir, "service-worker.js");
const optionsPath = path.join(extensionDir, "options.js");
const popupPath = path.join(extensionDir, "popup.js");
const packagePath = path.resolve("dist/providers/codex-widget-dom-extension-0.1.0.zip");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assertEqual(manifest.manifest_version, 3, "manifest_version");
assertIncludes(manifest.permissions, "activeTab", "permissions");
assertIncludes(manifest.permissions, "alarms", "permissions");
assertIncludes(manifest.permissions, "scripting", "permissions");
assertIncludes(manifest.permissions, "storage", "permissions");
assertIncludes(manifest.permissions, "tabs", "permissions");
assertIncludes(manifest.permissions, "nativeMessaging", "permissions");
assertIncludes(manifest.host_permissions, "http://127.0.0.1/*", "host_permissions");
assertIncludes(manifest.host_permissions, "http://localhost/*", "host_permissions");
assertIncludes(manifest.optional_host_permissions, "http://*/*", "optional_host_permissions");
assertIncludes(manifest.optional_host_permissions, "https://*/*", "optional_host_permissions");
assertEqual(manifest.background?.service_worker, "service-worker.js", "background.service_worker");
assertEqual(manifest.icons?.["16"], "icons/icon-16.png", "icons.16");
assertEqual(manifest.icons?.["48"], "icons/icon-48.png", "icons.48");
assertEqual(manifest.icons?.["128"], "icons/icon-128.png", "icons.128");
assertEqual(manifest.action?.default_icon?.["16"], "icons/icon-16.png", "action.default_icon.16");
assertEqual(manifest.action?.default_popup, "popup.html", "action.default_popup");
assertEqual(manifest.options_ui?.page, "options.html", "options_ui.page");

const check = spawnSync(process.execPath, ["--check", serviceWorkerPath], {
  encoding: "utf8"
});
if (check.status !== 0) {
  throw new Error([check.stdout, check.stderr].filter(Boolean).join("\n"));
}
const optionsCheck = spawnSync(process.execPath, ["--check", optionsPath], {
  encoding: "utf8"
});
if (optionsCheck.status !== 0) {
  throw new Error([optionsCheck.stdout, optionsCheck.stderr].filter(Boolean).join("\n"));
}
const popupCheck = spawnSync(process.execPath, ["--check", popupPath], {
  encoding: "utf8"
});
if (popupCheck.status !== 0) {
  throw new Error([popupCheck.stdout, popupCheck.stderr].filter(Boolean).join("\n"));
}

const serviceWorker = await readFile(serviceWorkerPath, "utf8");
for (const marker of [
  "chrome.alarms.onAlarm",
  "chrome.runtime.onMessage",
  "Codex Widget] Browser Bridge heartbeat",
  "chrome.scripting.executeScript",
  "chrome.storage.sync.get",
  "chrome.runtime.sendNativeMessage",
  "com.mir3626.codex_widget_dom",
  "/providers/dom/snapshot",
  "/browser-action/extension/poll",
  "/browser-action/extension/result",
  "/browser-action/extension/heartbeat",
  "/browser-action/extension/status",
  "requestCurrentSitePermission",
  "autoObserve",
  "needs_site_permission",
  "window.getSelection",
  "document.body",
  "collectInteractiveElements",
  "executeBrowserActionInPage",
  "chrome.tabs.captureVisibleTab",
  "expectedSource",
  "detectSourceMismatch",
  "postBrowserActionResultWithRetry",
  "assertTabCanRunBrowserAction",
  "restricted browser pages",
  "isBrowserActionPollOnlyError"
]) {
  if (!serviceWorker.includes(marker)) {
    throw new Error(`Extension service worker is missing marker: ${marker}`);
  }
}
if (serviceWorker.includes("chrome.action.onClicked")) {
  throw new Error("Extension action click must open popup, not trigger default snapshot capture.");
}

const options = await readFile(optionsPath, "utf8");
if (!options.includes("Saved normalized local daemon base URL") || !options.includes("daemonBaseUrl")) {
  throw new Error("Extension options should accept and store a daemon base URL.");
}

const popup = await readFile(path.join(extensionDir, "popup.html"), "utf8");
if (!popup.includes("Browser Bridge") || popup.includes("Send DOM snapshot")) {
  throw new Error("Extension popup should expose Browser Bridge settings, not default snapshot UX.");
}

const packageRun = spawnSync(process.execPath, ["scripts/package-browser-extension.mjs"], {
  encoding: "utf8"
});
if (packageRun.status !== 0) {
  throw new Error([packageRun.stdout, packageRun.stderr].filter(Boolean).join("\n"));
}

const packageEntries = readZipEntries(await readFile(packagePath));
for (const entry of [
  "manifest.json",
  "service-worker.js",
  "popup.html",
  "popup.js",
  "options.html",
  "options.js",
  "icons/icon-16.png",
  "icons/icon-48.png",
  "icons/icon-128.png"
]) {
  if (!packageEntries.includes(entry)) {
    throw new Error(`Extension package is missing ${entry}: ${packageEntries.join(", ")}`);
  }
}

console.log(`browser bridge extension smoke ok: package entries=${packageEntries.length}`);

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

function readZipEntries(buffer) {
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("Extension package is not a valid zip: EOCD not found.");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Extension package central directory is invalid at entry ${index}.`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    entries.push(buffer.subarray(nameStart, nameStart + nameLength).toString("utf8"));
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}
