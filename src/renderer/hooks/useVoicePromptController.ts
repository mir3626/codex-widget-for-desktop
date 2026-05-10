import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { LogLine, SpeechRecognitionLike } from "../types";
import { readSpeechRecognitionConstructor } from "../utils/speech";

type UseVoicePromptControllerInput = {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  appendLog(text: string, tone: LogLine["tone"]): void;
};

export function useVoicePromptController(input: UseVoicePromptControllerInput) {
  const [voiceListening, setVoiceListening] = useState(false);
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voicePromptBaseRef = useRef("");

  function toggleVoicePromptInput() {
    if (voiceListening) {
      stopVoicePromptInput();
      return;
    }
    startVoicePromptInput();
  }

  function startVoicePromptInput() {
    const Recognition = readSpeechRecognitionConstructor();
    if (!Recognition) {
      input.appendLog("voice input unavailable", "error");
      return;
    }

    stopVoicePromptInput(false);
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    voicePromptBaseRef.current = input.input.trimEnd();
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
      }
      const separator = voicePromptBaseRef.current && transcript.trim() ? " " : "";
      input.setInput(`${voicePromptBaseRef.current}${separator}${transcript}`.trimStart());
    };
    recognition.onerror = (event) => {
      input.appendLog(event.error ? `voice input ${event.error}` : "voice input failed", "error");
    };
    recognition.onend = () => {
      if (voiceRecognitionRef.current === recognition) {
        voiceRecognitionRef.current = null;
      }
      setVoiceListening(false);
    };
    voiceRecognitionRef.current = recognition;
    setVoiceListening(true);
    try {
      recognition.start();
    } catch (error) {
      voiceRecognitionRef.current = null;
      setVoiceListening(false);
      input.appendLog(error instanceof Error ? error.message : "voice input failed", "error");
    }
  }

  function stopVoicePromptInput(updateState = true) {
    const recognition = voiceRecognitionRef.current;
    voiceRecognitionRef.current = null;
    if (recognition) {
      recognition.stop();
    }
    if (updateState) {
      setVoiceListening(false);
    }
  }

  function cleanupVoicePrompt() {
    voiceRecognitionRef.current?.abort();
    voiceRecognitionRef.current = null;
  }

  return {
    voiceListening,
    toggleVoicePromptInput,
    startVoicePromptInput,
    stopVoicePromptInput,
    cleanupVoicePrompt
  };
}
