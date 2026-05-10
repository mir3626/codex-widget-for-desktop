import { useRef, useState } from "react";
import type { VisionNotice } from "../../components/VisionStatusPanel";

export function useVisionNotice() {
  const [visionNotice, setVisionNotice] = useState<VisionNotice | null>(null);
  const visionNoticeTimerRef = useRef<number | null>(null);
  const visionNoticeHideTimerRef = useRef<number | null>(null);

  function clearVisionNoticeTimers() {
    if (visionNoticeTimerRef.current !== null) {
      window.clearTimeout(visionNoticeTimerRef.current);
      visionNoticeTimerRef.current = null;
    }
    if (visionNoticeHideTimerRef.current !== null) {
      window.clearTimeout(visionNoticeHideTimerRef.current);
      visionNoticeHideTimerRef.current = null;
    }
  }

  function dismissVisionNotice() {
    if (visionNoticeTimerRef.current !== null) {
      window.clearTimeout(visionNoticeTimerRef.current);
      visionNoticeTimerRef.current = null;
    }
    setVisionNotice((current) => (current ? { ...current, visible: false } : current));
    if (visionNoticeHideTimerRef.current !== null) {
      window.clearTimeout(visionNoticeHideTimerRef.current);
    }
    visionNoticeHideTimerRef.current = window.setTimeout(() => {
      visionNoticeHideTimerRef.current = null;
      setVisionNotice(null);
    }, 260);
  }

  function showVisionNotice(notice: Omit<VisionNotice, "visible">, autoHideMs?: number) {
    clearVisionNoticeTimers();
    setVisionNotice({ ...notice, visible: true });
    if (autoHideMs !== undefined) {
      visionNoticeTimerRef.current = window.setTimeout(dismissVisionNotice, autoHideMs);
    }
  }

  return {
    visionNotice,
    clearVisionNoticeTimers,
    showVisionNotice
  };
}
