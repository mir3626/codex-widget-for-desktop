#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));
const corpusPath = path.resolve(options.corpus ?? "docs/eval/asr-benchmark-corpus.fixture.json");
const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
const samples = Array.isArray(corpus.samples) ? corpus.samples : [];
if (!samples.length) {
  throw new Error(`ASR benchmark corpus must contain samples: ${corpusPath}`);
}

const date = options.date ?? localDateString();
const outputRoot = path.resolve(options.outputRoot ?? path.join("docs", "reports"));
const assetDir = path.join(outputRoot, "assets", `asr-benchmark-corpus-${date}`);
const evidencePath = path.join(assetDir, "evidence.json");
const reportPath = path.join(outputRoot, `asr-benchmark-corpus-${date}.md`);
const results = samples.map(evaluateSample);
const werValues = results.map((result) => result.wer);
const commandSuccess = results.filter((result) => result.commandCorrect).length;
const output = {
  schemaVersion: "asr-benchmark-corpus-report.v1",
  generatedAt: new Date().toISOString(),
  date,
  corpus: {
    path: path.relative(process.cwd(), corpusPath).replace(/\\/g, "/"),
    schemaVersion: corpus.schemaVersion,
    fixtureOnly: corpus.fixtureOnly === true,
    sampleCount: samples.length
  },
  metrics: {
    sampleCount: samples.length,
    averageWer: average(werValues),
    maxWer: Math.max(...werValues),
    commandAccuracy: commandSuccess / samples.length,
    cpuFixtureSampleCount: results.filter((result) => result.device === "cpu").length
  },
  results
};

if (!options.dryRun) {
  await mkdir(assetDir, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderReport(output), "utf8");
}

if (options.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`asr benchmark corpus: averageWER=${output.metrics.averageWer.toFixed(3)} commandAccuracy=${output.metrics.commandAccuracy.toFixed(3)}`);
  if (!options.dryRun) {
    console.log(`evidence: ${path.relative(process.cwd(), evidencePath).replace(/\\/g, "/")}`);
    console.log(`report: ${path.relative(process.cwd(), reportPath).replace(/\\/g, "/")}`);
  }
}

function evaluateSample(sample) {
  const expected = String(sample.expectedTranscript ?? "");
  const actual = String(sample.actualTranscript ?? sample.fixtureTranscript ?? "");
  const expectedCommand = String(sample.expectedCommand ?? "");
  const actualCommand = String(sample.actualCommand ?? sample.fixtureCommand ?? "");
  return {
    id: String(sample.id ?? "unknown-sample"),
    audioPath: String(sample.audioPath ?? ""),
    durationMs: Number.isFinite(Number(sample.durationMs)) ? Number(sample.durationMs) : undefined,
    language: String(sample.language ?? "unknown"),
    device: String(sample.device ?? "cpu"),
    expectedTranscript: expected,
    actualTranscript: actual,
    wer: wordErrorRate(expected, actual),
    expectedCommand,
    actualCommand,
    commandCorrect: normalizeCommand(expectedCommand) === normalizeCommand(actualCommand)
  };
}

function renderReport(output) {
  const lines = [
    "# ASR Benchmark Corpus",
    "",
    `- Date: ${output.date}`,
    `- Corpus: ${output.corpus.path}`,
    `- Fixture only: ${output.corpus.fixtureOnly}`,
    `- Samples: ${output.metrics.sampleCount}`,
    `- Average WER: ${output.metrics.averageWer.toFixed(3)}`,
    `- Max WER: ${output.metrics.maxWer.toFixed(3)}`,
    `- Command accuracy: ${output.metrics.commandAccuracy.toFixed(3)}`,
    "",
    "## Samples",
    ""
  ];
  for (const result of output.results) {
    lines.push(`- ${result.id}: WER=${result.wer.toFixed(3)} command=${result.commandCorrect ? "pass" : "fail"} device=${result.device}`);
  }
  lines.push("");
  lines.push("Fixture samples validate the benchmark math and evidence contract. GPU ASR validation requires user-provided audio and a GPU runtime.");
  return `${lines.join("\n")}\n`;
}

function wordErrorRate(expected, actual) {
  const left = tokenize(expected);
  const right = tokenize(actual);
  if (!left.length && !right.length) {
    return 0;
  }
  if (!left.length) {
    return 1;
  }
  return levenshtein(left, right) / left.length;
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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

function normalizeCommand(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function localDateString() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(args) {
  const options = { dryRun: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--corpus") {
      options.corpus = args[++index];
    } else if (arg === "--output-root") {
      options.outputRoot = args[++index];
    } else if (arg === "--date") {
      options.date = args[++index];
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--json") {
      options.json = true;
    }
  }
  return options;
}
