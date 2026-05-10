import { createHash } from "node:crypto";
import type { Rect } from "../types.js";

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function trimField(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function clampNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function hashStable(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeRect(value: unknown): Rect | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  const rect = {
    x: Math.round(clampNumber(record.x, 0)),
    y: Math.round(clampNumber(record.y, 0)),
    w: Math.round(clampNumber(record.w ?? record.width, 0)),
    h: Math.round(clampNumber(record.h ?? record.height, 0))
  };
  return rect.w > 0 && rect.h > 0 ? rect : undefined;
}
