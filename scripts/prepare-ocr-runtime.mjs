#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TESSDATA_BASE_URL,
  fetchTessdataLanguages,
  parseTessdataLanguages
} from "./lib/tessdata-fetch.mjs";

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

  await maybeFetchConfiguredTessdata(outdir);
  const tessdata = findTessdataDirectory(outdir);
  const manifest = {
    engine: "tesseract",
    available: true,
    executable: normalizeRelativePath(relative(outdir, executable)),
    tessdata,
    languages: findTessdataLanguages(outdir, tessdata),
    source: source.source,
    preparedAt: new Date().toISOString()
  };
  writeFileSync(join(outdir, "ocr-runtime.json"), JSON.stringify(manifest, null, 2));
  console.log(`ocr runtime prepared at ${outdir} from ${source.source}`);
} else {
  await maybeFetchConfiguredTessdata(outdir);
  const tessdata = findTessdataDirectory(outdir);
  const manifest = {
    engine: "tesseract",
    available: false,
    executable: null,
    tessdata,
    languages: findTessdataLanguages(outdir, tessdata),
    source: null,
    reason: "No Tesseract runtime source found. Set CODEX_WIDGET_OCR_RUNTIME_DIR, CODEX_WIDGET_TESSERACT_EXE, or CODEX_WIDGET_TESSERACT_SEARCH_ROOTS before build to bundle OCR; otherwise add tesseract to PATH or install Tesseract in a standard Windows location.",
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

  const knownInstall = findKnownTesseractInstall();
  if (knownInstall) {
    return { dir: dirname(knownInstall.exe), source: knownInstall.source };
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

function findKnownTesseractInstall() {
  if (process.platform !== "win32") {
    return undefined;
  }

  const candidates = [
    ...knownSearchRootCandidates(process.env.CODEX_WIDGET_TESSERACT_SEARCH_ROOTS, "CODEX_WIDGET_TESSERACT_SEARCH_ROOTS"),
    ...knownInstallCandidates(process.env.ProgramFiles, "ProgramFiles"),
    ...knownInstallCandidates(process.env["ProgramFiles(x86)"], "ProgramFiles(x86)"),
    ...knownInstallCandidates(process.env.LOCALAPPDATA, "LOCALAPPDATA", "Programs"),
    ...knownInstallCandidates(process.env.ChocolateyInstall, "ChocolateyInstall", "lib", "tesseract", "tools"),
    ...knownInstallCandidates(process.env.SCOOP, "SCOOP", "apps", "tesseract", "current"),
    ...knownInstallCandidates(process.env.USERPROFILE, "USERPROFILE", "scoop", "apps", "tesseract", "current")
  ];

  return candidates.find((candidate) => existsSync(candidate.exe));
}

function knownSearchRootCandidates(value, label) {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => knownInstallCandidates(entry, label));
}

function knownInstallCandidates(base, label, ...segments) {
  if (!base?.trim()) {
    return [];
  }

  const root = resolve(base, ...segments);
  return [
    {
      exe: join(root, "Tesseract-OCR", "tesseract.exe"),
      source: `known:${label}/Tesseract-OCR`
    },
    {
      exe: join(root, "tesseract.exe"),
      source: `known:${label}`
    },
    {
      exe: join(root, "bin", "tesseract.exe"),
      source: `known:${label}/bin`
    }
  ];
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

function findTessdataLanguages(dir, tessdata) {
  if (!tessdata) {
    return [];
  }

  const tessdataPath = resolve(dir, tessdata);
  if (!existsSync(tessdataPath)) {
    return [];
  }

  return readdirSync(tessdataPath)
    .filter((entry) => entry.toLowerCase().endsWith(".traineddata"))
    .map((entry) => entry.slice(0, -".traineddata".length))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

async function maybeFetchConfiguredTessdata(runtimeDir) {
  const languages = parseTessdataLanguages([
    process.env.CODEX_WIDGET_TESSDATA_LANGUAGES,
    process.env.CODEX_WIDGET_OCR_FETCH_LANGUAGES
  ]);
  if (languages.length === 0) {
    return;
  }

  await fetchTessdataLanguages({
    languages,
    outDir: join(runtimeDir, "tessdata"),
    baseUrl: process.env.CODEX_WIDGET_TESSDATA_BASE_URL?.trim() || DEFAULT_TESSDATA_BASE_URL,
    force: process.env.CODEX_WIDGET_TESSDATA_FORCE === "1",
    minBytes: readPositiveInt(process.env.CODEX_WIDGET_TESSDATA_MIN_BYTES, 1024),
    log: (line) => console.log(line)
  });
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
