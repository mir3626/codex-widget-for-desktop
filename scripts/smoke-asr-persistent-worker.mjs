#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempRoot = mkdtempSync(path.join(tmpdir(), "codex-widget-asr-persistent-worker-"));
try {
  mkdirSync(tempRoot, { recursive: true });
  writeFileSync(path.join(tempRoot, "speech-1.wav"), "fixture audio 1");
  writeFileSync(path.join(tempRoot, "speech-2.wav"), "fixture audio 2");
  const manifestPath = path.join(tempRoot, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({
    samples: [
      {
        id: "persistent-1",
        path: "speech-1.wav",
        text: "테스트 음성 명령",
        language: "ko",
        durationMs: 1000
      },
      {
        id: "persistent-2",
        path: "speech-2.wav",
        text: "테스트 음성 명령",
        language: "ko",
        durationMs: 1000
      }
    ]
  }), "utf8");

  const run = spawnSync(process.execPath, [
    "scripts/benchmark-asr-candidates.mjs",
    "--persistent",
    "--candidate",
    "faster-whisper-large-v3-turbo-cpu",
    "--manifest",
    manifestPath,
    "--fixture-text",
    "테스트 음성 명령",
    "--json"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.results.length, 2);
  assert.equal(report.results.every((result) => result.status === "ok"), true);
  assert.equal(report.results.every((result) => result.text === "테스트 음성 명령"), true);
  assert.equal(report.results.every((result) => result.workerMode === "persistent"), true);
  assert.equal(report.results[0].coldStart, true);
  assert.equal(report.results[1].coldStart, false);
  assert.ok(report.results[0].workerPid, "persistent benchmark should expose the worker pid");

  console.log("asr persistent worker smoke ok: JSONL worker, benchmark, fixture reuse");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
