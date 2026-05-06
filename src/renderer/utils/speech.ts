import type { SpeechRecognitionConstructor } from "../types";

export function createSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " image ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>|]/g, " ")
    .replace(/([.!?。！？])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickSpeechLanguage(text: string): string {
  if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text)) {
    return "ko-KR";
  }
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(text)) {
    return "ja-JP";
  }
  return navigator.language || "en-US";
}

export function pickSpeechVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => voice.lang === lang) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) ??
    null
  );
}

export function canUseVoiceInput(): boolean {
  return Boolean(readSpeechRecognitionConstructor());
}

export function readSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}
