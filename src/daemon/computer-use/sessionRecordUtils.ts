export function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readBooleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

export function readStringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return items.length ? items : undefined;
}

export function readRecordId(value: unknown): string | undefined {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string"
    ? (value as Record<string, unknown>).id as string
    : undefined;
}

export function readUnknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
