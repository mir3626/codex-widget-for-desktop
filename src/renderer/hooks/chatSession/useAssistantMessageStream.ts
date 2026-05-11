import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { STREAM_TYPE_BASE_INTERVAL_MS } from "../../config";
import type { AssistantMessageStatus, ChatMessage } from "../../types";
import {
  ensureAssistantMessage,
  getNextTypingLength,
  getTypingDelay,
  isAssistantWorking,
  snapshotStatusToAssistantStatus
} from "../../utils/chat";
import type { MessageSnapshotStatus } from "../../../shared/protocol.js";

type UseAssistantMessageStreamInput = {
  chatMessagesRef: MutableRefObject<ChatMessage[]>;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setActiveId: Dispatch<SetStateAction<string | null>>;
};

export function useAssistantMessageStream({
  chatMessagesRef,
  setChatMessages,
  setActiveId
}: UseAssistantMessageStreamInput) {
  const streamBuffersRef = useRef<Map<string, string>>(new Map());
  const completedResponseIdsRef = useRef<Set<string>>(new Set());
  const streamTypingTimerRef = useRef<number | null>(null);

  function appendAssistantDelta(id: string, text: string) {
    if (!text) {
      return;
    }

    streamBuffersRef.current.set(id, `${streamBuffersRef.current.get(id) ?? ""}${text}`);
    setChatMessages((current) =>
      ensureAssistantMessage(current, id).map((message) =>
        message.role === "assistant" && message.id === id && message.status !== "tooling"
          ? { ...message, status: "streaming" }
          : message
      )
    );
    scheduleAssistantTyping();
  }

  function completeAssistantMessage(id: string, text: string) {
    const existingBuffer = streamBuffersRef.current.get(id);
    const shouldApplyImmediately = text && (existingBuffer === undefined || existingBuffer.length === 0);
    if (text) {
      streamBuffersRef.current.set(id, text);
    } else if (!streamBuffersRef.current.has(id)) {
      streamBuffersRef.current.set(id, "");
    }
    completedResponseIdsRef.current.add(id);
    setChatMessages((current) =>
      ensureAssistantMessage(current, id).map((message) => {
        if (message.role !== "assistant" || message.id !== id) {
          return message;
        }
        const replacesVisibleText = Boolean(text && message.text && !text.startsWith(message.text));
        return shouldApplyImmediately || replacesVisibleText ? { ...message, text, status: "done" } : message;
      })
    );
    scheduleAssistantTyping();
  }

  function applyAssistantSnapshot(id: string, text: string, status: MessageSnapshotStatus) {
    streamBuffersRef.current.set(id, text);
    if (status === "done") {
      completedResponseIdsRef.current.add(id);
    } else {
      completedResponseIdsRef.current.delete(id);
    }

    const nextStatus = snapshotStatusToAssistantStatus(status);
    setChatMessages((current) =>
      ensureAssistantMessage(current, id).map((message) =>
        message.role === "assistant" && message.id === id
          ? {
              ...message,
              text,
              status: nextStatus
            }
          : message
      )
    );

    setActiveId((current) => {
      if (isAssistantWorking(nextStatus)) {
        return id;
      }
      return current === id ? null : current;
    });
  }

  function restoreMessageBuffers(messages: ChatMessage[]) {
    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }

      streamBuffersRef.current.set(message.id, message.text);
      if (message.status === "done") {
        completedResponseIdsRef.current.add(message.id);
      }
    }
  }

  function clearAssistantMessageStream() {
    streamBuffersRef.current.clear();
    completedResponseIdsRef.current.clear();
  }

  function cleanupAssistantMessageStream() {
    if (streamTypingTimerRef.current !== null) {
      window.clearTimeout(streamTypingTimerRef.current);
    }
  }

  function scheduleAssistantTyping(delay = STREAM_TYPE_BASE_INTERVAL_MS) {
    if (streamTypingTimerRef.current !== null) {
      return;
    }

    streamTypingTimerRef.current = window.setTimeout(runAssistantTypingStep, delay);
  }

  function runAssistantTypingStep() {
    streamTypingTimerRef.current = null;
    let hasMore = false;
    let changed = false;
    let nextDelay = STREAM_TYPE_BASE_INTERVAL_MS;

    const nextMessages: ChatMessage[] = chatMessagesRef.current.map((message): ChatMessage => {
      if (message.role !== "assistant") {
        return message;
      }

      const target = streamBuffersRef.current.get(message.id) ?? message.text;
      const isCompleted = completedResponseIdsRef.current.has(message.id);
      if (message.text.length < target.length) {
        const remaining = target.length - message.text.length;
        const nextLength = getNextTypingLength(target, message.text.length, remaining, isCompleted);
        hasMore = hasMore || nextLength < target.length || nextLength === message.text.length;
        if (nextLength === message.text.length) {
          nextDelay = Math.min(nextDelay, 72);
          return message;
        }
        changed = true;
        nextDelay = Math.min(nextDelay, getTypingDelay(target.charAt(nextLength - 1), remaining));
        const nextStatus: AssistantMessageStatus =
          isCompleted && nextLength >= target.length ? "done" : isCompleted ? "typing" : "streaming";
        return {
          ...message,
          text: target.slice(0, nextLength),
          status: nextStatus
        };
      }

      if (isCompleted && message.status !== "done") {
        changed = true;
        return { ...message, status: "done" };
      }

      return message;
    });

    if (changed) {
      chatMessagesRef.current = nextMessages;
      setChatMessages(nextMessages);
    }

    if (hasMore) {
      scheduleAssistantTyping(nextDelay);
    }
  }

  return {
    streamBuffersRef,
    completedResponseIdsRef,
    appendAssistantDelta,
    applyAssistantSnapshot,
    cleanupAssistantMessageStream,
    clearAssistantMessageStream,
    completeAssistantMessage,
    restoreMessageBuffers
  };
}
