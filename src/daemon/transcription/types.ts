import type { TranscriptSegment } from "../vision-context/types.js";

export type { TranscriptSegment };

export type AudioSegment = {
  id: string;
  path?: string;
  startMs: number;
  endMs: number;
  sampleRate?: number;
  metadata?: Record<string, unknown>;
};

export type Transcript = {
  id: string;
  createdAt: string;
  language?: string;
  text: string;
  confidence: number;
  segments: TranscriptSegment[];
};

export type AsrEngineInput = {
  segments: AudioSegment[];
  language?: string;
  hints?: string[];
};

export type AsrEngine = {
  id: string;
  label: string;
  isAvailable(): Promise<boolean>;
  transcribe(input: AsrEngineInput): Promise<Transcript>;
};

export type UserLexiconEntry = {
  id: string;
  profileId: string;
  canonical: string;
  aliases: string[];
  observedMisrecognitions: string[];
  contexts: string[];
  count: number;
  lastUsedAt: string;
  confidenceBoost: number;
};

export type ActionSlotConfidence = {
  target: number;
  action: number;
  location: number;
  condition: number;
  domain: number;
};

export type CorrectionResult = {
  text: string;
  replacements: Array<{ from: string; to: string; confidenceBoost: number }>;
};
