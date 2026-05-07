import {
  Activity,
  Ban,
  CircleStop,
  CornerDownLeft,
  ExternalLink,
  Info,
  Keyboard,
  MousePointer2,
  Play,
  Send,
  SquareTerminal,
  Trash2
} from "lucide-react";
import { FormEvent, KeyboardEvent, PointerEvent, WheelEvent, useEffect, useRef } from "react";
import type { ProviderStatus } from "../../shared/protocol.js";
import { TERMINAL_MOUSE_DRAG_INTERVAL_MS } from "../config";
import type { TerminalKeyName, TerminalLine } from "../types";
import { formatTerminalMouseSequence, readTerminalMouseCell, terminalLinePrefix } from "../utils/terminal";

type TerminalViewportProps = {
  lines: TerminalLine[];
  providerStatus: ProviderStatus | undefined;
  busy: boolean;
  onStart: () => void;
  onStatus: () => void;
  onStop: () => void;
  onClear: () => void;
  onPopout: () => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  onInputSubmit: () => void;
  onKeySend: (name: TerminalKeyName) => void;
  mouseEnabled: boolean;
  onMouseEnabledChange: (enabled: boolean) => void;
  onMouseInput: (sequence: string, label: string) => void;
  showGuide: boolean;
  onToggleGuide: () => void;
};

