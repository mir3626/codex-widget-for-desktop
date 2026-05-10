import type { RuntimeInteraction } from "../../../shared/protocol.js";
import { readRecord } from "./records.js";

export function readInteractionReason(
  primary: Record<string, unknown> | undefined,
  secondary: Record<string, unknown> | undefined,
  fallback: string
): string {
  for (const record of [primary, secondary]) {
    if (!record) {
      continue;
    }

    for (const key of ["reason", "message", "description", "prompt", "summary"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return fallback;
}

export function readInputTitle(params: Record<string, unknown> | undefined): string {
  const title = params?.title;
  return typeof title === "string" && title.trim() ? title.trim() : "Input required";
}

export function readInputFields(params: Record<string, unknown> | undefined): RuntimeInteraction["fields"] {
  const rawFields = params?.fields;
  if (Array.isArray(rawFields)) {
    const fields = rawFields.flatMap((field, index) => {
      const record = readRecord(field);
      if (!record) {
        return [];
      }

      const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `answer_${index + 1}`;
      const label =
        typeof record.label === "string" && record.label.trim()
          ? record.label.trim()
          : typeof record.name === "string" && record.name.trim()
            ? record.name.trim()
            : `Answer ${index + 1}`;
      const placeholder =
        typeof record.placeholder === "string" && record.placeholder.trim() ? record.placeholder.trim() : undefined;

      return [{ id, label, placeholder, multiline: record.multiline === true }];
    });

    if (fields.length > 0) {
      return fields;
    }
  }

  return [{
    id: "answer",
    label: "Response",
    placeholder: "Type a response for Codex",
    multiline: true
  }];
}

export function describeToolItem(item: Record<string, unknown> | undefined): { name: string; label: string } | undefined {
  if (!item || typeof item.type !== "string" || typeof item.id !== "string") {
    return undefined;
  }

  if (item.type === "commandExecution") {
    return {
      name: item.id,
      label: typeof item.command === "string" ? item.command : "Command"
    };
  }
  if (item.type === "fileChange") {
    return { name: item.id, label: "File change" };
  }
  if (item.type === "mcpToolCall") {
    return {
      name: item.id,
      label: [item.server, item.tool].filter((value) => typeof value === "string").join(" / ") || "MCP tool"
    };
  }
  if (item.type === "dynamicToolCall") {
    return {
      name: item.id,
      label: [item.namespace, item.tool].filter((value) => typeof value === "string").join(" / ") || "Tool"
    };
  }
  if (item.type === "webSearch") {
    return {
      name: item.id,
      label: typeof item.query === "string" ? `Web search: ${item.query}` : "Web search"
    };
  }

  return undefined;
}
