#!/usr/bin/env node
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeDir = join(root, "dist", "node-runtime");
const runtimeBin = process.platform === "win32" ? "node.exe" : "node";
const sourceBin = process.execPath;
const sourceDir = dirname(sourceBin);
const optionalRuntimeFiles =
  process.platform === "win32"
    ? ["node.dll", "icudtl.dat", "v8_context_snapshot.bin", "snapshot_blob.bin"]
    : ["icudtl.dat", "v8_context_snapshot.bin", "snapshot_blob.bin"];

await mkdir(runtimeDir, { recursive: true });
await copyFile(sourceBin, join(runtimeDir, runtimeBin));

for (const filename of optionalRuntimeFiles) {
  await copyIfExists(join(sourceDir, filename), join(runtimeDir, filename));
}

await writeFile(
  join(runtimeDir, "node-runtime.json"),
  `${JSON.stringify(
    {
      source: sourceBin,
      executable: runtimeBin,
      sourceExecutable: basename(sourceBin),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    },
    null,
    2
  )}\n`
);

console.log(`node runtime prepared at ${join(runtimeDir, runtimeBin)} (${process.version})`);

async function copyIfExists(source, destination) {
  try {
    await stat(source);
  } catch {
    return;
  }
  await copyFile(source, destination);
}
