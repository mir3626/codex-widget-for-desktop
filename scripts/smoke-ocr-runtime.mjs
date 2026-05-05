#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-ocr-runtime-"));
const sourceDir = join(tempRoot, "source-ocr-runtime");
const outDir = join(tempRoot, "ocr-runtime");
const knownRoot = join(tempRoot, "program-files");
const knownSourceDir = join(knownRoot, "Tesseract-OCR");
const knownOutDir = join(tempRoot, "known-ocr-runtime", "ocr-runtime");
const fetchOutDir = join(tempRoot, "fetch-ocr-runtime", "ocr-runtime");
const cliFetchDir = join(tempRoot, "cli-fetch", "tessdata");
const tessdataDir = join(sourceDir, "tessdata");
const knownTessdataDir = join(knownSourceDir, "tessdata");
let tessdataServer;

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

  tessdataServer = createServer((request, response) => {
    const name = request.url?.replace(/^\//, "") ?? "";
    if (!/^(eng|kor|osd)\.traineddata$/.test(name)) {
      response.writeHead(404).end("missing");
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" }).end(`${name}:`.repeat(64));
  });
  await new Promise((resolve) => tessdataServer.listen(0, "127.0.0.1", resolve));
  const address = tessdataServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Tessdata smoke server did not bind to a TCP port.");
  }
  const tessdataBaseUrl = `http://127.0.0.1:${address.port}`;

  const fetchResult = await runNode(["scripts/prepare-ocr-runtime.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WIDGET_OCR_RUNTIME_DIR: "",
      CODEX_WIDGET_TESSERACT_EXE: "",
      CODEX_WIDGET_OCR_RUNTIME_OUT_DIR: fetchOutDir,
      CODEX_WIDGET_TESSDATA_LANGUAGES: "eng,kor",
      CODEX_WIDGET_TESSDATA_BASE_URL: tessdataBaseUrl,
      CODEX_WIDGET_TESSDATA_MIN_BYTES: "16",
      CODEX_WIDGET_TESSERACT_SEARCH_ROOTS: "",
      PATH: join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
      ProgramFiles: "",
      "ProgramFiles(x86)": "",
      LOCALAPPDATA: "",
      ChocolateyInstall: "",
      SCOOP: ""
    }
  });

  if (fetchResult.status !== 0) {
    throw new Error([fetchResult.stdout, fetchResult.stderr].filter(Boolean).join("\n"));
  }

  const fetchManifest = JSON.parse(readFileSync(join(fetchOutDir, "ocr-runtime.json"), "utf8"));
  if (
    fetchManifest.available !== false ||
    fetchManifest.tessdata !== "tessdata" ||
    fetchManifest.languages?.join(",") !== "eng,kor"
  ) {
    throw new Error(`Unexpected fetched tessdata manifest: ${JSON.stringify(fetchManifest)}`);
  }

  const cliFetch = await runNode(
    ["scripts/fetch-ocr-languages.mjs", "--out", cliFetchDir, "--base-url", tessdataBaseUrl, "--min-bytes", "16", "osd"],
    {
      cwd: process.cwd()
    }
  );
  if (cliFetch.status !== 0) {
    throw new Error([cliFetch.stdout, cliFetch.stderr].filter(Boolean).join("\n"));
  }
  if (!readFileSync(join(cliFetchDir, "osd.traineddata"), "utf8").includes("osd.traineddata")) {
    throw new Error("Ad hoc tessdata fetch CLI did not write osd.traineddata.");
  }

  process.env.CODEX_WIDGET_SCREEN_OCR_RUNTIME_DIR = outDir;
  const { resolveBundledOcrCommand } = await import("../dist/daemon/providers/screenCaptureProvider.js");
  const command = resolveBundledOcrCommand();
  if (!command?.includes("tesseract.exe") || !command.includes("--tessdata-dir") || !command.includes("-l \"eng+kor\"")) {
    throw new Error(`Bundled OCR command was not resolved from the prepared runtime: ${command}`);
  }

  console.log(`ocr runtime smoke ok: ${manifest.executable} with ${manifest.tessdata}`);
} finally {
  if (tessdataServer) {
    await new Promise((resolve) => tessdataServer.close(resolve));
  }
  rmSync(tempRoot, { recursive: true, force: true });
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}

function runNode(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}
