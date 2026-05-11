import type {
  Dispatch,
  FormEvent,
  KeyboardEvent,
  PointerEvent,
  RefObject,
  SetStateAction
} from "react";
import type { WidgetMode } from "../../shared/protocol.js";

type UsePromptSubmissionInput = {
  input: string;
  mode: WidgetMode;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  setInput: Dispatch<SetStateAction<string>>;
  startAsk: (text: string, mode: WidgetMode) => boolean;
};

export function usePromptSubmission({
  input,
  mode,
  promptInputRef,
  setInput,
  startAsk
}: UsePromptSubmissionInput) {
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!startAsk(text, mode)) {
      return;
    }

    setInput("");
  }

  function submitFromPromptKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function focusPromptInput(event: PointerEvent<HTMLFormElement>) {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button, .prompt-resize-handle")) {
      return;
    }

    window.requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
  }

  return {
    focusPromptInput,
    submit,
    submitFromPromptKey
  };
}
