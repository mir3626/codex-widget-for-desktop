#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
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
  const results = [];
  const samples = options.manifest ? readManifest(options.manifest) : [readSingleSample(options, tempRoot)];
  if (options.persistent) {
    for (const candidateId of candidateIds) {
      const candidate = resolveAsrCandidate(candidateId);
      const candidateResults = await runPersistentCandidate(candidate, samples, {
        language: options.language,
        fixtureText: options.fixtureText
      });
      results.push(...candidateResults);
      for (const result of candidateResults) {
        printResult(result);
      }
    }
  } else {
    for (const sample of samples) {
      for (const candidateId of candidateIds) {
        const candidate = resolveAsrCandidate(candidateId);
        const result = await runCandidate(candidate, {
          audioPath: sample.audioPath,
          language: sample.language ?? options.language,
          expected: sample.expected,
          fixtureText: options.fixtureText,
          durationMs: sample.durationMs
        });
        results.push({ sampleId: sample.id, expected: sample.expected, ...result });
        printResult({ sampleId: sample.id, expected: sample.expected, ...result });
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
      workerMode: "single-shot",
      coldStart: true,
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
      workerMode: "single-shot",
      coldStart: true,
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      text: "",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    restoreEnv(previousEnv);
  }
}

async function runPersistentCandidate(candidate, samples, options) {
  const env = {
    ...process.env,
    ...candidate.env,
    CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS: process.env.CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS || "600000"
  };
  if (options.fixtureText) {
    env.CODEX_WIDGET_ASR_FIXTURE_TEXT = options.fixtureText;
  }
  const command = `${candidate.command} --worker`;
  const child = spawn(command, {
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stderr = "";
  let closed = false;
  let pending = null;
  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  stdout.on("line", (line) => {
    if (!pending) {
      return;
    }
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    try {
      current.resolve(JSON.parse(line));
    } catch (error) {
      current.reject(new Error(`ASR worker did not return JSON: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.on("close", (code, signal) => {
    closed = true;
    if (pending) {
      const current = pending;
      pending = null;
      clearTimeout(current.timer);
      current.reject(new Error(`ASR worker exited with ${signal ?? code}: ${stderr.slice(0, 4000)}`));
    }
  });

  const results = [];
  try {
    for (const [index, sample] of samples.entries()) {
      const startedAt = Date.now();
      try {
        const response = await sendWorkerRequest(child, () => closed, setPending, {
          schemaVersion: "codex-widget-asr-sidecar.v1",
          requestId: `${candidate.id}:${sample.id}:${index}`,
          language: sample.language ?? options.language,
          hints: ["codex-widget", "browser action", "react-router-dom"],
          segments: createMockVadSegments([{
            path: sample.audioPath,
            startMs: 0,
            endMs: Number(sample.durationMs ?? 1000)
          }])
        }, Number(env.CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS));
        if (!response.ok) {
          throw new Error(`${response.errorType ?? "WorkerError"}: ${response.error ?? "unknown ASR worker error"}`);
        }
        const transcript = response.result;
        results.push({
          sampleId: sample.id,
          expected: sample.expected,
          id: candidate.id,
          family: candidate.family,
          model: candidate.model,
          device: candidate.device,
          computeType: candidate.computeType,
          workerMode: "persistent",
          coldStart: index === 0,
          workerPid: child.pid,
          status: "ok",
          elapsedMs: Date.now() - startedAt,
          text: String(transcript?.text ?? ""),
          confidence: typeof transcript?.confidence === "number" ? transcript.confidence : undefined,
          similarity: sample.expected ? normalizedSimilarity(sample.expected, transcript?.text ?? "") : undefined,
          diagnostics: transcript?.diagnostics
        });
      } catch (error) {
        results.push({
          sampleId: sample.id,
          expected: sample.expected,
          id: candidate.id,
          family: candidate.family,
          model: candidate.model,
          device: candidate.device,
          computeType: candidate.computeType,
          workerMode: "persistent",
          coldStart: index === 0,
          workerPid: child.pid,
          status: "failed",
          elapsedMs: Date.now() - startedAt,
          text: "",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  } finally {
    if (!closed) {
      try {
        child.stdin.write(`${JSON.stringify({ command: "shutdown", requestId: `${candidate.id}:shutdown` })}\n`);
        child.stdin.end();
      } catch {
        child.kill();
      }
    }
  }
  return results;

  function setPending(value) {
    pending = value;
  }
}

function sendWorkerRequest(child, isClosed, setPending, request, timeoutMs) {
  if (isClosed()) {
    return Promise.reject(new Error("ASR worker is not running."));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ASR worker timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    setPending({ resolve, reject, timer });
    child.stdin.write(`${JSON.stringify(request)}\n`, "utf8", (error) => {
      if (error) {
        clearTimeout(timer);
        setPending(null);
        reject(error);
      }
    });
  });
}

function printResult(result) {
  if (options.json) {
    return;
  }
  console.log(`${result.sampleId} / ${result.id}: ${result.status} ${result.elapsedMs}ms ${result.workerMode}`);
  console.log(`  expected: ${result.expected}`);
  console.log(`  text: ${result.text}`);
  if (typeof result.similarity === "number") {
    console.log(`  similarity: ${result.similarity.toFixed(3)}`);
  }
  if (result.error) {
    console.log(`  error: ${result.error}`);
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
    manifest: "",
    expected: "",
    language: "ko",
    fixtureText: "",
    persistent: false,
    json: false,
    list: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--candidate") {
      options.candidates.push(...String(args[++index] ?? "").split(",").map((item) => item.trim()).filter(Boolean));
    } else if (arg === "--audio") {
      options.audio = args[++index] ?? "";
    } else if (arg === "--manifest") {
      options.manifest = args[++index] ?? "";
    } else if (arg === "--expected") {
      const value = readPossiblySpacedValue(args, index + 1);
      options.expected = value.text;
      index = value.nextIndex - 1;
    } else if (arg === "--language") {
      options.language = args[++index] ?? "ko";
    } else if (arg === "--fixture-text") {
      const value = readPossiblySpacedValue(args, index + 1);
      options.fixtureText = value.text;
      index = value.nextIndex - 1;
    } else if (arg === "--persistent") {
      options.persistent = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--list") {
      options.list = true;
    }
  }
  return options;
}

function readSingleSample(options, tempRoot) {
  const audioPath = options.audio || path.join(tempRoot, "fixture.wav");
  if (!options.audio) {
    writeFileSync(audioPath, "fixture audio placeholder");
  }
  return {
    id: path.basename(audioPath, path.extname(audioPath)) || "single",
    audioPath,
    expected: options.expected,
    language: options.language,
    durationMs: 1000
  };
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  const root = path.dirname(path.resolve(manifestPath));
  const rows = Array.isArray(manifest) ? manifest : manifest.samples;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`ASR benchmark manifest must be a non-empty array or { samples: [] }: ${manifestPath}`);
  }
  return rows.map((row, index) => {
    const audioPath = path.resolve(root, row.path ?? row.audioPath ?? "");
    const expected = row.text ?? row.expected ?? "";
    if (!audioPath || !expected) {
      throw new Error(`ASR benchmark manifest row ${index + 1} must include path and text/expected.`);
    }
    return {
      id: row.id ?? `sample-${index + 1}`,
      audioPath,
      expected,
      language: row.language,
      durationMs: row.durationMs
    };
  });
}

function readPossiblySpacedValue(args, startIndex) {
  const parts = [];
  let index = startIndex;
  while (index < args.length && !String(args[index]).startsWith("--")) {
    parts.push(args[index]);
    index += 1;
  }
  return { text: parts.join(" "), nextIndex: index };
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
  return String(value ?? "")
    .toLowerCase()
    .replace(/리액트\s*라우터\s*돔/g, "react router dom")
    .replace(/react\s*[-_ ]?\s*router\s*[-_ ]?\s*dom/g, "react router dom")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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
