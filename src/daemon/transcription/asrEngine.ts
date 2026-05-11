import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { AsrEngine, AsrEngineInput, Transcript } from "./types.js";

export type MockAsrPhrase = {
  text: string;
  confidence?: number;
};

export class MockAsrEngine implements AsrEngine {
  readonly id = "mock";
  readonly label = "Mock ASR";

  constructor(private readonly phrases: MockAsrPhrase[] = []) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async transcribe(input: AsrEngineInput): Promise<Transcript> {
    const segments = input.segments.map((segment, index) => {
      const phrase = this.phrases[index] ?? { text: `mock segment ${index + 1}`, confidence: 0.8 };
      return {
        id: `transcript:${segment.id}`,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: phrase.text,
        confidence: phrase.confidence ?? 0.8
      };
    });
    const text = segments.map((segment) => segment.text).join(" ").trim();
    const confidence = segments.length > 0
      ? segments.reduce((sum, segment) => sum + segment.confidence, 0) / segments.length
      : 0;
    return {
      id: `transcript-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      language: input.language,
      text,
      confidence,
      segments
    };
  }
}

export class SidecarAsrEngine implements AsrEngine {
  readonly id = "faster-whisper-sidecar";
  readonly label = "faster-whisper sidecar";

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND?.trim());
  }

  async transcribe(input: AsrEngineInput): Promise<Transcript> {
    const command = process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND?.trim();
    if (!command) {
      throw new Error("ASR sidecar command is not configured.");
    }
    const result = await runSidecar(command, input);
    return normalizeSidecarTranscript(result, input);
  }
}

function runSidecar(command: string, input: AsrEngineInput): Promise<unknown> {
  const timeoutMs = clampNumber(process.env.CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS, 1_000, 600_000, 120_000);
  const maxOutputBytes = clampNumber(process.env.CODEX_WIDGET_ASR_SIDECAR_MAX_OUTPUT_BYTES, 4_096, 5_000_000, 1_000_000);
  const payload = JSON.stringify({
    schemaVersion: "codex-widget-asr-sidecar.v1",
    language: input.language,
    hints: input.hints ?? [],
    segments: input.segments
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ASR sidecar timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > maxOutputBytes) {
        child.kill();
        reject(new Error(`ASR sidecar output exceeded ${maxOutputBytes} bytes.`));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ASR sidecar exited with ${code}: ${stderr.slice(0, 4000)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`ASR sidecar did not return JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    child.stdin.end(payload);
  });
}

function normalizeSidecarTranscript(raw: unknown, input: AsrEngineInput): Transcript {
  const record = readRecord(raw);
  if (!record || typeof record.text !== "string") {
    throw new Error("ASR sidecar result must include a text string.");
  }
  const text = record.text;
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
  const language = typeof record.language === "string" ? record.language : input.language;
  const confidence = clampTranscriptConfidence(record.confidence);
  const rawSegments = Array.isArray(record.segments) ? record.segments : [];
  const segments = input.segments.map((segment, index) => {
    const sidecarSegment = readRecord(rawSegments[index]);
    return {
      id: typeof sidecarSegment?.id === "string" ? sidecarSegment.id : `transcript:${segment.id}`,
      startMs: typeof sidecarSegment?.startMs === "number" ? sidecarSegment.startMs : segment.startMs,
      endMs: typeof sidecarSegment?.endMs === "number" ? sidecarSegment.endMs : segment.endMs,
      text: typeof sidecarSegment?.text === "string" ? sidecarSegment.text : text,
      confidence: clampTranscriptConfidence(sidecarSegment?.confidence, confidence)
    };
  });
  return {
    id: typeof record.id === "string" ? record.id : `transcript-${randomUUID()}`,
    createdAt,
    language,
    text,
    confidence,
    segments
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function clampTranscriptConfidence(value: unknown, fallback = 0.8): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}
