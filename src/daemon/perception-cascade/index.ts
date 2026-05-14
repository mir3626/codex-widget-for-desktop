import { createHash } from "node:crypto";
import type { RoiCascadeStageSummary, RoiDirtyRegion } from "../../shared/protocol.js";

export type TileHash = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hash: string;
};

export function computeTileHashes(input: {
  bytes: Buffer | string;
  width: number;
  height: number;
  tileSize?: number;
}): TileHash[] {
  const tileSize = Math.max(16, Math.floor(input.tileSize ?? 128));
  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
  const tiles: TileHash[] = [];
  for (let y = 0; y < input.height; y += tileSize) {
    for (let x = 0; x < input.width; x += tileSize) {
      const w = Math.min(tileSize, input.width - x);
      const h = Math.min(tileSize, input.height - y);
      const salt = `${x}:${y}:${w}:${h}`;
      const start = Math.floor((y * input.width + x) / Math.max(1, input.width * input.height) * bytes.length);
      const end = Math.min(bytes.length, start + Math.max(64, Math.floor(bytes.length / Math.max(1, Math.ceil(input.width / tileSize) * Math.ceil(input.height / tileSize)))));
      tiles.push({ id: `tile:${x}:${y}`, x, y, w, h, hash: hash(Buffer.concat([Buffer.from(salt), bytes.subarray(start, end)])) });
    }
  }
  return tiles;
}

export function diffTileHashes(before: TileHash[] | undefined, after: TileHash[]): RoiDirtyRegion[] {
  const previous = new Map((before ?? []).map((tile) => [tile.id, tile]));
  return after
    .filter((tile) => previous.get(tile.id)?.hash !== tile.hash)
    .map((tile) => ({
      id: `roi:${tile.id}`,
      bbox: { x: tile.x, y: tile.y, w: tile.w, h: tile.h },
      changedPixelsEstimate: tile.w * tile.h,
      diffRatio: 1,
      hashBefore: previous.get(tile.id)?.hash,
      hashAfter: tile.hash
    }));
}

export function planPerceptionCascade(input: {
  cachedGraphConfidence?: number;
  domOrUiaConfidence?: number;
  dirtyRegions: RoiDirtyRegion[];
  requiresText?: boolean;
  requiresVisualParser?: boolean;
  startedAt?: number;
}): RoiCascadeStageSummary[] {
  const startedAt = input.startedAt ?? Date.now();
  const stages: RoiCascadeStageSummary[] = [];
  const cached = input.cachedGraphConfidence ?? 0;
  stages.push(stage("cached_graph", cached >= 0.72 ? "hit" : "miss", cached, startedAt, cached >= 0.72 ? "fresh graph evidence is sufficient" : "cached graph confidence below early-exit threshold"));
  if (cached >= 0.72 && !input.requiresText && !input.requiresVisualParser) {
    return stages;
  }
  const dom = input.domOrUiaConfidence ?? 0;
  stages.push(stage("dom_uia_observe", dom >= 0.68 ? "hit" : "miss", dom, startedAt, dom >= 0.68 ? "DOM/UIA evidence is sufficient" : "DOM/UIA evidence needs ROI fallback"));
  if (dom >= 0.68 && input.dirtyRegions.length === 0 && !input.requiresVisualParser) {
    return stages;
  }
  stages.push(stage("tile_diff", input.dirtyRegions.length > 0 ? "completed" : "skipped", input.dirtyRegions.length > 0 ? 0.8 : 0.4, startedAt, `${input.dirtyRegions.length} dirty regions`));
  stages.push(stage("roi_ocr", input.requiresText || input.dirtyRegions.length > 0 ? "completed" : "skipped", input.requiresText ? 0.7 : 0.55, startedAt));
  stages.push(stage("text_detector", input.requiresText ? "completed" : "skipped", input.requiresText ? 0.66 : 0.5, startedAt));
  stages.push(stage("recognizer", input.requiresText ? "completed" : "skipped", input.requiresText ? 0.66 : 0.5, startedAt));
  stages.push(stage("gui_parser", input.requiresVisualParser ? "completed" : "skipped", input.requiresVisualParser ? 0.62 : 0.5, startedAt));
  const finalConfidence = Math.max(cached, dom, input.requiresText ? 0.66 : 0, input.requiresVisualParser ? 0.62 : 0);
  stages.push(stage("vlm_fallback", finalConfidence < 0.58 ? "completed" : "skipped", finalConfidence < 0.58 ? 0.55 : finalConfidence, startedAt, finalConfidence < 0.58 ? "confidence below local cascade threshold" : "local cascade reached early-exit confidence"));
  return stages;
}

function stage(name: RoiCascadeStageSummary["name"], status: RoiCascadeStageSummary["status"], confidence: number, startedAt: number, reason?: string): RoiCascadeStageSummary {
  return {
    name,
    status,
    confidence: Math.min(1, Math.max(0, confidence)),
    elapsedMs: Math.max(0, Date.now() - startedAt),
    reason
  };
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
