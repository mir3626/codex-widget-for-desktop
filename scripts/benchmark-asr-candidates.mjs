#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SidecarAsrEngine, createMockVadSegments } from "../dist/daemon/transcription/index.js";
import { listAsrCandidates, resolveAsrCandidate } from "./asr-runtime-candidates.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.list) {
  printCandidates();
  process.exit(0);
}

const candidateIds = options.candidates.length > 0 ? options.candidates : ["faster-whisper-large-v3-turbo-cpu"];
const tempRoot = mkdtempSync(path.join(tmpdir(), "codex-widget-asr-benchmark-"));
try {
  const audioPath = options.audio || path.join(tempRoot, "fixture.wav");
  if (!options.audio) {
    writeFileSync(audioPath, "fixture audio placeholder");
  }
  const results = [];
  for (const candidateId of candidateIds) {
    const candidate = resolveAsrCandidate(candidateId);
    const result = await runCandidate(candidate, {
      audioPath,
      language: options.language,
      expected: options.expected,
      fixtureText: options.fixtureText
    });
    results.push(result);
    if (!options.json) {
      console.log(`${result.id}: ${result.status} ${result.elapsedMs}ms`);
      console.log(`  text: ${result.text}`);
      if (typeof result.similarity === "number") {
        console.log(`  similarity: ${result.similarity.toFixed(3)}`);
      }
      if (result.error) {
        console.log(`  error: ${result.error}`);
      }
    }
  }
  if (options.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

async function runCandidate(candidate, input) {
  const previousEnv = snapshotEnv(candidate.env);
  const startedAt = Date.now();
  try {
    Object.assign(process.env, candidate.env);
    if (input.fixtureText) {
      process.env.CODEX_WIDGET_ASR_FIXTURE_TEXT = input.fixtureText;
    }
    process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND = candidate.command;
    process.env.CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS = process.env.CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS || "600000";
    const engine = new SidecarAsrEngine();
    const transcript = await engine.transcribe({
      language: input.language,
      hints: ["codex-widget", "browser action", "react-router-dom"],
      segments: createMockVadSegments([{ path: input.audioPath, startMs: 0, endMs: Number(input.durationMs ?? 1000) }])
    });
    return {
      id: candidate.id,
      family: candidate.family,
      model: candidate.model,
      device: candidate.device,
      computeType: candidate.computeType,
      status: "ok",
      elapsedMs: Date.now() - startedAt,
      text: transcript.text,
      confidence: transcript.confidence,
      similarity: input.expected ? normalizedSimilarity(input.expected, transcript.text) : undefined
    };
  } catch (error) {
    return {
      id: candidate.id,
      family: candidate.family,
      model: candidate.model,
      device: candidate.device,
      computeType: candidate.computeType,
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      text: "",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    restoreEnv(previousEnv);
  }
}

function printCandidates() {
  for (const candidate of listAsrCandidates()) {
    console.log(`${candidate.id}\t${candidate.family}\t${candidate.model}\t${candidate.device}\t${candidate.computeType}`);
  }
}

function parseArgs(args) {
  const options = {
    candidates: [],
    audio: "",
    expected: "",
    language: "ko",
    fixtureText: "",
    json: false,
    list: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--candidate") {
      options.candidates.push(...String(args[++index] ?? "").split(",").map((item) => item.trim()).filter(Boolean));
    } else if (arg === "--audio") {
      options.audio = args[++index] ?? "";
    } else if (arg === "--expected") {
      options.expected = args[++index] ?? "";
    } else if (arg === "--language") {
      options.language = args[++index] ?? "ko";
    } else if (arg === "--fixture-text") {
      options.fixtureText = args[++index] ?? "";
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--list") {
      options.list = true;
    }
  }
  return options;
}

function normalizedSimilarity(expected, actual) {
  const left = normalizeText(expected);
  const right = normalizeText(actual);
  if (!left && !right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }
  const distance = levenshtein(left, right);
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function levenshtein(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = left[i - 1] === right[j - 1]
        ? previous
        : Math.min(previous + 1, row[j] + 1, row[j - 1] + 1);
      previous = current;
    }
  }
  return row[right.length];
}

function snapshotEnv(extraEnv) {
  const names = new Set([
    "CODEX_WIDGET_ASR_SIDECAR_COMMAND",
    "CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS",
    "CODEX_WIDGET_ASR_FIXTURE_TEXT",
    ...Object.keys(extraEnv)
  ]);
  return Object.fromEntries([...names].map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
