import type { ComputerSessionObservationKind } from "../../shared/protocol.js";
import {
  readPerceptionGraphIdFromCapabilityOutput,
  readTextFromCapabilityOutput
} from "./observationSummaries.js";

export type ScreenTileCache = {
  tileHashes: unknown[];
  observationId?: string;
  capturedAt: string;
};

export function applyScreenTileCacheToInput(state: { screenTileCache?: ScreenTileCache }, input: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(input.previousTileHashes) || !state.screenTileCache?.tileHashes.length) {
    return input;
  }
  return {
    ...input,
    previousTileHashes: state.screenTileCache.tileHashes,
    previousTileHashObservationId: state.screenTileCache.observationId,
    previousTileHashCapturedAt: state.screenTileCache.capturedAt
  };
}

export function readScreenTileHashesFromCapabilityOutput(output: unknown): unknown[] {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  return Array.isArray(record.tileHashes) ? record.tileHashes.slice(0, 512) : [];
}

export function readPreviousTileHashCount(input: unknown): number {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return Array.isArray(record.previousTileHashes) ? record.previousTileHashes.length : 0;
}

export function readScreenTextFromCapabilityOutput(output: unknown): string | undefined {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  for (const key of ["screenText", "recognizedText", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  const nested = record.output && typeof record.output === "object" ? record.output as Record<string, unknown> : undefined;
  for (const key of ["screenText", "recognizedText", "text"]) {
    const value = nested?.[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

export function readScreenTextBoxesFromCapabilityOutput(output: unknown): Array<{ text?: string; label?: string; bbox?: { x: number; y: number; w: number; h: number }; confidence?: number }> {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const nested = record.output && typeof record.output === "object" ? record.output as Record<string, unknown> : undefined;
  const rawBoxes = readFirstArray(record, ["ocrBoxes", "textBoxes", "recognizedTextBoxes", "boxes"]) ??
    readFirstArray(nested, ["ocrBoxes", "textBoxes", "recognizedTextBoxes", "boxes"]) ??
    [];
  return rawBoxes.slice(0, 80).map((item) => {
    const box = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      text: typeof box.text === "string" ? box.text : undefined,
      label: typeof box.label === "string" ? box.label : undefined,
      bbox: readPerceptionBox(box.bbox),
      confidence: typeof box.confidence === "number" ? box.confidence : undefined
    };
  }).filter((box) => box.text || box.label || box.bbox);
}

export function readScreenDirtyRegionsFromCapabilityOutput(output: unknown): Array<{ id?: string; bbox?: { x: number; y: number; w: number; h: number }; changedPixelsEstimate?: number }> {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const rawRegions = Array.isArray(record.dirtyRegions) ? record.dirtyRegions : [];
  return rawRegions.slice(0, 128).map((item) => {
    const region = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: typeof region.id === "string" ? region.id : undefined,
      bbox: readPerceptionBox(region.bbox),
      changedPixelsEstimate: typeof region.changedPixelsEstimate === "number" ? region.changedPixelsEstimate : undefined
    };
  }).filter((region) => region.id || region.bbox);
}

export function readFirstArray(record: Record<string, unknown> | undefined, keys: string[]): unknown[] | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return undefined;
}

export function readPerceptionBox(value: unknown): { x: number; y: number; w: number; h: number } | undefined {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const x = typeof record.x === "number" ? record.x : undefined;
  const y = typeof record.y === "number" ? record.y : undefined;
  const w = typeof record.w === "number" ? record.w : typeof record.width === "number" ? record.width : undefined;
  const h = typeof record.h === "number" ? record.h : typeof record.height === "number" ? record.height : undefined;
  return x !== undefined && y !== undefined && w !== undefined && h !== undefined ? { x, y, w, h } : undefined;
}

export function readScreenCascadePayload(output: unknown): {
  tileHashes: unknown[];
  dirtyRegions: unknown[];
  cascadeStages: unknown[];
} | null {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const tileHashes = Array.isArray(record.tileHashes) ? record.tileHashes : [];
  const dirtyRegions = Array.isArray(record.dirtyRegions) ? record.dirtyRegions : [];
  const cascadeStages = Array.isArray(record.cascadeStages) ? record.cascadeStages : [];
  if (!tileHashes.length && !dirtyRegions.length && !cascadeStages.length) {
    return null;
  }
  return {
    tileHashes: tileHashes.slice(0, 512),
    dirtyRegions: dirtyRegions.slice(0, 128),
    cascadeStages: cascadeStages.slice(0, 32)
  };
}

export function summarizeCapabilityObservation(kind: ComputerSessionObservationKind, output: unknown): Record<string, unknown> {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  if (kind === "ocr") {
    const text = readTextFromCapabilityOutput(output) ?? "";
    return {
      ok: record.ok,
      textLength: text.length,
      preview: text.slice(0, 500),
      perceptionGraphId: readPerceptionGraphIdFromCapabilityOutput(output),
      metadata: record.metadata
    };
  }
  if (kind === "screen") {
    const text = readScreenTextFromCapabilityOutput(output) ?? "";
    return {
      ok: record.ok,
      textLength: text.length,
      preview: text.slice(0, 500),
      perceptionGraphId: readPerceptionGraphIdFromCapabilityOutput(output),
      dirtyRegionCount: Array.isArray(record.dirtyRegions) ? record.dirtyRegions.length : undefined,
      cascadeStageCount: Array.isArray(record.cascadeStages) ? record.cascadeStages.length : undefined,
      hasOutput: record.output !== undefined
    };
  }
  if (kind === "terminal") {
    return {
      ok: record.ok,
      exitCode: record.exitCode,
      stdoutLength: typeof record.stdout === "string" ? record.stdout.length : undefined,
      stderrLength: typeof record.stderr === "string" ? record.stderr.length : undefined
    };
  }
  return {
    ok: record.ok,
    status: record.status,
    verification: record.capabilityVerification ?? record.verification,
    outputKeys: Object.keys(record).slice(0, 20)
  };
}
