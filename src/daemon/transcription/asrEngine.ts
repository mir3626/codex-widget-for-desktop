import { randomUUID } from "node:crypto";
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

  async transcribe(): Promise<Transcript> {
    throw new Error("ASR sidecar is configured as an interface boundary but not launched by the MVP.");
  }
}
