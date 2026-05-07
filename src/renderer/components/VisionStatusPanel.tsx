import { Camera, CheckCircle2, CircleDot, CircleStop, Eye, TriangleAlert } from "lucide-react";

export type VisionNoticeKind = "capture" | "recording" | "streaming" | "complete" | "error";

export type VisionNotice = {
  kind: VisionNoticeKind;
  title: string;
  detail: string;
  live: boolean;
  visible: boolean;
};

type VisionStatusPanelProps = {
  notice: VisionNotice | null;
  onStopLive?: () => void;
};

const iconByKind = {
  capture: Camera,
  recording: CircleDot,
  streaming: Eye,
  complete: CheckCircle2,
  error: TriangleAlert
} satisfies Record<VisionNoticeKind, typeof Camera>;

export function VisionStatusPanel({ notice, onStopLive }: VisionStatusPanelProps) {
  if (!notice) {
    return null;
  }

  const Icon = iconByKind[notice.kind];
  return (
    <section
      className={`vision-status-panel ${notice.visible ? "is-visible" : "is-hiding"} ${notice.live ? "is-live" : ""} ${notice.kind}`}
      aria-live={notice.live ? "assertive" : "polite"}
    >
      <span className={notice.live ? "vision-status-dot live" : "vision-status-dot"} aria-hidden="true" />
      <Icon size={14} aria-hidden="true" />
      <span className="vision-status-copy">
        <strong>{notice.title}</strong>
        <small>{notice.detail}</small>
      </span>
      {notice.live && onStopLive ? (
        <button type="button" className="vision-status-stop" aria-label="Stop Vision action" onClick={onStopLive}>
          <CircleStop size={13} />
          <span>Stop</span>
        </button>
      ) : null}
    </section>
  );
}
