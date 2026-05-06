import { CircleDot, Mic, Send } from "lucide-react";
import type { FormEvent, KeyboardEvent, PointerEvent, RefObject } from "react";

type PromptComposerProps = {
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  connected: boolean;
  busy: boolean;
  voiceListening: boolean;
  voiceInputAvailable: boolean;
  onValueChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocusFromRow: (event: PointerEvent<HTMLFormElement>) => void;
  onBeginResize: (event: PointerEvent<HTMLDivElement>) => void;
  onUpdateResize: (event: PointerEvent<HTMLDivElement>) => void;
  onFinishResize: (event: PointerEvent<HTMLDivElement>) => void;
  onToggleVoice: () => void;
  onCancel: () => void;
};

export function PromptComposer({
  promptInputRef,
  value,
  connected,
  busy,
  voiceListening,
  voiceInputAvailable,
  onValueChange,
  onSubmit,
  onPromptKeyDown,
  onFocusFromRow,
  onBeginResize,
  onUpdateResize,
  onFinishResize,
  onToggleVoice,
  onCancel
}: PromptComposerProps) {
  return (
    <form className="prompt-row" onPointerDownCapture={onFocusFromRow} onSubmit={onSubmit}>
      <div
        className="prompt-resize-handle"
        role="separator"
        aria-label="Resize prompt"
        aria-orientation="horizontal"
        onPointerDown={onBeginResize}
        onPointerMove={onUpdateResize}
        onPointerUp={onFinishResize}
        onPointerCancel={onFinishResize}
      />
      <textarea
        ref={promptInputRef}
        rows={1}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onPromptKeyDown}
        placeholder="Ask Codex"
        disabled={!connected}
        aria-label="Ask Codex"
      />
      <button
        type="button"
        className={voiceListening ? "voice-button active" : "voice-button"}
        title={voiceInputAvailable ? (voiceListening ? "Stop voice prompt" : "Voice prompt") : "Voice prompt unavailable"}
        aria-label="Voice prompt"
        aria-pressed={voiceListening}
        disabled={!voiceInputAvailable || busy}
        onClick={onToggleVoice}
      >
        <Mic size={15} />
      </button>
      {busy ? (
        <button type="button" className="send-button stop" title="Stop" aria-label="Stop response" onClick={onCancel}>
          <CircleDot size={17} />
        </button>
      ) : (
        <button type="submit" className="send-button" title="Send" aria-label="Send prompt" disabled={!connected || !value.trim()}>
          <Send size={17} />
        </button>
      )}
    </form>
  );
}
