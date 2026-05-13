#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SidecarAsrEngine, createMockVadSegments } from "../dist/daemon/transcription/index.js";
import { listAsrCandidates, resolveAsrCandidate } from "./asr-runtime-candidates.mjs";

const requiredCandidates = [
  "faster-whisper-large-v3-turbo-cpu",
  "faster-whisper-large-v3-cpu",
  "faster-whisper-large-v3-turbo-gpu",
  "faster-whisper-large-v3-gpu",
  "whisper-cpp-large-v3-turbo-cpu",
  "vosk-ko-small-cpu"
];
const candidates = listAsrCandidates();
for (const id of requiredCandidates) {
  assert.ok(candidates.some((candidate) => candidate.id === id), `missing ASR candidate ${id}`);
}
assert.equal(resolveAsrCandidate("faster-whisper-large-v3-turbo-gpu").env.CODEX_WIDGET_ASR_FASTER_WHISPER_DEVICE, "cuda");
assert.equal(resolveAsrCandidate("faster-whisper-large-v3-turbo-cpu").env.CODEX_WIDGET_ASR_FASTER_WHISPER_DEVICE, "cpu");

const tempRoot = mkdtempSync(path.join(tmpdir(), "codex-widget-asr-runtime-candidates-"));
const previous = snapshotEnv();
try {
  mkdirSync(tempRoot, { recursive: true });
  const audioPath = path.join(tempRoot, "speech.wav");
  writeFileSync(audioPath, "fixture audio");

  for (const candidateId of [
    "faster-whisper-large-v3-turbo-cpu",
    "whisper-cpp-large-v3-turbo-cpu",
    "vosk-ko-small-cpu"
  ]) {
    const candidate = resolveAsrCandidate(candidateId);
    Object.assign(process.env, candidate.env);
    process.env.CODEX_WIDGET_ASR_FIXTURE_TEXT = `${candidateId} fixture transcript`;
    process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND = candidate.command;
    process.env.CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS = "5000";
    const transcript = await new SidecarAsrEngine().transcribe({
      language: "ko",
      hints: ["codex widget"],
      segments: createMockVadSegments([{ path: audioPath, startMs: 0, endMs: 1000 }])
    });
    assert.equal(transcript.text, `${candidateId} fixture transcript`, `${candidateId} sidecar fixture text`);
    restoreEnv(previous);
  }

  const listRun = spawnSync(process.execPath, ["scripts/asr-candidates.mjs", "--cpu-only"], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(listRun.status, 0, listRun.stderr);
  assert.ok(listRun.stdout.includes("faster-whisper-large-v3-turbo-cpu"));
  assert.equal(listRun.stdout.includes("faster-whisper-large-v3-turbo-gpu"), false, "cpu-only listing should hide GPU candidates");

  const benchRun = spawnSync(process.execPath, [
    "scripts/benchmark-asr-candidates.mjs",
    "--candidate",
    "faster-whisper-large-v3-turbo-cpu,whisper-cpp-large-v3-turbo-cpu,vosk-ko-small-cpu",
    "--fixture-text",
    "테스트 음성 명령",
    "--json"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(benchRun.status, 0, benchRun.stderr);
  const report = JSON.parse(benchRun.stdout);
  assert.equal(report.results.length, 3);
  assert.equal(report.results.every((result) => result.status === "ok" && result.text === "테스트 음성 명령"), true);

  console.log("asr runtime candidates smoke ok: candidates, CPU fixtures, benchmark harness");
} finally {
  restoreEnv(previous);
  rmSync(tempRoot, { recursive: true, force: true });
}

function snapshotEnv() {
  const names = Object.keys(process.env).filter((name) => name.startsWith("CODEX_WIDGET_ASR_"));
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("CODEX_WIDGET_ASR_")) {
      delete process.env[name];
    }
  }
  Object.assign(process.env, snapshot);
}
