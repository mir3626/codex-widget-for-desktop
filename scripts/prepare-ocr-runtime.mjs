#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outdir = resolve(process.env.CODEX_WIDGET_OCR_RUNTIME_OUT_DIR?.trim() || join(root, "dist", "ocr-runtime"));
const source = resolveOcrRuntimeSource();

assertSafeOutputDirectory(outdir);
assertSourceIsNotOutput(source, outdir);
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

if (source) {
  cpSync(source.dir, outdir, { recursive: true });
  const executable = findTesseractExecutable(outdir);
  if (!executable) {
    throw new Error(`OCR runtime source did not contain tesseract.exe: ${source.dir}`);
  }

  const manifest = {
    engine: "tesseract",
    available: true,
    executable: normalizeRelativePath(relative(outdir, executable)),
    tessdata: findTessdataDirectory(outdir),
    source: source.source,
    preparedAt: new Date().toISOString()
  };
  writeFileSync(join(outdir, "ocr-runtime.json"), JSON.stringify(manifest, null, 2));
  console.log(`ocr runtime prepared at ${outdir} from ${source.source}`);
} else {
  const manifest = {
    engine: "tesseract",
    available: false,
    executable: null,
    tessdata: null,
    source: null,
    reason: "No Tesseract runtime source found. Set CODEX_WIDGET_OCR_RUNTIME_DIR or CODEX_WIDGET_TESSERACT_EXE before build to bundle OCR.",
    preparedAt: new Date().toISOString()
  };
  writeFileSync(join(outdir, "ocr-runtime.json"), JSON.stringify(manifest, null, 2));
  console.log(`ocr runtime manifest prepared at ${outdir} (engine not bundled)`);
}

function resolveOcrRuntimeSource() {
  const explicitDir = process.env.CODEX_WIDGET_OCR_RUNTIME_DIR?.trim();
  if (explicitDir) {
    const dir = resolve(explicitDir);
    assertDirectory(dir, "CODEX_WIDGET_OCR_RUNTIME_DIR");
    return { dir, source: "CODEX_WIDGET_OCR_RUNTIME_DIR" };
  }

  const explicitExe = process.env.CODEX_WIDGET_TESSERACT_EXE?.trim();
  if (explicitExe) {
    const exe = resolve(explicitExe);
    assertFile(exe, "CODEX_WIDGET_TESSERACT_EXE");
    return { dir: dirname(exe), source: "CODEX_WIDGET_TESSERACT_EXE" };
  }

  const pathExe = findTesseractOnPath();
  if (pathExe) {
    return { dir: dirname(pathExe), source: "PATH" };
  }

  return null;
}

function findTesseractOnPath() {
  if (process.platform !== "win32") {
    return undefined;
  }

  const result = spawnSync("where.exe", ["tesseract"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  });
  if (result.status !== 0) {
    return undefined;
  }

  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first && existsSync(first) ? resolve(first) : undefined;
}

function findTesseractExecutable(dir) {
  const candidates = [
    join(dir, "tesseract.exe"),
    join(dir, "bin", "tesseract.exe")
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function findTessdataDirectory(dir) {
  const candidates = [
    join(dir, "tessdata"),
    join(dir, "share", "tessdata"),
    join(dir, "share", "tesseract-ocr", "tessdata")
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ? normalizeRelativePath(relative(dir, found)) : null;
}

function assertSafeOutputDirectory(dir) {
  if (basename(dir).toLowerCase() !== "ocr-runtime") {
    throw new Error(`Refusing to prepare OCR runtime outside an ocr-runtime directory: ${dir}`);
  }
}

function assertSourceIsNotOutput(source, dir) {
  if (!source) {
    return;
  }

  if (resolve(source.dir).toLowerCase() === resolve(dir).toLowerCase()) {
    throw new Error(`Refusing to use the OCR output directory as its own source: ${dir}`);
  }
}

function assertDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

function assertFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} is not a file: ${path}`);
  }
}

function normalizeRelativePath(path) {
  return path.split(/[\\/]+/).join("/");
}
