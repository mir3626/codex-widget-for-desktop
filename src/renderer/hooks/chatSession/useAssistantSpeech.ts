import { useRef, useState, type MutableRefObject } from "react";
import type { LogLine } from "../../types";
import {
  createSpeechText,
  pickSpeechLanguage,
  pickSpeechVoice
} from "../../utils/speech";

type UseAssistantSpeechInput = {
  streamBuffersRef: MutableRefObject<Map<string, string>>;
  appendLog(text: string, tone: LogLine["tone"]): void;
  closeActionMenu(): void;
};

export function useAssistantSpeech({
  streamBuffersRef,
  appendLog,
  closeActionMenu
}: UseAssistantSpeechInput) {
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const speechRunIdRef = useRef(0);

  function cancelAssistantSpeech() {
    speechRunIdRef.current += 1;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageId(null);
  }

  function stopReadAloud() {
    cancelAssistantSpeech();
    closeActionMenu();
    appendLog("reading stopped", "muted");
  }

  function readMessageAloud(id: string, fallbackText: string) {
    if (speakingMessageId === id) {
      stopReadAloud();
      return;
    }

    const text = createSpeechText(streamBuffersRef.current.get(id) ?? fallbackText);
    if (!text) {
      closeActionMenu();
      appendLog("nothing to read", "muted");
      return;
    }

    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      closeActionMenu();
      appendLog("speech unavailable", "error");
      return;
    }

    speechRunIdRef.current += 1;
    const speechRunId = speechRunIdRef.current;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = pickSpeechLanguage(text);
    utterance.voice = pickSpeechVoice(utterance.lang);
    utterance.rate = 0.94;
    utterance.pitch = 1;
    utterance.onend = () => {
      if (speechRunIdRef.current === speechRunId) {
        setSpeakingMessageId(null);
      }
    };
    utterance.onerror = () => {
      if (speechRunIdRef.current === speechRunId) {
        setSpeakingMessageId(null);
        appendLog("speech stopped", "muted");
      }
    };
    setSpeakingMessageId(id);
    window.speechSynthesis.speak(utterance);
    closeActionMenu();
    appendLog("reading response", "tool");
  }

  return {
    speakingMessageId,
    readMessageAloud,
    stopReadAloud,
    cancelAssistantSpeech
  };
}
