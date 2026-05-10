import type { PointerEvent } from "react";
import type { RESIZE_HANDLES } from "../../config";

type ResizeHandle = (typeof RESIZE_HANDLES)[number];

type WidgetResizeHandlesProps = {
  handles: readonly ResizeHandle[];
  onBeginResize: (direction: ResizeHandle["direction"], event: PointerEvent<HTMLDivElement>) => void;
  onUpdateResize: (event: PointerEvent<HTMLDivElement>) => void;
  onFinishResize: (event: PointerEvent<HTMLDivElement>) => void;
};

export function WidgetResizeHandles({
  handles,
  onBeginResize,
  onUpdateResize,
  onFinishResize
}: WidgetResizeHandlesProps) {
  return (
    <>
      {handles.map((handle) => (
        <div
          key={handle.direction}
          className={`resize-handle ${handle.className}`}
          aria-hidden="true"
          onPointerDown={(event) => onBeginResize(handle.direction, event)}
          onPointerMove={onUpdateResize}
          onPointerUp={onFinishResize}
          onPointerCancel={onFinishResize}
        />
      ))}
    </>
  );
}
