import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScreenCrop } from "../../shared/protocol.js";
import { resolveBundledOcrCommand } from "./screenCaptureOcr.js";

export type ScreenCaptureResult = {
  output: string;
};

const DEFAULT_TIMEOUT_MS = 60_000;

export async function captureScreenSnapshot(input: {
  daemonPort: number;
  description?: string;
  crop?: ScreenCrop;
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
  const cropX = readCropValue(input.crop?.x, process.env.CODEX_WIDGET_SCREEN_CROP_X);
  const cropY = readCropValue(input.crop?.y, process.env.CODEX_WIDGET_SCREEN_CROP_Y);
  const cropWidth = readCropValue(input.crop?.width, process.env.CODEX_WIDGET_SCREEN_CROP_WIDTH);
  const cropHeight = readCropValue(input.crop?.height, process.env.CODEX_WIDGET_SCREEN_CROP_HEIGHT);
  if (cropX) {
    args.push("-CropX", cropX);
  }
  if (cropY) {
    args.push("-CropY", cropY);
  }
  if (cropWidth) {
    args.push("-CropWidth", cropWidth);
  }
  if (cropHeight) {
    args.push("-CropHeight", cropHeight);
  }
  const ocrScale = process.env.CODEX_WIDGET_SCREEN_OCR_SCALE?.trim();
  if (ocrScale) {
    args.push("-OcrScale", ocrScale);
  }
  const ocrMaxWidth = process.env.CODEX_WIDGET_SCREEN_OCR_MAX_WIDTH?.trim();
  if (ocrMaxWidth) {
    args.push("-OcrMaxWidth", ocrMaxWidth);
  }
  const configuredOcrLanguage = process.env.CODEX_WIDGET_SCREEN_OCR_LANGUAGE?.trim();
  if (configuredOcrLanguage) {
    args.push("-OcrLanguage", configuredOcrLanguage);
  }
  if (process.env.CODEX_WIDGET_SCREEN_OCR_DISABLE === "1") {
    args.push("-DisableOcr");
  } else {
    if (process.env.CODEX_WIDGET_SCREEN_OCR_DISABLE_PREPROCESS === "1") {
      args.push("-DisableOcrPreprocess");
    }
    if (!process.env.CODEX_WIDGET_SCREEN_OCR_COMMAND?.trim()) {
      const bundledOcrCommand = resolveBundledOcrCommand();
      if (bundledOcrCommand) {
        args.push("-OcrCommand", bundledOcrCommand);
      }
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

function readCropValue(value: number | undefined, fallback: string | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.floor(value));
  }
  return fallback?.trim() ?? "";
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
