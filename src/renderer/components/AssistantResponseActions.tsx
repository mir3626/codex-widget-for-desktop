import { Bug, CircleStop, Copy, MoreHorizontal, RotateCw, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFloatingSurface } from "../hooks/useFloatingSurface";

type AssistantResponseActionsProps = {
  messageId: string;
  open: boolean;
  disabled: boolean;
  speaking: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  onSaveDebugLog: (reason: string) => void;
  onToggle: () => void;
  onBranch: () => void;
  onReadAloud: () => void;
};

export function AssistantResponseActions({
  messageId,
  open,
  disabled,
  speaking,
  onCopy,
  onRegenerate,
  onSaveDebugLog,
  onToggle,
  onBranch,
  onReadAloud
}: AssistantResponseActionsProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugReason, setDebugReason] = useState("");
  const floating = useFloatingSurface(open, triggerRef, { preferred: "top-start", offset: 6, margin: 8 });

  function openDebugDialog() {
    setDebugOpen(true);
    window.requestAnimationFrame(() => reasonRef.current?.focus());
  }

  function closeDebugDialog() {
    setDebugOpen(false);
    setDebugReason("");
  }

  function submitDebugLog() {
    onSaveDebugLog(debugReason);
    closeDebugDialog();
  }

  return (
    <div className="message-actions-shell">
      <div className="message-actions" aria-label="Response actions">
        <button type="button" data-tooltip="Copy" aria-label="Copy response" onClick={onCopy}>
          <Copy size={13} />
        </button>
        <button
          type="button"
          data-tooltip="Regenerate"
          aria-label="Regenerate response"
          disabled={disabled}
          onClick={onRegenerate}
        >
          <RotateCw size={13} />
        </button>
        <button
          type="button"
          data-tooltip="Save debug note"
          aria-label="Save debug note"
          onClick={openDebugDialog}
        >
          <Bug size={13} />
        </button>
        <button
          ref={triggerRef}
          type="button"
          className={open ? "active" : ""}
          data-tooltip="More"
          aria-label="More response actions"
          aria-controls={`message-action-menu-${messageId}`}
          aria-expanded={open}
          onClick={onToggle}
        >
          <MoreHorizontal size={13} />
        </button>
      </div>
      {open
        ? createPortal(
            <div
              id={`message-action-menu-${messageId}`}
              ref={floating.surfaceRef}
              className={`message-action-menu floating-surface placement-${floating.placement}`}
              style={floating.floatingStyle}
              role="menu"
            >
              <button type="button" role="menuitem" onClick={onBranch}>
                Branch in new chat
              </button>
              <button type="button" role="menuitem" className={speaking ? "is-stop" : ""} onClick={onReadAloud}>
                {speaking ? (
                  <>
                    <CircleStop size={14} />
                    <span>중지</span>
                  </>
                ) : (
                  <>
                    <Volume2 size={14} />
                    <span>Read aloud</span>
                  </>
                )}
              </button>
            </div>,
            document.body
          )
        : null}
      {debugOpen
        ? createPortal(
            <div className="debug-feedback-backdrop" role="presentation" onPointerDown={closeDebugDialog}>
              <div
                className="debug-feedback-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`debug-feedback-title-${messageId}`}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="debug-feedback-heading">
                  <strong id={`debug-feedback-title-${messageId}`}>Debug note</strong>
                  <span>사용자 의도와 다른 동작을 기록합니다.</span>
                </div>
                <textarea
                  ref={reasonRef}
                  value={debugReason}
                  rows={4}
                  placeholder="사유를 입력하세요. 비워둬도 저장됩니다."
                  onChange={(event) => setDebugReason(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeDebugDialog();
                    }
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      submitDebugLog();
                    }
                  }}
                />
                <div className="debug-feedback-actions">
                  <button type="button" className="secondary" onClick={closeDebugDialog}>
                    취소
                  </button>
                  <button type="button" onClick={submitDebugLog}>
                    확인
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
