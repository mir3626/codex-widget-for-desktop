import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ClientMessage, WidgetMode } from "../../shared/protocol.js";
import type { LogLine, TerminalKeyName, TerminalLine } from "../types";
import {
  clampTerminalLine,
  limitTerminalLines,
  normalizeTerminalText,
  summarizeTerminalCompletion,
  terminalKeyToInput,
  terminalKeyToLabel
} from "../utils/terminal";

type UseTerminalControllerInput = {
  daemonPort: string;
  send(message: ClientMessage): boolean;
  appendLog(text: string, tone: LogLine["tone"]): void;
  setMode(mode: WidgetMode): void;
};

export function useTerminalController(input: UseTerminalControllerInput) {
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalMouseEnabled, setTerminalMouseEnabled] = useState(false);
  const [showTerminalGuide, setShowTerminalGuide] = useState(() => readInitialTerminalGuideState());
  const terminalRequestIdsRef = useRef<Set<string>>(new Set());
  const terminalOutputRequestIdsRef = useRef<Set<string>>(new Set());
  const terminalOutputOpenRef = useRef(false);

  function registerTerminalRequest(id: string, command: string, echoCommand = true) {
    terminalRequestIdsRef.current.add(id);
    terminalOutputRequestIdsRef.current.delete(id);
    terminalOutputOpenRef.current = false;
    if (echoCommand) {
      appendTerminalLine("command", command);
    }
  }

  function appendTerminalLine(kind: TerminalLine["kind"], text: string) {
    const normalizedLines = normalizeTerminalText(text)
      .split("\n")
      .map((line) => clampTerminalLine(line))
      .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);

    if (normalizedLines.length === 0) {
      return;
    }

    terminalOutputOpenRef.current = false;
    setTerminalLines((current) =>
      limitTerminalLines([
        ...current,
        ...normalizedLines.map((line) => ({
          id: crypto.randomUUID(),
          text: line,
          kind
        }))
      ])
    );
  }

  function appendTerminalOutput(id: string, chunk: string) {
    const normalized = normalizeTerminalText(chunk);
    if (!normalized) {
      return;
    }

    terminalOutputRequestIdsRef.current.add(id);
    setTerminalLines((current) => {
      const next = [...current];
      const parts = normalized.split("\n");
      const firstPart = clampTerminalLine(parts[0] ?? "");
      if (terminalOutputOpenRef.current && next.length > 0 && next[next.length - 1].kind === "output") {
        const last = next[next.length - 1];
        next[next.length - 1] = {
          ...last,
          text: clampTerminalLine(`${last.text}${firstPart}`)
        };
      } else if (firstPart || parts.length > 1) {
        next.push({ id: crypto.randomUUID(), text: firstPart, kind: "output" });
      }

      for (let index = 1; index < parts.length; index += 1) {
        const text = clampTerminalLine(parts[index] ?? "");
        if (text || index < parts.length - 1) {
          next.push({ id: crypto.randomUUID(), text, kind: "output" });
        }
      }

      terminalOutputOpenRef.current = !normalized.endsWith("\n");
      return limitTerminalLines(next);
    });
  }

  function completeTerminalRequest(id: string, text: string) {
    if (!terminalRequestIdsRef.current.has(id)) {
      return;
    }

    const sawOutput = terminalOutputRequestIdsRef.current.has(id);
    const summary = summarizeTerminalCompletion(text, sawOutput);
    if (summary) {
      appendTerminalLine(sawOutput ? "system" : "output", summary);
    }
    terminalRequestIdsRef.current.delete(id);
    terminalOutputRequestIdsRef.current.delete(id);
    terminalOutputOpenRef.current = false;
  }

  function clearTerminalViewport() {
    terminalOutputOpenRef.current = false;
    terminalOutputRequestIdsRef.current.clear();
    setTerminalLines([]);
    input.appendLog("terminal cleared", "muted");
  }

  function resetTerminalState() {
    terminalRequestIdsRef.current.clear();
    terminalOutputRequestIdsRef.current.clear();
    terminalOutputOpenRef.current = false;
    setTerminalLines([]);
  }

  function openTerminalPopout() {
    input.setMode("terminal");
    const url = new URL(window.location.href);
    url.searchParams.set("daemonPort", input.daemonPort);
    url.searchParams.set("mode", "terminal");
    url.searchParams.set("surface", "pty");
    const popup = window.open(url.toString(), "codex-widget-pty", "popup,width=920,height=640");
    input.appendLog(popup ? "pty popup opened" : "pty popup blocked", popup ? "tool" : "error");
  }

  function sendTerminalRawInput(data: string, label: string) {
    const id = crypto.randomUUID();
    return input.send({
      type: "terminal.input",
      id,
      data,
      label
    });
  }

  function sendTerminalInput() {
    const text = terminalInput.trimEnd();
    if (!text) {
      return;
    }

    if (sendTerminalRawInput(`${text}\r`, text)) {
      setTerminalInput("");
    }
  }

  function sendTerminalKey(name: TerminalKeyName) {
    sendTerminalRawInput(terminalKeyToInput(name), terminalKeyToLabel(name));
  }

  return {
    terminalLines,
    terminalInput,
    setTerminalInput,
    terminalMouseEnabled,
    setTerminalMouseEnabled,
    showTerminalGuide,
    setShowTerminalGuide: setShowTerminalGuide as Dispatch<SetStateAction<boolean>>,
    terminalRequestIdsRef,
    terminalOutputRequestIdsRef,
    terminalOutputOpenRef,
    registerTerminalRequest,
    appendTerminalLine,
    appendTerminalOutput,
    completeTerminalRequest,
    clearTerminalViewport,
    resetTerminalState,
    openTerminalPopout,
    sendTerminalRawInput,
    sendTerminalInput,
    sendTerminalKey
  };
}

function readInitialTerminalGuideState(): boolean {
  return new URLSearchParams(window.location.search).get("mode") === "terminal";
}
