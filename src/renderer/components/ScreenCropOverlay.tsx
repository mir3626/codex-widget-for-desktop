import { Square, X } from "lucide-react";
import type { CSSProperties, PointerEvent } from "react";

type ScreenCropOverlayProps = {
  selection: { width: number; height: number } | null;
  selectionStyle?: CSSProperties;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onCancel: () => void;
};

export function ScreenCropOverlay({
  selection,
  selectionStyle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onCancel
}: ScreenCropOverlayProps) {
  return (
    <div
      className="screen-crop-picker"
      role="dialog"
      aria-label="Screen crop picker"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onCancel}
    >
      <div className="screen-crop-picker-toolbar" onPointerDown={(event) => event.stopPropagation()}>
        <Square size={13} />
        <span>Drag capture region</span>
        <button type="button" aria-label="Cancel crop selection" onClick={onCancel}>
          <X size={13} />
        </button>
      </div>
      {selectionStyle && selection ? (
        <div className="screen-crop-picker-selection" style={selectionStyle}>
          <span>
            {Math.round(selection.width)} x {Math.round(selection.height)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
