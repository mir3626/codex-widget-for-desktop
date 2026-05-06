import type { MessageSnapshotStatus, SessionMessage } from "../../shared/protocol.js";
import { STREAM_TYPE_BASE_INTERVAL_MS } from "../config";
import type { AssistantMessageStatus, ChatMessage } from "../types";

export function ensureAssistantMessage(messages: ChatMessage[], id: string): ChatMessage[] {
  if (messages.some((message) => message.id === id)) {
    return messages;
  }
  return [
    ...messages,
    {
      id,
      role: "assistant",
      text: "",
      status: "pending"
    }
  ];
}

export function sessionMessageToChatMessage(message: SessionMessage): ChatMessage {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      text: message.text
    };
  }
  return {
    id: message.id,
    role: "assistant",
    text: message.text,
    status: snapshotStatusToAssistantStatus(message.status ?? "done")
  };
}

export function readWorkingAssistantId(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && isAssistantWorking(message.status)) {
      return message.id;
    }
  }
  return null;
}

export function formatSessionTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 22 ? `${trimmed.slice(0, 18)}...` : trimmed || "Untitled";
}

export function findPreviousUserMessage(messages: ChatMessage[], startIndex: number): Extract<ChatMessage, { role: "user" }> | null {
  for (let index = Math.min(startIndex - 1, messages.length - 1); index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return message;
    }
  }
  return null;
}

export function getNextTypingLength(text: string, currentLength: number, remaining: number, isCompleted: boolean): number {
  const atomicEnd = readAtomicTokenEnd(text, currentLength, isCompleted);
  if (atomicEnd !== null) {
    return atomicEnd;
  }

  const nextLength = Math.min(text.length, currentLength + getTypingStepSize(remaining));
  const atomicStart = findAtomicTokenStart(text, currentLength + 1, nextLength);
  return atomicStart ?? nextLength;
}

function findAtomicTokenStart(text: string, start: number, end: number): number | null {
  for (let index = start; index < end; index += 1) {
    if (isAtomicTokenStart(text, index)) {
      return index;
    }
  }
  return null;
}

function readAtomicTokenEnd(text: string, start: number, isCompleted: boolean): number | null {
  if (text.charAt(start) === "!" && text.charAt(start + 1) === "[") {
    const imageEnd = readMarkdownLinkEnd(text, start + 1);
    return imageEnd ?? (isCompleted ? null : start);
  }
  if (text.charAt(start) === "[") {
    const linkEnd = readMarkdownLinkEnd(text, start);
    return linkEnd ?? (isCompleted ? null : start);
  }
  if (isAutoUrlStart(text, start)) {
    return readAutoUrlEnd(text, start, isCompleted);
  }
  return null;
}

function isAtomicTokenStart(text: string, start: number): boolean {
  return (
    text.charAt(start) === "[" ||
    (text.charAt(start) === "!" && text.charAt(start + 1) === "[") ||
    isAutoUrlStart(text, start)
  );
}

function readMarkdownLinkEnd(text: string, start: number): number | null {
  if (text.charAt(start) !== "[") {
    return null;
  }

  let labelEnd = start + 1;
  while (labelEnd < text.length) {
    labelEnd = text.indexOf("]", labelEnd);
    if (labelEnd < 0) {
      return null;
    }
    if (text.charAt(labelEnd - 1) === "\\") {
      labelEnd += 1;
      continue;
    }
    break;
  }

  if (text.charAt(labelEnd + 1) !== "(") {
    return null;
  }

  const urlEnd = text.indexOf(")", labelEnd + 2);
  return urlEnd > labelEnd ? urlEnd + 1 : null;
}

function isAutoUrlStart(text: string, start: number): boolean {
  return text.startsWith("https://", start) || text.startsWith("http://", start);
}

function readAutoUrlEnd(text: string, start: number, isCompleted: boolean): number | null {
  if (!isAutoUrlStart(text, start)) {
    return null;
  }

  const rest = text.slice(start);
  const boundary = /[\s<>"`]/.exec(rest);
  if (!boundary && !isCompleted) {
    return start;
  }

  let end = boundary ? start + boundary.index : text.length;
  while (end > start && /[.,;:!?)]/.test(text.charAt(end - 1))) {
    end -= 1;
  }
  return end > start ? end : null;
}

function getTypingStepSize(remaining: number): number {
  if (remaining > 900) {
    return 6;
  }
  if (remaining > 360) {
    return 4;
  }
  if (remaining > 120) {
    return 3;
  }
  if (remaining > 32) {
    return 2;
  }
  return 1;
}

export function getTypingDelay(character: string, remaining: number): number {
  if (remaining > 360) {
    return 12;
  }
  if (character === "\n") {
    return 62;
  }
  if (/[.!?。！？]$/.test(character)) {
    return 76;
  }
  if (/[,;:，、]$/.test(character)) {
    return 42;
  }
  if (character === " ") {
    return 14;
  }
  return STREAM_TYPE_BASE_INTERVAL_MS;
}

export function isAssistantWorking(status: AssistantMessageStatus): boolean {
  return status === "pending" || status === "thinking" || status === "tooling" || status === "streaming" || status === "typing";
}

export function snapshotStatusToAssistantStatus(status: MessageSnapshotStatus): AssistantMessageStatus {
  return status === "done" ||
    status === "cancelled" ||
    status === "error" ||
    status === "thinking" ||
    status === "tooling" ||
    status === "streaming"
    ? status
    : "pending";
}

export function assistantStatusLabel(status: AssistantMessageStatus): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "thinking":
      return "Thinking";
    case "tooling":
      return "Working";
    case "streaming":
      return "Streaming";
    case "typing":
      return "Typing";
    case "cancelled":
      return "Stopped";
    case "error":
      return "Error";
    case "done":
    default:
      return "Done";
  }
}

export function assistantFallbackText(status: AssistantMessageStatus): string {
  if (status === "cancelled") {
    return "Stopped before a response was returned.";
  }
  if (status === "error") {
    return "The response could not be completed.";
  }
  return "";
}