export function TerminalViewport({
  lines,
  providerStatus,
  busy,
  onStart,
  onStatus,
  onStop,
  onClear,
  onPopout,
  inputValue,
  onInputChange,
  onInputSubmit,
  onKeySend,
  mouseEnabled,
  onMouseEnabledChange,
  onMouseInput,
  showGuide,
  onToggleGuide
}: TerminalViewportProps) {
  const outputRef = useRef<HTMLDivElement | null>(null);
  const mouseDragRef = useRef<{ pointerId: number; buttonCode: number; col: number; row: number; sentAt: number } | null>(null);
  const providerState = providerStatus?.state ?? "unavailable";
  const providerDetail = providerStatus?.detail ?? "waiting";

  useEffect(() => {
    const output = outputRef.current;
    if (!output) {
      return;
    }
    output.scrollTop = output.scrollHeight;
  }, [lines, busy]);

  function submitInput(event: FormEvent) {
    event.preventDefault();
    onInputSubmit();
  }

  function submitInputFromKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    event.preventDefault();
    onInputSubmit();
  }

  function sendTerminalMouseEvent(buttonCode: number, col: number, row: number, final: "M" | "m", label: string) {
    onMouseInput(formatTerminalMouseSequence(buttonCode, col, row, final), label);
  }

  function beginTerminalMouse(event: PointerEvent<HTMLDivElement>) {
    if (!mouseEnabled || event.button > 2) {
      return;
    }

    event.preventDefault();
    const point = readTerminalMouseCell(event.currentTarget, event.clientX, event.clientY);
    const buttonCode = event.button;
    mouseDragRef.current = { pointerId: event.pointerId, buttonCode, ...point, sentAt: Date.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
    sendTerminalMouseEvent(buttonCode, point.col, point.row, "M", "mouse press");
  }

  function moveTerminalMouse(event: PointerEvent<HTMLDivElement>) {
    const drag = mouseDragRef.current;
    if (!mouseEnabled || !drag || drag.pointerId !== event.pointerId || event.buttons === 0) {
      return;
    }

    event.preventDefault();
    const point = readTerminalMouseCell(event.currentTarget, event.clientX, event.clientY);
    const now = Date.now();
    if (point.col === drag.col && point.row === drag.row && now - drag.sentAt < TERMINAL_MOUSE_DRAG_INTERVAL_MS) {
      return;
    }

    mouseDragRef.current = { ...drag, ...point, sentAt: now };
    sendTerminalMouseEvent(32 + drag.buttonCode, point.col, point.row, "M", "mouse drag");
  }

  function finishTerminalMouse(event: PointerEvent<HTMLDivElement>) {
    const drag = mouseDragRef.current;
    if (!mouseEnabled || !drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const point = readTerminalMouseCell(event.currentTarget, event.clientX, event.clientY);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    mouseDragRef.current = null;
    sendTerminalMouseEvent(3, point.col, point.row, "m", "mouse release");
  }

  function wheelTerminalMouse(event: WheelEvent<HTMLDivElement>) {
    if (!mouseEnabled) {
      return;
    }

    event.preventDefault();
    const point = readTerminalMouseCell(event.currentTarget, event.clientX, event.clientY);
    sendTerminalMouseEvent(event.deltaY < 0 ? 64 : 65, point.col, point.row, "M", "mouse wheel");
  }

  return (
    <section
      className={[
        "terminal-viewport",
        busy ? "is-live" : "",
        mouseEnabled ? "is-mouse-input" : "",
        showGuide ? "has-guide" : ""
      ].filter(Boolean).join(" ")}
      aria-label="Terminal viewport"
    >
      <div className="terminal-toolbar">
        <div className="terminal-title">
          <SquareTerminal size={14} />
          <strong>PTY</strong>
          <span className={`terminal-state-dot ${providerState}`} aria-hidden="true" />
          <span className="terminal-detail" data-tooltip={providerDetail}>
            {providerDetail}
          </span>
        </div>
        <div className="terminal-actions" aria-label="Terminal actions">
          <button type="button" data-tooltip="Start" aria-label="Start terminal session" disabled={busy} onClick={onStart}>
            <Play size={13} />
          </button>
          <button type="button" data-tooltip="Status" aria-label="Show terminal status" disabled={busy} onClick={onStatus}>
            <Activity size={13} />
          </button>
          <button type="button" data-tooltip="Stop" aria-label="Stop terminal session" disabled={busy} onClick={onStop}>
            <CircleStop size={13} />
          </button>
          <button type="button" data-tooltip="Clear" aria-label="Clear terminal viewport" onClick={onClear}>
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            className={showGuide ? "is-active" : ""}
            data-tooltip="PTY guide"
            aria-label="Toggle PTY guide"
            aria-pressed={showGuide}
            onClick={onToggleGuide}
          >
            <Info size={13} />
          </button>
          <button type="button" data-tooltip="Open PTY popup" aria-label="Open PTY popup" onClick={onPopout}>
            <ExternalLink size={13} />
          </button>
          <button
            type="button"
            className={mouseEnabled ? "is-active" : ""}
            data-tooltip={mouseEnabled ? "Mouse input on" : "Mouse input off"}
            aria-label={mouseEnabled ? "Disable terminal mouse input" : "Enable terminal mouse input"}
            aria-pressed={mouseEnabled}
            onClick={() => onMouseEnabledChange(!mouseEnabled)}
          >
            <MousePointer2 size={13} />
          </button>
        </div>
      </div>
      {showGuide ? (
        <div className="terminal-guide" aria-label="PTY guide">
          <div>
            <strong>When to use PTY</strong>
            <span>Live shell state, long-running commands, interactive CLIs, and direct keyboard/mouse input.</span>
          </div>
          <div>
            <strong>How it connects</strong>
            <span>The widget talks to the daemon PTY session; direct input bypasses Agent chat turns.</span>
          </div>
          <div>
            <strong>Popup boundary</strong>
            <span>Popout opens a terminal-focused widget window on the same daemon session.</span>
          </div>
        </div>
      ) : null}
      <div
        ref={outputRef}
        className={mouseEnabled ? "terminal-output is-mouse-input" : "terminal-output"}
        role="log"
        aria-live="polite"
        aria-label="Terminal output"
        onPointerDown={beginTerminalMouse}
        onPointerMove={moveTerminalMouse}
        onPointerUp={finishTerminalMouse}
        onPointerCancel={finishTerminalMouse}
        onWheel={wheelTerminalMouse}
      >
        {lines.length === 0 ? (
          <div className="terminal-empty">No terminal output</div>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`terminal-line ${line.kind}`}>
              <span className="terminal-prefix" aria-hidden="true">
                {terminalLinePrefix(line.kind)}
              </span>
              <span className="terminal-line-text">{line.text || " "}</span>
            </div>
          ))
        )}
        {busy ? (
          <div className="terminal-line system terminal-working">
            <span className="terminal-prefix" aria-hidden="true">
              *
            </span>
            <span className="terminal-line-text">working</span>
          </div>
        ) : null}
      </div>
      <form className="terminal-input-row" aria-label="PTY raw input" onSubmit={submitInput}>
        <Keyboard size={13} aria-hidden="true" />
        <input
          value={inputValue}
          placeholder="Send PTY input"
          aria-label="PTY text input"
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={submitInputFromKey}
        />
        <button type="button" data-tooltip="Tab" aria-label="Send Tab key" onClick={() => onKeySend("tab")}>
          Tab
        </button>
        <button type="button" data-tooltip="Escape" aria-label="Send Escape key" onClick={() => onKeySend("escape")}>
          Esc
        </button>
        <button type="button" data-tooltip="Ctrl+C" aria-label="Send Ctrl+C" onClick={() => onKeySend("ctrl-c")}>
          <Ban size={12} />
        </button>
        <button type="button" data-tooltip="Enter" aria-label="Send Enter key" onClick={() => onKeySend("enter")}>
          <CornerDownLeft size={12} />
        </button>
        <button type="submit" data-tooltip="Send input" aria-label="Send PTY text" disabled={!inputValue.trim()}>
          <Send size={12} />
        </button>
      </form>
    </section>
  );
}
