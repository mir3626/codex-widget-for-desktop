#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-ocr-runtime-"));
const sourceDir = join(tempRoot, "source-ocr-runtime");
const outDir = join(tempRoot, "ocr-runtime");
const knownRoot = join(tempRoot, "program-files");
const knownSourceDir = join(knownRoot, "Tesseract-OCR");
const knownOutDir = join(tempRoot, "known-ocr-runtime", "ocr-runtime");
const tessdataDir = join(sourceDir, "tessdata");
const knownTessdataDir = join(knownSourceDir, "tessdata");

try {
  mkdirp(tessdataDir);
  mkdirp(knownTessdataDir);
  writeFileSync(join(sourceDir, "tesseract.exe"), "mock tesseract binary");
  writeFileSync(join(tessdataDir, "eng.traineddata"), "mock trained data");
  writeFileSync(join(tessdataDir, "kor.traineddata"), "mock trained data");
  writeFileSync(join(knownSourceDir, "tesseract.exe"), "mock known tesseract binary");
  writeFileSync(join(knownTessdataDir, "eng.traineddata"), "mock known trained data");
  writeFileSync(join(knownTessdataDir, "kor.traineddata"), "mock known trained data");
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
  if (
    manifest.available !== true ||
    manifest.executable !== "tesseract.exe" ||
    manifest.tessdata !== "tessdata" ||
    !Array.isArray(manifest.languages) ||
    manifest.languages.join(",") !== "eng,kor"
  ) {
    throw new Error(`Unexpected OCR runtime manifest: ${JSON.stringify(manifest)}`);
  }

  if (process.platform === "win32") {
    const knownResult = spawnSync(process.execPath, ["scripts/prepare-ocr-runtime.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_WIDGET_OCR_RUNTIME_DIR: "",
        CODEX_WIDGET_TESSERACT_EXE: "",
        CODEX_WIDGET_OCR_RUNTIME_OUT_DIR: knownOutDir,
        CODEX_WIDGET_TESSERACT_SEARCH_ROOTS: knownRoot,
        PATH: join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
        "ProgramFiles(x86)": "",
        LOCALAPPDATA: "",
        ChocolateyInstall: "",
        SCOOP: ""
      },
      encoding: "utf8",
      windowsHide: true
    });

    if (knownResult.status !== 0) {
      throw new Error([knownResult.stdout, knownResult.stderr].filter(Boolean).join("\n"));
    }

    const knownManifest = JSON.parse(readFileSync(join(knownOutDir, "ocr-runtime.json"), "utf8"));
    if (
      knownManifest.available !== true ||
      knownManifest.executable !== "tesseract.exe" ||
      knownManifest.tessdata !== "tessdata" ||
      knownManifest.languages?.join(",") !== "eng,kor" ||
      knownManifest.source !== "known:CODEX_WIDGET_TESSERACT_SEARCH_ROOTS/Tesseract-OCR"
    ) {
      throw new Error(`Unexpected known OCR runtime manifest: ${JSON.stringify(knownManifest)}`);
    }
  }

  process.env.CODEX_WIDGET_SCREEN_OCR_RUNTIME_DIR = outDir;
  const { resolveBundledOcrCommand } = await import("../dist/daemon/providers/screenCaptureProvider.js");
  const command = resolveBundledOcrCommand();
  if (!command?.includes("tesseract.exe") || !command.includes("--tessdata-dir") || !command.includes("-l \"eng+kor\"")) {
    throw new Error(`Bundled OCR command was not resolved from the prepared runtime: ${command}`);
  }

  console.log(`ocr runtime smoke ok: ${manifest.executable} with ${manifest.tessdata}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}
