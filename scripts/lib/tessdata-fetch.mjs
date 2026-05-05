import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export const DEFAULT_TESSDATA_BASE_URL = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main";

export function parseTessdataLanguages(values) {
  const languages = [];
  const seen = new Set();
  for (const value of values) {
    for (const part of String(value ?? "").split(/[,\s]+/)) {
      const language = part.trim();
      if (!language) {
        continue;
      }
      assertSafeLanguage(language);
      const key = language.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      languages.push(language);
    }
  }
  return languages;
}

export async function fetchTessdataLanguages(options) {
  const outDir = resolve(options.outDir);
  const baseUrl = String(options.baseUrl ?? DEFAULT_TESSDATA_BASE_URL).replace(/\/+$/, "");
  const minBytes = Number.isFinite(options.minBytes) ? Math.max(0, Math.floor(options.minBytes)) : 1024;
  const force = options.force === true;
  const log = typeof options.log === "function" ? options.log : () => undefined;
  mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const language of options.languages) {
    assertSafeLanguage(language);
    const filename = `${language}.traineddata`;
    const target = join(outDir, filename);
    if (existsSync(target) && !force) {
      results.push({ language, target, status: "exists" });
      log(`tessdata ${language}: already exists at ${target}`);
      continue;
    }

    const url = `${baseUrl}/${encodeURIComponent(filename)}`;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Unable to download ${filename} from ${url}: HTTP ${response.status}`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < minBytes) {
      throw new Error(`Downloaded ${filename} from ${url} is too small (${data.length} bytes).`);
    }

    const temp = `${target}.${process.pid}.download`;
    try {
      writeFileSync(temp, data);
      renameSync(temp, target);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
    results.push({ language, target, status: "downloaded", bytes: data.length });
    log(`tessdata ${language}: downloaded ${data.length} bytes to ${target}`);
  }

  return results;
}

function assertSafeLanguage(language) {
  if (!/^[A-Za-z0-9_+-]+$/.test(language) || basename(language) !== language) {
    throw new Error(`Unsafe tessdata language id: ${language}`);
  }
}
