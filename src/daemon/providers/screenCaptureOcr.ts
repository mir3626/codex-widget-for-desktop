import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
