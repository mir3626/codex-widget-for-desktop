import { useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  ModelId,
  ReasoningEffort,
  ScreenCrop,
  VisionStreamSummary,
  WidgetMode
} from "../../shared/protocol.js";
import {
  VISION_AGENT_STREAM_JPEG_QUALITY,
  VISION_AGENT_STREAM_MAX_FRAME_WIDTH,
  VISION_RECORDING_MAX_BYTES
} from "../config";
import type {
  LogLine,
  ScreenCropSettings,
  VisionFrameStats,
  VisionStreamSettings
} from "../types";
import {
  normalizeScreenCropField,
  normalizeVisionFrameInterval,
  normalizeVisionMaxDuration,
  persistScreenCrop,
  persistVisionStreamSettings,
  readStoredScreenCrop,
  readStoredVisionStreamSettings
} from "../utils/storage";
import {
  blobToDataUrl,
  buildScreenCrop,
  formatVisionStreamStatus
} from "../utils/vision";
import { useScreenCropPicker } from "./vision/useScreenCropPicker";
import { useVisionNotice } from "./vision/useVisionNotice";

type VisionProviderEvent = {
  state: "started" | "stopped" | "completed" | "error";
  stream: VisionStreamSummary;
  message: string;
};

type UseVisionControllerInput = {
  daemonPort: string;
  promptText: string;
  activeSessionId: string | null;
  selectedModel: ModelId;
  reasoningEffort: ReasoningEffort;
  send(message: ClientMessage): boolean;
  appendLog(text: string, tone: LogLine["tone"]): void;
  setMode(mode: WidgetMode): void;
};

