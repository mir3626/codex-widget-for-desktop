import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ScreenCaptureResult = {
  output: string;
};

const DEFAULT_TIMEOUT_MS = 60_000;

export async function captureScreenSnapshot(input: {
  daemonPort: number;
  description?: string;
  timeoutMs?: number;
}): Promise<ScreenCaptureResult> {
  if (process.platform !== "win32") {
    throw new Error("Screen capture helper is currently implemented on Windows only.");
  }

  const helper = resolveScreenCaptureHelper();
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helper,
    "-DaemonUrl",
    `http://127.0.0.1:${input.daemonPort}`,
    "-Description",
    input.description?.trim() || "Widget capture",
    "-MaxWidth",
    process.env.CODEX_WIDGET_SCREEN_CAPTURE_MAX_WIDTH ?? "1600",
    "-JpegQuality",
    process.env.CODEX_WIDGET_SCREEN_CAPTURE_JPEG_QUALITY ?? "72",
    "-OcrMaxChars",
    process.env.CODEX_WIDGET_SCREEN_OCR_MAX_CHARS ?? "20000"
  ];
  const configuredOcrLanguage = process.env.CODEX_WIDGET_SCREEN_OCR_LANGUAGE?.trim();
  if (configuredOcrLanguage) {
    args.push("-OcrLanguage", configuredOcrLanguage);
  }
  if (process.env.CODEX_WIDGET_SCREEN_OCR_DISABLE === "1") {
    args.push("-DisableOcr");
  } else if (!process.env.CODEX_WIDGET_SCREEN_OCR_COMMAND?.trim()) {
    const bundledOcrCommand = resolveBundledOcrCommand();
    if (bundledOcrCommand) {
      args.push("-OcrCommand", bundledOcrCommand);
    }
  }

  const output = await runPowerShell(args, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return { output: output.trim() };
}

export function resolveScreenCaptureHelper(): string {
  const candidates = [
    process.env.CODEX_WIDGET_SCREEN_CAPTURE_HELPER,
    resolve(process.cwd(), "providers/screen-capture-helper/capture-screen.ps1"),
    resolve(process.cwd(), "_up_/providers/screen-capture-helper/capture-screen.ps1"),
    fileURLToPath(new URL("../../../_up_/providers/screen-capture-helper/capture-screen.ps1", import.meta.url)),
    fileURLToPath(new URL("../../../providers/screen-capture-helper/capture-screen.ps1", import.meta.url))
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error("Screen capture helper was not found. Set CODEX_WIDGET_SCREEN_CAPTURE_HELPER.");
}

export function resolveBundledOcrCommand(): string | undefined {
  const runtimeDir = resolveOcrRuntimeDirectory();
  if (!runtimeDir) {
    return undefined;
  }

  const executable = findBundledTesseract(runtimeDir);
  if (!executable) {
    return undefined;
  }

  const tessdata = findBundledTessdata(runtimeDir);
  const language = resolveOcrLanguage(tessdata);
  const args = [quoteCmdArgument(executable), "{image}", "stdout"];
  if (language) {
    args.push("-l", quoteCmdArgument(language));
  }
  if (tessdata) {
    args.push("--tessdata-dir", quoteCmdArgument(tessdata));
  }
  return args.join(" ");
}

function resolveOcrRuntimeDirectory(): string | undefined {
  const candidates = [
    process.env.CODEX_WIDGET_SCREEN_OCR_RUNTIME_DIR,
    resolve(process.cwd(), "dist/ocr-runtime"),
    resolve(process.cwd(), "_up_/dist/ocr-runtime"),
    fileURLToPath(new URL("../../../_up_/dist/ocr-runtime", import.meta.url)),
    fileURLToPath(new URL("../../../dist/ocr-runtime", import.meta.url))
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  return undefined;
}

function findBundledTesseract(runtimeDir: string): string | undefined {
  return [
    join(runtimeDir, "tesseract.exe"),
    join(runtimeDir, "bin", "tesseract.exe")
  ].find((candidate) => existsSync(candidate));
}

function findBundledTessdata(runtimeDir: string): string | undefined {
  return [
    join(runtimeDir, "tessdata"),
    join(runtimeDir, "share", "tessdata"),
    join(runtimeDir, "share", "tesseract-ocr", "tessdata")
  ].find((candidate) => existsSync(candidate));
}

function resolveOcrLanguage(tessdata: string | undefined): string | undefined {
  const configured = process.env.CODEX_WIDGET_SCREEN_OCR_LANGUAGE?.trim();
  if (configured) {
    return configured;
  }

  if (!tessdata) {
    return undefined;
  }

  const languages = discoverTessdataLanguages(tessdata);
  if (languages.has("eng") && languages.has("kor")) {
    return "eng+kor";
  }
  if (languages.has("eng")) {
    return "eng";
  }
  if (languages.has("kor")) {
    return "kor";
  }

  return undefined;
}

function discoverTessdataLanguages(tessdata: string): Set<string> {
  try {
    return new Set(
      readdirSync(tessdata)
        .filter((entry) => entry.toLowerCase().endsWith(".traineddata"))
        .map((entry) => entry.slice(0, -".traineddata".length))
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function quoteCmdArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runPowerShell(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("powershell", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Screen capture helper timed out."));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error([`Screen capture helper failed with ${signal ?? code}.`, stdout, stderr].filter(Boolean).join("\n")));
    });
  });
}
