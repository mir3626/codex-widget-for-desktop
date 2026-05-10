import { readRecord } from "./records.js";

export function readFileChangePaths(item: Record<string, unknown> | undefined): string[] {
  if (!item) {
    return [];
  }

  const candidates: string[] = [];
  for (const key of ["path", "file", "filePath", "targetPath"]) {
    const value = item[key];
    if (typeof value === "string") {
      candidates.push(value);
    }
  }

  for (const key of ["paths", "files", "filePaths", "changes"]) {
    const value = item[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (typeof entry === "string") {
        candidates.push(entry);
        continue;
      }
      const record = readRecord(entry);
      for (const nestedKey of ["path", "file", "filePath", "targetPath"]) {
        const nested = record?.[nestedKey];
        if (typeof nested === "string") {
          candidates.push(nested);
        }
      }
    }
  }

  return [...new Set(candidates.map((path) => path.trim()).filter(Boolean))].slice(0, 20);
}

export function readFileChangeId(item: Record<string, unknown> | undefined, fallback: string): string {
  for (const key of ["id", "changeId", "itemId"]) {
    const value = item?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

export function readFileChangeTitle(item: Record<string, unknown> | undefined, phase: "before" | "after"): string {
  for (const key of ["title", "summary", "description"]) {
    const value = item?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  const paths = readFileChangePaths(item);
  return paths.length === 1 ? `File ${phase}: ${paths[0]}` : "File change";
}

export function readFileChangeOperation(item: Record<string, unknown> | undefined): "create" | "modify" | "delete" {
  const operation = typeof item?.operation === "string" ? item.operation.toLowerCase() : "";
  const kind = typeof item?.kind === "string" ? item.kind.toLowerCase() : "";
  const changeType = typeof item?.changeType === "string" ? item.changeType.toLowerCase() : "";
  const combined = `${operation} ${kind} ${changeType}`;
  if (/\b(delete|remove|unlink)\b/.test(combined)) {
    return "delete";
  }
  if (/\b(create|add|new)\b/.test(combined)) {
    return "create";
  }
  return "modify";
}

export function pickFileChangeDetail(item: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!item) {
    return {};
  }
  const detail: Record<string, unknown> = {};
  for (const key of ["id", "type", "operation", "kind", "changeType", "summary", "description"]) {
    if (item[key] !== undefined) {
      detail[key] = item[key];
    }
  }
  return detail;
}
