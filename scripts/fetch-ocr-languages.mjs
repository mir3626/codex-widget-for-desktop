#!/usr/bin/env node
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TESSDATA_BASE_URL,
  fetchTessdataLanguages,
  parseTessdataLanguages
} from "./lib/tessdata-fetch.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const options = readOptions(process.argv.slice(2));
const languages = parseTessdataLanguages(
  options.languages.length > 0
    ? options.languages
    : [process.env.CODEX_WIDGET_TESSDATA_LANGUAGES ?? "eng,kor"]
);

if (languages.length === 0) {
  throw new Error("No tessdata languages requested.");
}

const outDir = resolve(
  options.outDir ??
    process.env.CODEX_WIDGET_TESSDATA_OUT_DIR?.trim() ??
    join(root, "dist", "ocr-runtime", "tessdata")
);
const baseUrl = options.baseUrl ?? process.env.CODEX_WIDGET_TESSDATA_BASE_URL ?? DEFAULT_TESSDATA_BASE_URL;
const minBytes = options.minBytes ?? readPositiveInt(process.env.CODEX_WIDGET_TESSDATA_MIN_BYTES, 1024);

await fetchTessdataLanguages({
  languages,
  outDir,
  baseUrl,
  force: options.force,
  minBytes,
  log: (line) => console.log(line)
});

function readOptions(args) {
  const result = {
    languages: [],
    outDir: undefined,
    baseUrl: undefined,
    minBytes: undefined,
    force: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      result.outDir = requireValue(args, (index += 1), arg);
    } else if (arg === "--base-url") {
      result.baseUrl = requireValue(args, (index += 1), arg);
    } else if (arg === "--min-bytes") {
      result.minBytes = readPositiveInt(requireValue(args, (index += 1), arg), 1024);
    } else if (arg === "--force") {
      result.force = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      result.languages.push(arg);
    }
  }

  return result;
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
