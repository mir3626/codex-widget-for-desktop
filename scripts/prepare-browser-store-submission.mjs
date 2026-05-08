#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const extensionDir = join(root, "providers", "browser-dom-extension");
const nativeHostDir = join(root, "providers", "browser-native-host");
const outputRoot = join(root, "dist", "browser-store-submission");
const outputDir = join(outputRoot, `codex-widget-dom-extension-${version}`);
const extensionZip = join(root, "dist", "providers", `codex-widget-dom-extension-${version}.zip`);

const packageRun = spawnSync(process.execPath, ["scripts/package-browser-extension.mjs"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true
});
if (packageRun.status !== 0) {
  throw new Error([packageRun.stdout, packageRun.stderr].filter(Boolean).join("\n"));
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(join(outputDir, "icons"), { recursive: true });

const files = [
  {
    source: extensionZip,
    target: join(outputDir, `codex-widget-dom-extension-${version}.zip`),
    label: "extension package"
  },
  {
    source: join(extensionDir, "store-listing.md"),
    target: join(outputDir, "store-listing.md"),
    label: "store listing"
  },
  {
    source: join(extensionDir, "privacy.md"),
    target: join(outputDir, "privacy.md"),
    label: "privacy disclosure"
  },
  {
    source: join(extensionDir, "review-notes.md"),
    target: join(outputDir, "review-notes.md"),
    label: "review notes"
  },
  {
    source: join(extensionDir, "manifest.json"),
    target: join(outputDir, "manifest.json"),
    label: "manifest"
  },
  {
    source: join(nativeHostDir, "README.md"),
    target: join(outputDir, "native-host-notes.md"),
    label: "native host notes"
  },
  ...["icon-16.png", "icon-48.png", "icon-128.png"].map((name) => ({
    source: join(extensionDir, "icons", name),
    target: join(outputDir, "icons", name),
    label: name
  }))
];

for (const file of files) {
  await mkdir(dirname(file.target), { recursive: true });
  await copyFile(file.source, file.target);
}

const manifestFiles = [];
for (const file of files) {
  const metadata = await stat(file.target);
  const data = await readFile(file.target);
  manifestFiles.push({
    label: file.label,
    path: file.target.slice(outputDir.length + 1).replace(/\\/g, "/"),
    bytes: metadata.size,
    sha256: createHash("sha256").update(data).digest("hex")
  });
}

const submissionManifest = {
  generatedAt: new Date().toISOString(),
  version,
  packageName: `codex-widget-dom-extension-${version}.zip`,
  destination: outputDir,
  files: manifestFiles,
  manualSubmissionChecklist: [
    "Upload the extension zip to the Chrome Web Store or Microsoft Edge Add-ons dashboard.",
    "Paste the store listing, privacy disclosure, and review notes from this packet.",
    "Attach icon assets from the icons directory where the store dashboard asks for listing media.",
    "Confirm the extension opens a Browser Bridge popup, requests site permission explicitly, and only sends approved page context to localhost or the installed native messaging host.",
    "Set CODEX_WIDGET_BROWSER_STORE_SUBMITTED=1 only after the store dashboard submission has been completed."
  ]
};

await writeFile(join(outputDir, "submission-manifest.json"), `${JSON.stringify(submissionManifest, null, 2)}\n`);
await writeFile(
  join(outputDir, "README.md"),
  [
    "# Codex Widget Browser Bridge Store Submission",
    "",
    `Version: ${version}`,
    "",
    "This packet contains the packaged extension, listing copy, privacy disclosure, review notes, native host notes, icons, and checksums.",
    "",
    "## Submission Checklist",
    "",
    ...submissionManifest.manualSubmissionChecklist.map((item) => `- ${item}`),
    "",
    "## Files",
    "",
    ...manifestFiles.map((file) => `- \`${file.path}\` (${file.bytes} bytes, sha256 \`${file.sha256}\`)`),
    ""
  ].join("\n")
);

console.log(`browser store submission packet ok: ${outputDir} files=${manifestFiles.length}`);
