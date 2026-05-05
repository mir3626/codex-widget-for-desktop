#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const args = parseArgs(process.argv.slice(2));
const outputPath = resolve(args.out || process.env.CODEX_WIDGET_BROWSER_STORE_SUBMISSION_REPORT || join(root, "dist", "reports", "browser-store-submission-confirmation.json"));
const packetManifestPath = resolve(
  args.packetManifest || join(root, "dist", "browser-store-submission", `codex-widget-dom-extension-${version}`, "submission-manifest.json")
);

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.template) {
  writeTemplate();
  process.exit(0);
}

const packetManifest = readPacketManifest(packetManifestPath);
const store = normalizeStore(args.store || process.env.CODEX_WIDGET_BROWSER_STORE_NAME);
const submittedAt = normalizeSubmittedAt(args.submittedAt || process.env.CODEX_WIDGET_BROWSER_STORE_SUBMITTED_AT);
const listingUrl = normalizeOptionalString(args.listingUrl || process.env.CODEX_WIDGET_BROWSER_STORE_LISTING_URL);
const submissionId = normalizeOptionalString(args.submissionId || process.env.CODEX_WIDGET_BROWSER_STORE_SUBMISSION_ID);
const dashboardUrl = normalizeOptionalString(args.dashboardUrl || process.env.CODEX_WIDGET_BROWSER_STORE_DASHBOARD_URL);
const notes = normalizeOptionalString(args.notes || process.env.CODEX_WIDGET_BROWSER_STORE_SUBMISSION_NOTES);

if (!store) {
  throw new Error("Missing --store. Use chrome-web-store or edge-add-ons.");
}
if (!listingUrl && !submissionId) {
  throw new Error("Provide at least one of --listing-url or --submission-id.");
}

const extensionPackage = packetManifest.files.find((file) => file.label === "extension package");
if (!extensionPackage) {
  throw new Error(`Submission packet manifest does not include extension package: ${packetManifestPath}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  version,
  store,
  submittedAt,
  listingUrl,
  submissionId,
  dashboardUrl,
  notes,
  packetManifestPath,
  packageName: packetManifest.packageName,
  packageSha256: extensionPackage.sha256,
  confirmation: {
    submitted: true,
    source: "manual store dashboard confirmation"
  }
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`browser store submission confirmation ok: ${outputPath}`);

function writeTemplate() {
  const template = {
    generatedAt: new Date().toISOString(),
    version,
    store: "chrome-web-store",
    submittedAt: new Date().toISOString(),
    listingUrl: "https://chromewebstore.google.com/detail/...",
    submissionId: "replace-with-dashboard-submission-id",
    dashboardUrl: "https://chrome.google.com/webstore/devconsole/...",
    notes: "Replace with dashboard status, reviewer message, or rollout notes.",
    packetManifestPath,
    packageName: `codex-widget-dom-extension-${version}.zip`,
    packageSha256: "replace-with-submission-packet-sha256",
    confirmation: {
      submitted: true,
      source: "manual store dashboard confirmation"
    }
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(template, null, 2)}\n`);
  console.log(`browser store submission confirmation template written: ${outputPath}`);
}

function readPacketManifest(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing submission packet manifest. Run npm run release:browser-store-packet first: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeStore(value) {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (!normalized) {
    return "";
  }
  const aliases = new Map([
    ["chrome", "chrome-web-store"],
    ["chrome-web-store", "chrome-web-store"],
    ["cws", "chrome-web-store"],
    ["edge", "edge-add-ons"],
    ["edge-add-ons", "edge-add-ons"],
    ["microsoft-edge-add-ons", "edge-add-ons"]
  ]);
  const store = aliases.get(normalized);
  if (!store) {
    throw new Error(`Unsupported store ${JSON.stringify(value)}. Use chrome-web-store or edge-add-ons.`);
  }
  return store;
}

function normalizeSubmittedAt(value) {
  const normalized = normalizeOptionalString(value) || new Date().toISOString();
  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid submittedAt timestamp: ${normalized}`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected argument ${value}`);
    }
    const key = value.slice(2);
    if (key === "help" || key === "template") {
      parsed[key] = true;
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[toCamelCase(key)] = next;
    index += 1;
  }
  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function printHelp() {
  console.log(`Usage:
node scripts/confirm-browser-store-submission.mjs --store chrome-web-store --submission-id <id>
node scripts/confirm-browser-store-submission.mjs --store edge-add-ons --listing-url <url>
node scripts/confirm-browser-store-submission.mjs --template

Options:
  --store             chrome-web-store or edge-add-ons
  --submission-id     Store dashboard submission id
  --listing-url       Published listing URL
  --dashboard-url     Store dashboard URL
  --submitted-at      ISO timestamp, defaults to now
  --notes             Optional dashboard/reviewer notes
  --out               Confirmation JSON path
  --packet-manifest   Submission packet manifest path
`);
}
