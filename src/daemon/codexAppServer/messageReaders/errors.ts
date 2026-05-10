import { readRecord } from "./records.js";

export function readTurnError(value: unknown): string | undefined {
  const error = readRecord(value);
  if (!error) {
    return undefined;
  }
  if (typeof error.message === "string") {
    return error.message;
  }
  if (typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

export function readErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function isRetryableThreadError(value: unknown): boolean {
  const message = readErrorMessage(value).toLowerCase();
  return (
    message.includes("thread") &&
    (message.includes("not found") ||
      message.includes("unknown") ||
      message.includes("invalid") ||
      message.includes("does not exist") ||
      message.includes("closed"))
  );
}
