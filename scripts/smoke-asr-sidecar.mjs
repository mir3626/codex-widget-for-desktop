#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SidecarAsrEngine, createMockVadSegments } from "../dist/daemon/transcription/index.js";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-asr-sidecar-"));
const previousCommand = process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND;
const previousTimeout = process.env.CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS;
const previousMaxOutput = process.env.CODEX_WIDGET_ASR_SIDECAR_MAX_OUTPUT_BYTES;
const previousMode = process.env.CODEX_WIDGET_ASR_SIDECAR_SMOKE_MODE;

try {
  delete process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND;
  assert.equal(await new SidecarAsrEngine().isAvailable(), false, "sidecar should be unavailable without command env");

  mkdirSync(tempRoot, { recursive: true });
  const sidecarScript = join(tempRoot, "mock-asr-sidecar.mjs");
  writeFileSync(sidecarScript, `
process.stdin.setEncoding("utf8");
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const mode = process.env.CODEX_WIDGET_ASR_SIDECAR_SMOKE_MODE || "ok";
  if (mode === "hang") {
    setTimeout(() => {}, 30_000);
    return;
  }
  if (mode === "invalid-json") {
    process.stdout.write("not json");
    return;
  }
  if (mode === "error") {
    process.stderr.write("synthetic sidecar failure");
    process.exit(7);
    return;
  }

  const request = JSON.parse(input);
  if (request.schemaVersion !== "codex-widget-asr-sidecar.v1") {
    process.stderr.write("schema mismatch");
    process.exit(11);
    return;
  }
  if (!Array.isArray(request.segments) || request.segments.length !== 2) {
    process.stderr.write("segment payload mismatch");
    process.exit(12);
    return;
  }
  if (mode === "minimal") {
    process.stdout.write(JSON.stringify({
      text: "minimal sidecar transcript",
      confidence: 1.2
    }));
    return;
  }
  process.stdout.write(JSON.stringify({
    id: "sidecar-transcript-smoke",
    createdAt: "2026-05-13T00:00:00.000Z",
    language: request.language,
    text: request.hints.join(" ") + " sidecar transcript",
    confidence: 0.91,
    segments: request.segments.map((segment, index) => ({
      id: "sidecar-segment-" + index,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: "sidecar segment " + index,
      confidence: 0.88 + index * 0.02
    }))
  }));
});
`);

  process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND = `"${process.execPath}" "${sidecarScript}"`;
  process.env.CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS = "1000";
  process.env.CODEX_WIDGET_ASR_SIDECAR_MAX_OUTPUT_BYTES = "20000";

  const engine = new SidecarAsrEngine();
  assert.equal(await engine.isAvailable(), true, "sidecar should be available when command env is configured");

  const segments = createMockVadSegments([
    { path: join(tempRoot, "speech-1.wav"), startMs: 0, endMs: 840 },
    { path: join(tempRoot, "speech-2.wav"), startMs: 900, endMs: 1600 }
  ]);
  const transcript = await engine.transcribe({
    language: "ko",
    hints: ["browser", "action"],
    segments
  });
  assert.equal(transcript.id, "sidecar-transcript-smoke");
  assert.equal(transcript.language, "ko");
  assert.equal(transcript.text, "browser action sidecar transcript");
  assert.equal(transcript.segments.length, 2);
  assert.equal(transcript.segments[1].startMs, 900);
  assert.ok(transcript.confidence > 0.9, "sidecar confidence should normalize from result");

  process.env.CODEX_WIDGET_ASR_SIDECAR_SMOKE_MODE = "minimal";
  const minimalTranscript = await engine.transcribe({ language: "en", segments });
  assert.equal(minimalTranscript.text, "minimal sidecar transcript");
  assert.equal(minimalTranscript.confidence, 1, "confidence should clamp to 1");
  assert.equal(minimalTranscript.segments[0].text, "minimal sidecar transcript", "minimal sidecar result should fan out text to segments");

  process.env.CODEX_WIDGET_ASR_SIDECAR_SMOKE_MODE = "invalid-json";
  await assert.rejects(
    () => engine.transcribe({ segments }),
    /did not return JSON/,
    "invalid JSON should fail closed"
  );

  process.env.CODEX_WIDGET_ASR_SIDECAR_SMOKE_MODE = "error";
  await assert.rejects(
    () => engine.transcribe({ segments }),
    /exited with 7: synthetic sidecar failure/,
    "sidecar nonzero exit should surface stderr"
  );

  process.env.CODEX_WIDGET_ASR_SIDECAR_SMOKE_MODE = "hang";
  process.env.CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS = "100";
  await assert.rejects(
    () => engine.transcribe({ segments }),
    /timed out/,
    "hung sidecar should time out"
  );

  console.log("asr sidecar smoke ok: contract, normalization, error, timeout");
} finally {
  restoreEnv("CODEX_WIDGET_ASR_SIDECAR_COMMAND", previousCommand);
  restoreEnv("CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS", previousTimeout);
  restoreEnv("CODEX_WIDGET_ASR_SIDECAR_MAX_OUTPUT_BYTES", previousMaxOutput);
  restoreEnv("CODEX_WIDGET_ASR_SIDECAR_SMOKE_MODE", previousMode);
  rmSync(tempRoot, { recursive: true, force: true });
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
