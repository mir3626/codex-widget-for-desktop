#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const request = JSON.parse(await readStdin());
validateRequest(request);

const fixtureText = String(process.env.CODEX_WIDGET_ASR_FIXTURE_TEXT ?? "").trim();
if (fixtureText) {
  writeJson(buildFixtureTranscript(request, fixtureText));
  process.exit(0);
}

const binary = process.env.CODEX_WIDGET_ASR_WHISPER_CPP_BIN || "whisper-cli";
const modelPath = process.env.CODEX_WIDGET_ASR_WHISPER_CPP_MODEL || "";
if (!modelPath) {
  fail("CODEX_WIDGET_ASR_WHISPER_CPP_MODEL must point to a ggml model file.");
}

const tempRoot = mkdtempSync(path.join(tmpdir(), "codex-widget-whisper-cpp-"));
try {
  const startedAt = Date.now();
  const transcriptSegments = [];
  const texts = [];
  for (const [index, segment] of request.segments.entries()) {
    if (!segment.path) {
      fail("whisper.cpp sidecar requires segment.path for real transcription.");
    }
    const outputBase = path.join(tempRoot, `segment-${index}`);
    const args = buildWhisperCppArgs({
      modelPath,
      audioPath: segment.path,
      outputBase,
      language: request.language
    });
    const result = await run(binary, args);
    if (result.code !== 0) {
      fail(`whisper.cpp exited with ${result.code}: ${result.stderr.slice(0, 4000)}`);
    }
    const text = readWhisperCppText(outputBase, result.stdout).trim();
    if (!text) {
      continue;
    }
    const startMs = Number(segment.startMs ?? 0);
    const endMs = Number(segment.endMs ?? startMs);
    transcriptSegments.push({
      id: `whisper-cpp:${segment.id ?? index}`,
      startMs,
      endMs: Math.max(startMs, endMs),
      text,
      confidence: 0.8
    });
    texts.push(text);
  }

  writeJson({
    id: `transcript-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    language: request.language,
    text: texts.join(" ").trim(),
    confidence: transcriptSegments.length > 0 ? 0.8 : 0,
    segments: transcriptSegments,
    diagnostics: {
      engine: "whisper.cpp",
      binary,
      modelPath,
      modelKind: process.env.CODEX_WIDGET_ASR_WHISPER_CPP_MODEL_KIND || "",
      elapsedMs: Date.now() - startedAt
    }
  });
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function buildWhisperCppArgs({ modelPath, audioPath, outputBase, language }) {
  const args = ["-m", modelPath, "-f", audioPath, "-of", outputBase, "-oj", "-nt"];
  const threads = String(process.env.CODEX_WIDGET_ASR_WHISPER_CPP_THREADS ?? "").trim();
  if (threads) {
    args.push("-t", threads);
  }
  const normalizedLanguage = normalizeLanguage(language);
  if (normalizedLanguage) {
    args.push("-l", normalizedLanguage);
  }
  if (process.env.CODEX_WIDGET_ASR_WHISPER_CPP_GPU === "0") {
    args.push("--no-gpu");
  }
  return args;
}

function readWhisperCppText(outputBase, stdout) {
  const jsonPath = `${outputBase}.json`;
  try {
    const payload = JSON.parse(readFileSync(jsonPath, "utf8"));
    const texts = [];
    collectTextFields(payload, texts);
    return texts.join(" ");
  } catch {
    return stdout
      .split(/\r?\n/)
      .filter((line) => !line.includes("whisper_") && !line.includes("system_info"))
      .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
      .filter(Boolean)
      .join(" ");
  }
}

function collectTextFields(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFields(item, output);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (typeof value.text === "string" && value.text.trim()) {
    output.push(value.text.trim());
  }
  for (const [key, item] of Object.entries(value)) {
    if (key !== "text") {
      collectTextFields(item, output);
    }
  }
}

function normalizeLanguage(language) {
  const value = String(language ?? "").trim();
  if (!value) {
    return "";
  }
  if (value === "ko-KR" || value === "kr") {
    return "ko";
  }
  if (value === "en-US") {
    return "en";
  }
  return value;
}

function buildFixtureTranscript(input, text) {
  const segment = input.segments[0] ?? {};
  const startMs = Number(segment.startMs ?? 0);
  return {
    id: `transcript-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    language: input.language,
    text,
    confidence: 0.99,
    segments: [{
      id: `whisper-cpp-fixture:${segment.id ?? "segment"}`,
      startMs,
      endMs: Math.max(startMs, Number(segment.endMs ?? startMs)),
      text,
      confidence: 0.99
    }],
    diagnostics: { engine: "whisper.cpp-fixture", fixture: true }
  };
}

function validateRequest(input) {
  if (input.schemaVersion !== "codex-widget-asr-sidecar.v1") {
    fail("Unsupported ASR sidecar schemaVersion.");
  }
  if (!Array.isArray(input.segments)) {
    fail("ASR sidecar request must include segments[].");
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(input));
  });
}

function writeJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