export function useVisionController(input: UseVisionControllerInput) {
  const [showVisionMenu, setShowVisionMenu] = useState(false);
  const [visionSession, setVisionSession] = useState<VisionStreamSummary | null>(null);
  const [visionStreamSettings, setVisionStreamSettings] = useState<VisionStreamSettings>(() => readStoredVisionStreamSettings());
  const [visionFrameStats, setVisionFrameStats] = useState<VisionFrameStats>({ sent: 0, skipped: 0, failed: 0, lastSentAt: null });
  const [screenCrop, setScreenCrop] = useState<ScreenCropSettings>(() => readStoredScreenCrop());
  const {
    visionNotice,
    clearVisionNoticeTimers,
    showVisionNotice
  } = useVisionNotice();
  const {
    screenCropPicker,
    cropPickerSelection,
    cropPickerSelectionStyle,
    setScreenCropPicker,
    startScreenCropPicker,
    beginScreenCropPick,
    updateScreenCropPick,
    finishScreenCropPick
  } = useScreenCropPicker({
    setMode: input.setMode,
    appendLog: input.appendLog,
    setScreenCrop
  });
  const visionMediaStreamRef = useRef<MediaStream | null>(null);
  const visionRecorderRef = useRef<MediaRecorder | null>(null);
  const visionRecordingChunksRef = useRef<Blob[]>([]);
  const visionRecordingStartedAtRef = useRef<number>(0);
  const visionGuardTimerRef = useRef<number | null>(null);
  const visionFrameTimerRef = useRef<number | null>(null);
  const visionFrameVideoRef = useRef<HTMLVideoElement | null>(null);
  const visionFrameInFlightRef = useRef(false);
  const visionFrameFailureLoggedRef = useRef(false);
  const visionFinalizedIdsRef = useRef<Set<string>>(new Set());

  const isVisionRecording = visionSession?.mode === "recording" && visionSession.status === "recording";
  const isVisionStreaming = visionSession?.mode === "agent_stream" && visionSession.status === "streaming";
  const visionStreamStatusText = formatVisionStreamStatus(visionFrameStats, visionStreamSettings.frameIntervalMs);
  const visionStateLabel = isVisionRecording
    ? "Recording WebM"
    : isVisionStreaming
      ? "Sharing screen"
      : visionSession?.status === "error"
        ? "Vision error"
        : "Vision ready";
  useEffect(() => {
    persistScreenCrop(screenCrop);
  }, [screenCrop]);

  useEffect(() => {
    persistVisionStreamSettings(visionStreamSettings);
  }, [visionStreamSettings]);

  useEffect(() => {
    if (isVisionRecording) {
      showVisionNotice({
        kind: "recording",
        title: "Recording screen",
        detail: "WebM capture is running and will be saved locally.",
        live: true
      });
      return;
    }

    if (isVisionStreaming) {
      showVisionNotice({
        kind: "streaming",
        title: "Sharing with Agent",
        detail: visionStreamStatusText,
        live: true
      });
      return;
    }

    if (visionSession?.status === "stopped") {
      showVisionNotice(
        {
          kind: "complete",
          title: visionSession.mode === "recording" ? "Recording saved" : "Screen share stopped",
          detail:
            visionSession.mode === "recording"
              ? "The local WebM recording is available from Vision history."
              : "Live frame delivery to the Agent has ended.",
          live: false
        },
        2600
      );
      return;
    }

    if (visionSession?.status === "error") {
      showVisionNotice(
        {
          kind: "error",
          title: "Vision action failed",
          detail: "Check Activity details for the provider error.",
          live: false
        },
        3200
      );
    }
  }, [isVisionRecording, isVisionStreaming, visionSession?.mode, visionSession?.status, visionStreamStatusText]);

  function applyVisionProviderEvent(event: VisionProviderEvent) {
    setVisionSession(event.stream);
    if (event.state === "started" && event.stream.mode === "agent_stream") {
      setVisionFrameStats({ sent: 0, skipped: 0, failed: 0, lastSentAt: null });
    }
    if (event.state !== "started") {
      visionFinalizedIdsRef.current.add(event.stream.id);
      clearVisionGuardTimer();
      stopVisionFrameStreaming();
      stopVisionMediaTracks();
    }
    input.appendLog(event.message, event.state === "error" ? "error" : "tool");
  }

  function toggleVisionMenuFromModeBar() {
    setShowVisionMenu((current) => !current);
  }

  function captureScreen() {
    input.setMode("screen");
    setShowVisionMenu(false);
    showVisionNotice(
      {
        kind: "capture",
        title: "Capturing screen",
        detail: "A cropped snapshot is being sent to Vision context.",
        live: false
      },
      2400
    );
    input.send({
      type: "provider.captureScreen",
      description: input.promptText.trim() || undefined,
      crop: buildScreenCrop(screenCrop)
    });
  }

  async function startVisionRecording() {
    input.setMode("screen");
    setShowVisionMenu(false);
    if (!canUseDisplayCapture() || typeof MediaRecorder === "undefined") {
      input.appendLog("screen recording unavailable", "error");
      return;
    }

    const id = crypto.randomUUID();
    visionFinalizedIdsRef.current.delete(id);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const mime = chooseWebmMimeType();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      visionMediaStreamRef.current = stream;
      visionRecorderRef.current = recorder;
      visionRecordingChunksRef.current = [];
      visionRecordingStartedAtRef.current = Date.now();

      stream.getTracks().forEach((track) => {
        track.addEventListener("ended", () => stopVisionRecording("capture ended"), { once: true });
      });

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          visionRecordingChunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        void completeVisionRecording(id, recorder.mimeType || "video/webm");
      });

      recorder.start(1000);
      setVisionGuardTimer(() => stopVisionRecording("duration limit"), visionStreamSettings.maxDurationMs);
      input.send({
        type: "provider.vision.start",
        id,
        mode: "recording",
        sessionId: input.activeSessionId ?? undefined,
        fps: 4,
        frameIntervalMs: 250,
        maxDurationMs: visionStreamSettings.maxDurationMs,
        detail: {
          retention: "recording_blob",
          consent: "browser_display_capture",
          maxDurationMs: visionStreamSettings.maxDurationMs,
          localMaxBytes: VISION_RECORDING_MAX_BYTES
        }
      });
    } catch (error) {
      stopVisionMediaTracks();
      input.send({ type: "provider.vision.error", id, message: error instanceof Error ? error.message : "Unable to start screen recording." });
      input.appendLog(error instanceof Error ? error.message : "recording failed", "error");
    }
  }

  async function startAgentScreenStream() {
    input.setMode("screen");
    setShowVisionMenu(false);
    if (!canUseDisplayCapture()) {
      input.appendLog("screen sharing unavailable", "error");
      return;
    }

    const id = crypto.randomUUID();
    visionFinalizedIdsRef.current.delete(id);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      visionMediaStreamRef.current = stream;
      visionFrameFailureLoggedRef.current = false;
      setVisionFrameStats({ sent: 0, skipped: 0, failed: 0, lastSentAt: null });
      stream.getTracks().forEach((track) => {
        track.addEventListener("ended", () => stopAgentScreenStream(id, "capture ended"), { once: true });
      });
      await startVisionFrameStreaming(stream, id, visionStreamSettings.frameIntervalMs);
      setVisionGuardTimer(() => stopAgentScreenStream(id, "duration limit"), visionStreamSettings.maxDurationMs);
      input.send({
        type: "visionContext.start",
        captureId: id,
        sessionId: input.activeSessionId ?? undefined,
        source: {
          kind: "screen",
          appName: "Desktop screen share",
          windowTitle: document.title,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio
          }
        },
        retention: "default"
      });
      if (input.promptText.trim()) {
        input.send({
          type: "visionContext.event",
          captureId: id,
          event: {
            type: "speech",
            t: 0,
            text: input.promptText.trim(),
            confidence: 0.9
          }
        });
      }
      input.send({
        type: "provider.vision.start",
        id,
        mode: "agent_stream",
        sessionId: input.activeSessionId ?? undefined,
        fps: Number((1000 / visionStreamSettings.frameIntervalMs).toFixed(2)),
        frameIntervalMs: visionStreamSettings.frameIntervalMs,
        maxDurationMs: visionStreamSettings.maxDurationMs,
        detail: {
          retention: "metadata_only",
          consent: "browser_display_capture",
          frameIntervalMs: visionStreamSettings.frameIntervalMs,
          maxDurationMs: visionStreamSettings.maxDurationMs,
          resource: {
            maxFrameWidth: VISION_AGENT_STREAM_MAX_FRAME_WIDTH,
            jpegQuality: VISION_AGENT_STREAM_JPEG_QUALITY,
            overlapPolicy: "drop_if_previous_frame_pending"
          }
        }
      });
    } catch (error) {
      stopVisionMediaTracks();
      input.send({ type: "provider.vision.error", id, message: error instanceof Error ? error.message : "Unable to start Agent screen stream." });
      input.appendLog(error instanceof Error ? error.message : "screen stream failed", "error");
    }
  }

  function stopVisionRecording(reason = "user stopped") {
    setShowVisionMenu(false);
    clearVisionGuardTimer();
    const recorder = visionRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    stopVisionMediaTracks();
    if (visionSession?.id && !visionFinalizedIdsRef.current.has(visionSession.id)) {
      visionFinalizedIdsRef.current.add(visionSession.id);
      input.send({ type: "provider.vision.stop", id: visionSession.id, reason });
    }
  }

  function stopAgentScreenStream(id = visionSession?.id, reason = "user stopped") {
    setShowVisionMenu(false);
    clearVisionGuardTimer();
    stopVisionFrameStreaming();
    stopVisionMediaTracks();
    if (id && !visionFinalizedIdsRef.current.has(id)) {
      visionFinalizedIdsRef.current.add(id);
      input.send({ type: "provider.vision.stop", id, reason });
      input.send({
        type: "visionContext.stop",
        captureId: id,
        sendToAgent: true,
        sessionId: input.activeSessionId ?? undefined,
        model: input.selectedModel,
        reasoningEffort: input.reasoningEffort
      });
    }
  }

  async function completeVisionRecording(id: string, mime: string) {
    clearVisionGuardTimer();
    const chunks = visionRecordingChunksRef.current;
    visionRecordingChunksRef.current = [];
    visionFinalizedIdsRef.current.add(id);
    stopVisionMediaTracks();
    const blob = new Blob(chunks, { type: mime || "video/webm" });
    if (blob.size > VISION_RECORDING_MAX_BYTES) {
      input.send({ type: "provider.vision.error", id, message: "Recording exceeded the local size guardrail." });
      input.appendLog("recording too large", "error");
      return;
    }
    if (blob.size === 0) {
      input.send({ type: "provider.vision.stop", id, reason: "empty recording" });
      return;
    }
    const dataUrl = await blobToDataUrl(blob);
    input.send({
      type: "provider.vision.recording.complete",
      id,
      mime: blob.type || "video/webm",
      dataUrl,
      durationMs: Date.now() - visionRecordingStartedAtRef.current,
      size: blob.size
    });
  }

  function canUseDisplayCapture(): boolean {
    return Boolean(navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices);
  }

  function chooseWebmMimeType(): string {
    const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
  }

  function setVisionGuardTimer(callback: () => void, timeoutMs: number) {
    clearVisionGuardTimer();
    visionGuardTimerRef.current = window.setTimeout(callback, timeoutMs);
  }

  function clearVisionGuardTimer() {
    if (visionGuardTimerRef.current !== null) {
      window.clearTimeout(visionGuardTimerRef.current);
      visionGuardTimerRef.current = null;
    }
  }

  function stopVisionMediaTracks() {
    visionMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    visionMediaStreamRef.current = null;
    visionRecorderRef.current = null;
  }

  async function startVisionFrameStreaming(stream: MediaStream, streamId: string, frameIntervalMs: number) {
    stopVisionFrameStreaming();
    if (stream.getVideoTracks().length === 0) {
      return;
    }

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    visionFrameVideoRef.current = video;
    try {
      await video.play();
    } catch {
      return;
    }

    const sendFrame = () => {
      void postVisionStreamFrame(video, streamId);
    };
    sendFrame();
    visionFrameTimerRef.current = window.setInterval(sendFrame, frameIntervalMs);
  }

  function stopVisionFrameStreaming() {
    if (visionFrameTimerRef.current !== null) {
      window.clearInterval(visionFrameTimerRef.current);
      visionFrameTimerRef.current = null;
    }
    visionFrameInFlightRef.current = false;
    const video = visionFrameVideoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    visionFrameVideoRef.current = null;
  }

  async function postVisionStreamFrame(video: HTMLVideoElement, streamId: string) {
    if (visionFrameInFlightRef.current) {
      setVisionFrameStats((current) => ({
        ...current,
        skipped: current.skipped + 1
      }));
      return;
    }
    if (!video.videoWidth || !video.videoHeight) {
      return;
    }
    const scale = Math.min(1, VISION_AGENT_STREAM_MAX_FRAME_WIDTH / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    visionFrameInFlightRef.current = true;
    context.drawImage(video, 0, 0, width, height);
    const imageDataUrl = canvas.toDataURL("image/jpeg", VISION_AGENT_STREAM_JPEG_QUALITY);
    try {
      const response = await fetch(`http://127.0.0.1:${input.daemonPort}/providers/screen/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "agent-screen-stream",
          title: "Agent screen stream",
          description: `Live screen stream frame from ${streamId}.`,
          imageDataUrl
        })
      });
      if (!response.ok) {
        throw new Error(`screen snapshot failed: ${response.status}`);
      }
      setVisionFrameStats((current) => ({
        sent: current.sent + 1,
        skipped: current.skipped,
        failed: current.failed,
        lastSentAt: Date.now()
      }));
    } catch {
      setVisionFrameStats((current) => ({
        ...current,
        failed: current.failed + 1
      }));
      if (!visionFrameFailureLoggedRef.current) {
        visionFrameFailureLoggedRef.current = true;
        input.appendLog("screen stream frame failed", "error");
      }
    } finally {
      visionFrameInFlightRef.current = false;
    }
  }

  function updateVisionFrameInterval(value: string) {
    setVisionStreamSettings((current) => ({
      ...current,
      frameIntervalMs: normalizeVisionFrameInterval(Number.parseInt(value, 10))
    }));
  }

  function updateVisionMaxDuration(value: string) {
    setVisionStreamSettings((current) => ({
      ...current,
      maxDurationMs: normalizeVisionMaxDuration(Number.parseInt(value, 10))
    }));
  }

  function updateScreenCropField(field: keyof ScreenCrop, value: string) {
    setScreenCrop((current) => ({
      ...current,
      [field]: normalizeScreenCropField(field, Number.parseInt(value, 10))
    }));
  }

  function cleanupVisionEffects() {
    if (visionGuardTimerRef.current !== null) {
      window.clearTimeout(visionGuardTimerRef.current);
    }
    clearVisionNoticeTimers();
    stopVisionFrameStreaming();
    stopVisionMediaTracks();
  }

  return {
    showVisionMenu,
    setShowVisionMenu,
    visionNotice,
    visionSession,
    visionStreamSettings,
    visionFrameStats,
    isVisionRecording,
    isVisionStreaming,
    visionStreamStatusText,
    visionStateLabel,
    screenCrop,
    setScreenCrop,
    screenCropPicker,
    cropPickerSelection,
    cropPickerSelectionStyle,
    applyVisionProviderEvent,
    toggleVisionMenuFromModeBar,
    captureScreen,
    startVisionRecording,
    stopVisionRecording,
    startAgentScreenStream,
    stopAgentScreenStream,
    updateVisionFrameInterval,
    updateVisionMaxDuration,
    updateScreenCropField,
    startScreenCropPicker,
    beginScreenCropPick,
    updateScreenCropPick,
    finishScreenCropPick,
    setScreenCropPicker,
    cleanupVisionEffects
  };
}
