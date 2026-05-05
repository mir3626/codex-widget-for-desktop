#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-ocr-runtime-"));
const sourceDir = join(tempRoot, "source-ocr-runtime");
const outDir = join(tempRoot, "ocr-runtime");
const tessdataDir = join(sourceDir, "tessdata");

try {
  mkdirp(tessdataDir);
  writeFileSync(join(sourceDir, "tesseract.exe"), "mock tesseract binary");
  writeFileSync(join(tessdataDir, "eng.traineddata"), "mock trained data");
  mkdirp(outDir);
  writeFileSync(join(outDir, "tesseract.exe"), "mock unsafe source");

  const unsafeResult = spawnSync(process.execPath, ["scripts/prepare-ocr-runtime.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WIDGET_OCR_RUNTIME_DIR: outDir,
      CODEX_WIDGET_OCR_RUNTIME_OUT_DIR: outDir
    },
    encoding: "utf8",
    windowsHide: true
  });

  if (unsafeResult.status === 0 || !unsafeResult.stderr.includes("own source")) {
    throw new Error("OCR runtime preparation did not reject identical source and output directories.");
  }

  const result = spawnSync(process.execPath, ["scripts/prepare-ocr-runtime.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WIDGET_OCR_RUNTIME_DIR: sourceDir,
      CODEX_WIDGET_OCR_RUNTIME_OUT_DIR: outDir
    },
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }

  const manifest = JSON.parse(readFileSync(join(outDir, "ocr-runtime.json"), "utf8"));
  if (manifest.available !== true || manifest.executable !== "tesseract.exe" || manifest.tessdata !== "tessdata") {
    throw new Error(`Unexpected OCR runtime manifest: ${JSON.stringify(manifest)}`);
  }

  process.env.CODEX_WIDGET_SCREEN_OCR_RUNTIME_DIR = outDir;
  const { resolveBundledOcrCommand } = await import("../dist/daemon/providers/screenCaptureProvider.js");
  const command = resolveBundledOcrCommand();
  if (!command?.includes("tesseract.exe") || !command.includes("--tessdata-dir")) {
    throw new Error(`Bundled OCR command was not resolved from the prepared runtime: ${command}`);
  }

  console.log(`ocr runtime smoke ok: ${manifest.executable} with ${manifest.tessdata}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}
