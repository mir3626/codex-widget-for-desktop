import { Camera, CircleDot, CircleStop, Eye } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { VISION_FRAME_INTERVAL_OPTIONS, VISION_MAX_DURATION_OPTIONS } from "../config";
import { useFloatingSurface } from "../hooks/useFloatingSurface";
import type { VisionFrameStats, VisionStreamSettings } from "../types";

type VisionActionMenuProps = {
  open: boolean;
  statusLabel: string;
  recording: boolean;
  streaming: boolean;
  settings: VisionStreamSettings;
  frameStats: VisionFrameStats;
  streamStatusText: string;
  expanded?: boolean;
  onToggle: () => void;
  onCapture: () => void;
  onRecord: () => void;
  onStream: () => void;
  onFrameIntervalChange: (value: string) => void;
  onMaxDurationChange: (value: string) => void;
};

export function VisionActionMenu({
  open,
  statusLabel,
  recording,
  streaming,
  settings,
  frameStats,
  streamStatusText,
  expanded = false,
  onToggle,
  onCapture,
  onRecord,
  onStream,
  onFrameIntervalChange,
  onMaxDurationChange
}: VisionActionMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const floating = useFloatingSurface(open, triggerRef, { preferred: "bottom-start", offset: 6, margin: 8 });

  return (
    <div className={expanded ? "vision-action-wrap expanded" : "vision-action-wrap"}>
      <button
        ref={triggerRef}
        type="button"
        className={expanded ? "vision-menu-trigger expanded" : "provider-action vision-menu-trigger"}
        title="Vision tools"
        aria-label="Vision tools"
        aria-controls="vision-action-menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Camera size={12} />
        {expanded ? <span>Vision</span> : null}
      </button>
      {open
        ? createPortal(
            <div
              id="vision-action-menu"
              ref={floating.surfaceRef}
              className={`${recording || streaming ? "vision-action-menu active" : "vision-action-menu"} floating-surface placement-${floating.placement}`}
              style={floating.floatingStyle}
              role="menu"
              aria-label="Vision actions"
            >
              <div className="vision-menu-section">
                <div className="vision-menu-eyebrow">Screen context</div>
                <button type="button" role="menuitem" onClick={onCapture}>
                  <Camera size={13} />
                  <span>
                    <strong>Capture snapshot</strong>
                    <small>Single cropped screen context</small>
                  </span>
                </button>
              </div>
              <div className="vision-menu-section">
                <div className="vision-menu-eyebrow">Recording</div>
                <button type="button" role="menuitem" onClick={onRecord}>
                  {recording ? <CircleStop size={13} /> : <CircleDot size={13} />}
                  <span>
                    <strong>{recording ? "Stop WebM recording" : "Record WebM"}</strong>
                    <small>Saved as a local artifact blob</small>
                  </span>
                </button>
              </div>
              <div className="vision-menu-section">
                <div className="vision-menu-eyebrow">Agent screen share</div>
                <button type="button" role="menuitem" onClick={onStream}>
                  {streaming ? <CircleStop size={13} /> : <Eye size={13} />}
                  <span>
                    <strong>{streaming ? "Stop Agent stream" : "Share with Agent"}</strong>
                    <small>Live frames only, no video file</small>
                  </span>
                </button>
                <div className="vision-menu-controls">
                  <label>
                    <span>Cadence</span>
                    <select
                      aria-label="Agent screen stream cadence"
                      value={settings.frameIntervalMs}
                      onChange={(event) => onFrameIntervalChange(event.target.value)}
                    >
                      {VISION_FRAME_INTERVAL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Limit</span>
                    <select
                      aria-label="Vision max duration"
                      value={settings.maxDurationMs}
                      onChange={(event) => onMaxDurationChange(event.target.value)}
                    >
                      {VISION_MAX_DURATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="vision-menu-retention">
                <strong>{streaming ? streamStatusText : statusLabel}</strong>
                <small>
                  {streaming
                    ? `${frameStats.sent} sent / ${frameStats.skipped} skipped / ${frameStats.failed} failed`
                    : "Browser capture consent is required each time."}
                </small>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
