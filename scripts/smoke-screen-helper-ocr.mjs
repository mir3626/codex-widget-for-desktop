#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  console.log("screen helper OCR smoke skipped: Windows-only helper");
  process.exit(0);
}

const helperPath = path.resolve("providers/screen-capture-helper/capture-screen.ps1");
const tempDir = path.join(tmpdir(), `codex-widget-ocr-smoke-${process.pid}`);
mkdirSync(tempDir, { recursive: true });
const checkerPath = join(tempDir, "assert-ocr-image.mjs");
writeFileSync(
  checkerPath,
  [
    "const image = process.argv[2] ?? '';",
    "if (!image.toLowerCase().endsWith('.png')) {",
    "  console.error(`expected preprocessed png OCR input, got ${image}`);",
    "  process.exit(7);",
    "}",
    "console.log('codex-widget-ocr-smoke');"
  ].join("\n")
);
const command = `${quoteCmd(process.execPath)} ${quoteCmd(checkerPath)} {image}`;
const run = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helperPath,
    "-DryRun",
    "-OcrCommand",
    command,
    "-MaxWidth",
    "640",
    "-JpegQuality",
    "45"
  ],
  { encoding: "utf8" }
);

rmSync(tempDir, { recursive: true, force: true });

if (run.status !== 0) {
  throw new Error([run.stdout, run.stderr].filter(Boolean).join("\n"));
}

if (!run.stdout.includes("screen snapshot dry run:")) {
  throw new Error(`Unexpected OCR dry-run output: ${run.stdout}`);
}
if (!run.stdout.includes("codex-widget-ocr-smoke".length.toString() + " ocr chars")) {
  throw new Error(`OCR dry run did not include fake OCR output length: ${run.stdout}`);
}

console.log("screen helper OCR smoke ok");

function quoteCmd(value) {
  return `"${value.replace(/"/g, '\\"')}"`;
}
