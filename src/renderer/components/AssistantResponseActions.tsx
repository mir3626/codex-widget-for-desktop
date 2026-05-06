import { CircleStop, Copy, MoreHorizontal, RotateCw, Volume2 } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useFloatingSurface } from "../hooks/useFloatingSurface";

type AssistantResponseActionsProps = {
  messageId: string;
  open: boolean;
  disabled: boolean;
  speaking: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
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
  onToggle,
  onBranch,
  onReadAloud
}: AssistantResponseActionsProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const floating = useFloatingSurface(open, triggerRef, { preferred: "top-start", offset: 6, margin: 8 });

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
    </div>
  );
}
