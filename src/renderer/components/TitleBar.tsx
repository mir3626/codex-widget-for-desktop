import { Minus, Pin, PinOff, Square, X } from "lucide-react";

type TitleBarProps = {
  appIconUrl: string;
  opacity: number;
  opacityLabel: string;
  showOpacityValue: boolean;
  pinned: boolean;
  maximized: boolean;
  onOpacityChange: (value: string) => void;
  onOpacityEditStart: () => void;
  onOpacityEditEnd: () => void;
  onTogglePin: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
};

export function TitleBar({
  appIconUrl,
  opacity,
  opacityLabel,
  showOpacityValue,
  pinned,
  maximized,
  onOpacityChange,
  onOpacityEditStart,
  onOpacityEditEnd,
  onTogglePin,
  onMinimize,
  onToggleMaximize,
  onClose
}: TitleBarProps) {
  return (
    <header className="titlebar">
      <div className="app-identity" data-tauri-drag-region>
        <img className="app-favicon" src={appIconUrl} alt="" draggable={false} />
        <div className="app-title" data-tauri-drag-region>
          <strong>Codex Widget</strong>
        </div>
      </div>

      <label
        className={showOpacityValue ? "opacity-control titlebar-opacity is-editing" : "opacity-control titlebar-opacity"}
        title="Opacity"
      >
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={Math.round(opacity * 100)}
          onChange={(event) => onOpacityChange(event.target.value)}
          onPointerDown={onOpacityEditStart}
          onPointerUp={onOpacityEditEnd}
          onPointerCancel={onOpacityEditEnd}
          onFocus={onOpacityEditStart}
          onBlur={onOpacityEditEnd}
          aria-label="Widget opacity"
        />
        <output>{opacityLabel}</output>
      </label>

      <div className="titlebar-grip" data-tauri-drag-region />

      <div className="window-controls">
        <button
          className={pinned ? "pin-button active" : "pin-button"}
          title={pinned ? "Pinned" : "Unpinned"}
          aria-label={pinned ? "Pinned" : "Unpinned"}
          aria-pressed={pinned}
          onClick={onTogglePin}
        >
          {pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
        <button className="titlebar-button" title="Minimize" aria-label="Minimize" onClick={onMinimize}>
          <Minus size={14} />
        </button>
        <button
          className={maximized ? "titlebar-button active" : "titlebar-button"}
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore" : "Maximize"}
          aria-pressed={maximized}
          onClick={onToggleMaximize}
        >
          <Square size={12} />
        </button>
        <button className="titlebar-button close" title="Hide to tray" aria-label="Hide to tray" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
