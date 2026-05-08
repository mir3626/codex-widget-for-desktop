import { Check } from "lucide-react";
import {
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import appIconUrl from "../../src-tauri/icons/icon.png";
import {
  normalizeModelId,
  normalizeReasoningEffort,
  type AuthStatus,
  type BrowserActionDirectCommandInput,
  type BrowserActionMode,
  type BrowserActionPolicyDecision,
  type BranchContextMessage,
  type ClientMessage,
  type ExecutionPermissionDecision,
  type ExecutionPermissionSummary,
  type LedgerSnapshot,
  type MessageSnapshotStatus,
  type ModelId,
  type ProviderStatus,
  type ReasoningEffort,
  type RuntimeInteraction,
  type RuntimeInteractionDecision,
  type RuntimeStatus,
  type ScreenCrop,
  type SessionMessage,
  type SessionSnapshot,
  type SessionSummary,
  type VisionStreamSummary,
  type ServerEvent,
  type WidgetMode
} from "../shared/protocol.js";
import {
  BRANCH_CONTEXT_STORAGE_KEY,
  CHAT_STORAGE_KEY,
  DEFAULT_MASCOT_STAGE_HEIGHT,
  DEFAULT_VISION_STREAM_SETTINGS,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MODEL_STORAGE_KEY,
  MODES,
  PROMPT_COMPOSER_MAX_HEIGHT,
  PROMPT_COMPOSER_MIN_CONVERSATION_HEIGHT,
  PROMPT_COMPOSER_MIN_HEIGHT,
  PROMPT_COMPOSER_RESERVED_ROWS_HEIGHT,
  REASONING_STORAGE_KEY,
  RESIZE_HANDLES,
  SCREEN_CROP_STORAGE_KEY,
  STREAM_TYPE_BASE_INTERVAL_MS,
  TERMINAL_LINE_LIMIT,
  TERMINAL_LINE_MAX_CHARS,
  TERMINAL_MOUSE_DRAG_INTERVAL_MS,
  VISION_AGENT_STREAM_FRAME_INTERVAL_MS,
  VISION_AGENT_STREAM_JPEG_QUALITY,
  VISION_AGENT_STREAM_MAX_FRAME_WIDTH,
  VISION_RECORDING_MAX_BYTES,
  VISION_RECORDING_MAX_DURATION_MS,
  VISION_STREAM_SETTINGS_STORAGE_KEY
} from "./config";
import { ActivityLog } from "./components/ActivityLog";
import { BrowserActionMenu } from "./components/BrowserActionMenu";
import { ConversationPanel } from "./components/ConversationPanel";
import { FloatingTooltipRoot } from "./components/FloatingTooltipRoot";
import { MascotSprite, type MascotMotionStatus } from "./components/MascotSprite";
import { ModeTabs } from "./components/ModeTabs";
import { ModelControls } from "./components/ModelControls";
import { PromptComposer } from "./components/PromptComposer";
import { ScreenCropOverlay } from "./components/ScreenCropOverlay";
import { SettingsPanel } from "./components/SettingsPanel";
import { SessionStrip } from "./components/SessionStrip";
import { SystemStrip } from "./components/SystemStrip";
import { TitleBar } from "./components/TitleBar";
import { VisionActionMenu } from "./components/VisionActionMenu";
import { VisionStatusPanel, type VisionNotice } from "./components/VisionStatusPanel";
import {
  closeWidget,
  minimizeWidget,
  openExternalUrl,
  readNativeDaemonStatus,
  readAutostartEnabled,
  readWidgetWindowGeometry,
  setAutostartEnabled,
  setWidgetWindowFrame,
  startDragWidget,
  startResizeWidget,
  toggleMaximizeWidget,
  togglePinned,
  type NativeDaemonStatus,
  type WidgetResizeDirection
} from "./shell";
import type {
  AssistantMessageStatus,
  BrowserActionUiState,
  ChatMessage,
  InteractionDrafts,
  LogLine,
  PromptResizeState,
  ScreenCropPickerState,
  ScreenCropSettings,
  SpeechRecognitionConstructor,
  SpeechRecognitionLike,
  TerminalKeyName,
  TerminalLine,
  ToastNotice,
  VisionFrameStats,
  VisionStreamSettings
} from "./types";
import {
  ensureAssistantMessage,
  findPreviousUserMessage,
  getNextTypingLength,
  getTypingDelay,
  isAssistantWorking,
  readWorkingAssistantId,
  sessionMessageToChatMessage,
  snapshotStatusToAssistantStatus
} from "./utils/chat";
import { formatNativeDaemonStatus } from "./utils/format";
import {
  canUseVoiceInput,
  createSpeechText,
  pickSpeechLanguage,
  pickSpeechVoice,
  readSpeechRecognitionConstructor
} from "./utils/speech";
import {
  clampOpacity,
  normalizeScreenCropField,
  normalizeVisionFrameInterval,
  normalizeVisionMaxDuration,
  persistBranchContext,
  persistChatMessages,
  persistScreenCrop,
  persistVisionStreamSettings,
  readInitialWidgetMode,
  readStoredBranchContext,
  readStoredChatMessages,
  readStoredModel,
  readStoredOpacity,
  readStoredReasoningEffort,
  readStoredScreenCrop,
  readStoredVisionStreamSettings
} from "./utils/storage";
import {
  clampTerminalLine,
  formatTerminalMouseSequence,
  isTerminalToolEvent,
  limitTerminalLines,
  normalizeTerminalText,
  readTerminalMouseCell,
  summarizeTerminalCompletion,
  terminalKeyToInput,
  terminalKeyToLabel,
  terminalLinePrefix,
  terminalToolLabel
} from "./utils/terminal";
import {
  blobToDataUrl,
  buildScreenCrop,
  convertPickerSelectionToScreenCrop,
  formatVisionStreamStatus,
  readCropPickerPoint,
  readScreenCropPickerSelection
} from "./utils/vision";

type ResizeDragState = {
  direction: WidgetResizeDirection;
  pointerId: number;
  target: HTMLDivElement;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  minWidth: number;
  minHeight: number;
  scaleFactor: number;
  frameId: number | null;
  applying: boolean;
  queued: boolean;
  ended: boolean;
};

export function App() {
  const [mode, setMode] = useState<WidgetMode>(() => readInitialWidgetMode());
  const [selectedModel, setSelectedModel] = useState<ModelId>(() => readStoredModel());
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(() => readStoredReasoningEffort());
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [nativeDaemonStatus, setNativeDaemonStatus] = useState<NativeDaemonStatus | null>(null);
  const [status, setStatus] = useState("connecting");
  const [auth, setAuth] = useState<AuthStatus>({
    mode: "mock",
    configured: false,
    authenticated: false,
    signInAvailable: false,
    signInMethod: null
  });
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => readStoredChatMessages());
  const [interactions, setInteractions] = useState<RuntimeInteraction[]>([]);
  const [interactionDrafts, setInteractionDrafts] = useState<InteractionDrafts>({});
  const [executionPermissions, setExecutionPermissions] = useState<ExecutionPermissionSummary[]>([]);
  const [browserAction, setBrowserAction] = useState<BrowserActionUiState>({
    actionSessionId: null,
    bridgeStatus: null,
    adapters: [],
    policies: [],
    observationSummary: null,
    planSummary: null,
    resultSummary: null,
    progress: [],
    error: null,
    safetyMode: "auto_safe_actions"
  });
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [branchContext, setBranchContext] = useState<BranchContextMessage[] | null>(() => readStoredBranchContext());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [trashedSessions, setTrashedSessions] = useState<SessionSummary[]>([]);
  const [showSessionTrash, setShowSessionTrash] = useState(false);
  const [ledger, setLedger] = useState<LedgerSnapshot | null>(null);
  const [trashLedger, setTrashLedger] = useState<LedgerSnapshot | null>(null);
  const [trashArtifactSessionId, setTrashArtifactSessionId] = useState<string | null>(null);
  const [toastNotice, setToastNotice] = useState<ToastNotice | null>(null);
  const [sessionControlsFlashing, setSessionControlsFlashing] = useState(false);
  const [showActivityDetails, setShowActivityDetails] = useState(false);
  const [showVisionMenu, setShowVisionMenu] = useState(false);
  const [showBrowserActionMenu, setShowBrowserActionMenu] = useState(false);
  const [visionNotice, setVisionNotice] = useState<VisionNotice | null>(null);
  const [visionSession, setVisionSession] = useState<VisionStreamSummary | null>(null);
  const [visionStreamSettings, setVisionStreamSettings] = useState<VisionStreamSettings>(() => readStoredVisionStreamSettings());
  const [visionFrameStats, setVisionFrameStats] = useState<VisionFrameStats>({ sent: 0, skipped: 0, failed: 0, lastSentAt: null });
  const [voiceListening, setVoiceListening] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalMouseEnabled, setTerminalMouseEnabled] = useState(false);
  const [showTerminalGuide, setShowTerminalGuide] = useState(() => readInitialWidgetMode() === "terminal");
  const [screenCrop, setScreenCrop] = useState<ScreenCropSettings>(() => readStoredScreenCrop());
  const [screenCropPicker, setScreenCropPickerState] = useState<ScreenCropPickerState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autostartEnabled, setAutostartEnabledState] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [proxyInput, setProxyInput] = useState("http://127.0.0.1:8787/agent/stream");
  const [modelLabelInput, setModelLabelInput] = useState("oauth-token");
  const [pinned, setPinned] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const [opacity, setOpacity] = useState(() => readStoredOpacity());
  const [promptHeight, setPromptHeight] = useState(PROMPT_COMPOSER_MIN_HEIGHT);
  const [showOpacityValue, setShowOpacityValue] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const conversationRef = useRef<HTMLElement | null>(null);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const trashArtifactSessionIdRef = useRef<string | null>(trashArtifactSessionId);
  const branchContextRef = useRef<BranchContextMessage[] | null>(branchContext);
  const streamBuffersRef = useRef<Map<string, string>>(new Map());
  const completedResponseIdsRef = useRef<Set<string>>(new Set());
  const terminalRequestIdsRef = useRef<Set<string>>(new Set());
  const terminalOutputRequestIdsRef = useRef<Set<string>>(new Set());
  const terminalOutputOpenRef = useRef(false);
  const streamTypingTimerRef = useRef<number | null>(null);
  const speechRunIdRef = useRef(0);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const browserModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const visionModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const visionNoticeTimerRef = useRef<number | null>(null);
  const visionNoticeHideTimerRef = useRef<number | null>(null);
  const promptResizeRef = useRef<PromptResizeState | null>(null);
  const screenCropPickerRef = useRef<ScreenCropPickerState | null>(null);
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
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voicePromptBaseRef = useRef("");
  const opacityValueTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const sessionControlsPulseTimerRef = useRef<number | null>(null);
  const resizeDragRef = useRef<ResizeDragState | null>(null);

  const daemonPort = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("daemonPort") ?? "4128";
  }, []);

  useEffect(() => {
    let stopped = false;
    let retryCount = 0;
    let reconnectTimer: number | null = null;

    function connect() {
      if (stopped) {
        return;
      }

      setStatus(retryCount === 0 ? "connecting" : "reconnecting");
      const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}`);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        retryCount = 0;
        setConnected(true);
        setStatus("connected");
      });

      socket.addEventListener("close", () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setConnected(false);
        if (stopped) {
          return;
        }
        retryCount += 1;
        setStatus("reconnecting");
        const delay = Math.min(2500, 350 + retryCount * 250);
        reconnectTimer = window.setTimeout(connect, delay);
      });

      socket.addEventListener("message", (event) => {
        const serverEvent = JSON.parse(event.data as string) as ServerEvent;
        handleServerEvent(serverEvent);
      });
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
      if (opacityValueTimerRef.current !== null) {
        window.clearTimeout(opacityValueTimerRef.current);
      }
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (sessionControlsPulseTimerRef.current !== null) {
        window.clearTimeout(sessionControlsPulseTimerRef.current);
      }
      if (streamTypingTimerRef.current !== null) {
        window.clearTimeout(streamTypingTimerRef.current);
      }
      if (visionGuardTimerRef.current !== null) {
        window.clearTimeout(visionGuardTimerRef.current);
      }
      clearVisionNoticeTimers();
      stopVisionFrameStreaming();
      stopVisionMediaTracks();
      voiceRecognitionRef.current?.abort();
      voiceRecognitionRef.current = null;
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [daemonPort]);

  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;

    async function refreshNativeDaemonStatus() {
      const snapshot = await readNativeDaemonStatus();
      if (!stopped && snapshot) {
        setNativeDaemonStatus(snapshot);
      }
    }

    void refreshNativeDaemonStatus();
    timer = window.setInterval(refreshNativeDaemonStatus, connected ? 5000 : 1500);

    return () => {
      stopped = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [connected]);

  useEffect(() => {
    if (!openActionMenuId) {
      return;
    }

    function closeMenuFromOutside(event: MouseEvent | globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".message-actions-shell, .message-action-menu")) {
        return;
      }
      setOpenActionMenuId(null);
    }

    function closeMenuFromEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenActionMenuId(null);
      }
    }

    document.addEventListener("pointerdown", closeMenuFromOutside, true);
    document.addEventListener("keydown", closeMenuFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenuFromOutside, true);
      document.removeEventListener("keydown", closeMenuFromEscape);
    };
  }, [openActionMenuId]);

  useEffect(() => {
    if (!showSessionTrash) {
      return;
    }

    function closeTrashFromOutside(event: MouseEvent | globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".session-strip, .session-trash-popover")) {
        return;
      }
      setShowSessionTrash(false);
    }

    function closeTrashFromEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setShowSessionTrash(false);
      }
    }

    document.addEventListener("pointerdown", closeTrashFromOutside, true);
    document.addEventListener("keydown", closeTrashFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeTrashFromOutside, true);
      document.removeEventListener("keydown", closeTrashFromEscape);
    };
  }, [showSessionTrash]);

  useEffect(() => {
    if (!showBrowserActionMenu) {
      return;
    }

    function closeBrowserActionMenuFromOutside(event: MouseEvent | globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".mode-row, .browser-action-menu")) {
        return;
      }
      setShowBrowserActionMenu(false);
    }

    function closeBrowserActionMenuFromEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setShowBrowserActionMenu(false);
      }
    }

    document.addEventListener("pointerdown", closeBrowserActionMenuFromOutside, true);
    document.addEventListener("keydown", closeBrowserActionMenuFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeBrowserActionMenuFromOutside, true);
      document.removeEventListener("keydown", closeBrowserActionMenuFromEscape);
    };
  }, [showBrowserActionMenu]);

  useEffect(() => {
    if (!showBrowserActionMenu) {
      return;
    }
    send({ type: "browserAction.adapters", actionSessionId: browserAction.actionSessionId ?? undefined });
  }, [showBrowserActionMenu]);

  useEffect(() => {
    if (!showVisionMenu) {
      return;
    }

    function closeVisionMenuFromOutside(event: MouseEvent | globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".mode-row, .vision-action-wrap, .vision-action-menu")) {
        return;
      }
      setShowVisionMenu(false);
    }

    function closeVisionMenuFromEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setShowVisionMenu(false);
      }
    }

    document.addEventListener("pointerdown", closeVisionMenuFromOutside, true);
    document.addEventListener("keydown", closeVisionMenuFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeVisionMenuFromOutside, true);
      document.removeEventListener("keydown", closeVisionMenuFromEscape);
    };
  }, [showVisionMenu]);

  useEffect(() => {
    if (!showActivityDetails) {
      return;
    }

    function closeActivityFromOutside(event: MouseEvent | globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".log-list, .activity-popover")) {
        return;
      }
      setShowActivityDetails(false);
    }

    function closeActivityFromEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setShowActivityDetails(false);
      }
    }

    document.addEventListener("pointerdown", closeActivityFromOutside, true);
    document.addEventListener("keydown", closeActivityFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeActivityFromOutside, true);
      document.removeEventListener("keydown", closeActivityFromEscape);
    };
  }, [showActivityDetails]);

  useEffect(() => {
    void readAutostartEnabled().then(setAutostartEnabledState);
  }, []);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
    persistChatMessages(chatMessages);
  }, [chatMessages]);

  useEffect(() => {
    branchContextRef.current = branchContext;
    persistBranchContext(branchContext);
  }, [branchContext]);

  useEffect(() => {
    persistScreenCrop(screenCrop);
  }, [screenCrop]);

  useEffect(() => {
    persistVisionStreamSettings(visionStreamSettings);
  }, [visionStreamSettings]);

  useEffect(() => {
    if (!screenCropPicker) {
      return;
    }

    document.body.classList.add("is-picking-screen-crop");
    function cancelFromEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setScreenCropPicker(null);
      }
    }

    document.addEventListener("keydown", cancelFromEscape);
    return () => {
      document.body.classList.remove("is-picking-screen-crop");
      document.removeEventListener("keydown", cancelFromEscape);
    };
  }, [screenCropPicker]);

  useEffect(() => {
    restoreMessageBuffers(chatMessagesRef.current);
  }, []);

  useEffect(() => {
    function clampPromptForViewport() {
      setPromptHeight((current) => clampPromptHeight(current, readPromptHeightLimit()));
    }

    clampPromptForViewport();
    window.addEventListener("resize", clampPromptForViewport);
    return () => {
      window.removeEventListener("resize", clampPromptForViewport);
    };
  }, [maximized]);

  useEffect(() => {
    if (showTokenForm) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const conversation = conversationRef.current;
      if (!conversation) {
        return;
      }
      conversation.scrollTop = conversation.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [chatMessages, showTokenForm]);

  function handleServerEvent(event: ServerEvent) {
    if (event.type === "connected") {
      setAuth(event.daemon.auth);
      setStatus(event.daemon.liveModel ? "idle" : "demo");
      appendLog(event.daemon.liveModel ? `${event.daemon.model} ready` : "demo stream", "muted");
      return;
    }

    if (event.type === "auth.status") {
      setAuth(event.auth);
      if (event.auth.authenticated) {
        setShowTokenForm(false);
        setTokenInput("");
        appendLog(event.auth.signInMethod === "codex" ? "OpenAI signed in" : "oauth signed in", "tool");
      } else if (event.auth.configured) {
        appendLog(event.auth.reason ?? "sign-in required", "muted");
      }
      if (event.auth.proxyUrl && !proxyInput.trim()) {
        setProxyInput(event.auth.proxyUrl);
      }
      if (event.auth.modelLabel && !modelLabelInput.trim()) {
        setModelLabelInput(event.auth.modelLabel);
      }
      return;
    }

    if (event.type === "auth.url") {
      void openExternalUrl(event.url);
      appendLog("opened sign-in", "tool");
      return;
    }

    if (event.type === "external.url") {
      void openExternalUrl(event.url);
      appendLog("opened browser", "tool");
      return;
    }

    if (event.type === "session.snapshot") {
      applySessionSnapshot(event.snapshot);
      return;
    }

    if (event.type === "ledger.snapshot") {
      if (
        trashArtifactSessionIdRef.current &&
        event.snapshot.sessionId === trashArtifactSessionIdRef.current &&
        event.snapshot.sessionId !== activeSessionIdRef.current
      ) {
        setTrashLedger(event.snapshot);
        return;
      }
      setLedger(event.snapshot);
      return;
    }

    if (event.type === "artifact.fileChange") {
      appendLog(`${event.title} ${event.phase}`, "tool");
      return;
    }

    if (event.type === "session.state") {
      setStatus(event.state);
      if (event.state === "idle") {
        setActiveId(null);
      } else if (event.state === "cancelled") {
        setActiveId(null);
        if (event.id) {
          markAssistantMessage(event.id, "cancelled");
          if (terminalRequestIdsRef.current.has(event.id)) {
            appendTerminalLine("system", "terminal request cancelled");
            terminalRequestIdsRef.current.delete(event.id);
            terminalOutputRequestIdsRef.current.delete(event.id);
          }
        }
      } else if (event.state === "error") {
        setActiveId(null);
        if (event.id) {
          markAssistantMessage(event.id, "error");
          if (terminalRequestIdsRef.current.has(event.id)) {
            appendTerminalLine("error", "terminal request failed");
            terminalRequestIdsRef.current.delete(event.id);
            terminalOutputRequestIdsRef.current.delete(event.id);
          }
        }
      } else if (event.id) {
        markAssistantMessage(event.id, event.state === "tooling" ? "tooling" : event.state === "thinking" ? "thinking" : "streaming");
      }
      return;
    }

    if (event.type === "message.delta") {
      appendAssistantDelta(event.id, event.text);
      return;
    }

    if (event.type === "message.completed") {
      completeAssistantMessage(event.id, event.text);
      completeTerminalRequest(event.id, event.text);
      setActiveId(null);
      return;
    }

    if (event.type === "message.snapshot") {
      applyAssistantSnapshot(event.id, event.text, event.status);
      return;
    }

    if (event.type === "tool.started") {
      markAssistantMessage(event.id, "tooling");
      if (isTerminalToolEvent(event.tool)) {
        registerTerminalRequest(event.id, event.label, false);
        appendTerminalLine("system", `${terminalToolLabel(event.tool)} started`);
      }
      appendLog(`${event.label}`, "tool");
      return;
    }

    if (event.type === "tool.output") {
      if (isTerminalToolEvent(event.tool) || terminalRequestIdsRef.current.has(event.id)) {
        appendTerminalOutput(event.id, event.chunk);
      }
      appendLog(event.chunk, "muted");
      return;
    }

    if (event.type === "tool.completed") {
      markAssistantMessage(event.id, "streaming");
      if (isTerminalToolEvent(event.tool) || terminalRequestIdsRef.current.has(event.id)) {
        appendTerminalLine("system", `${terminalToolLabel(event.tool)} completed`);
      }
      appendLog(`${event.tool} done`, "tool");
      return;
    }

    if (event.type === "interaction.required") {
      setInteractions((current) => [event.interaction, ...current.filter((item) => item.id !== event.interaction.id)].slice(0, 3));
      setInteractionDrafts((current) => ({
        ...current,
        [event.interaction.id]: createInteractionDraft(event.interaction)
      }));
      appendLog(event.interaction.title, "tool");
      return;
    }

    if (event.type === "execution.permissions") {
      setExecutionPermissions(event.permissions);
      return;
    }

    if (event.type === "execution.permission.applied") {
      appendLog(`${event.decision === "allow" ? "allowed" : "denied"} ${event.action}`, "tool");
      return;
    }

    if (event.type === "approval.required") {
      appendLog(event.action, "tool");
      return;
    }

    if (event.type === "session.reset") {
      resetVisibleSession(false);
      appendLog("new chat", "tool");
      return;
    }

    if (event.type === "provider.status") {
      setProviderStatuses(event.providers);
      return;
    }

    if (event.type === "provider.capture") {
      appendLog(event.message, event.state === "error" ? "error" : "tool");
      return;
    }

    if (event.type === "provider.vision") {
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
      appendLog(event.message, event.state === "error" ? "error" : "tool");
      return;
    }

    if (event.type === "visionContext.started") {
      appendLog("Vision Context started", "tool");
      return;
    }

    if (event.type === "visionContext.progress") {
      appendLog(`Vision Context ${event.status}`, "tool");
      return;
    }

    if (event.type === "visionContext.capsule") {
      appendLog("Vision Context capsule ready", "tool");
      return;
    }

    if (event.type === "visionContext.sent") {
      appendLog("Vision Context sent to Agent", "tool");
      return;
    }

    if (event.type === "visionContext.error") {
      appendLog(event.error, "error");
      return;
    }

    if (event.type === "browserAction.started") {
      setBrowserAction((current) => ({
        ...current,
        actionSessionId: event.actionSessionId,
        progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: "started", detail: event.summary }],
        error: null
      }));
      appendLog("Browser Action started", "tool");
      return;
    }

    if (event.type === "browserAction.observation") {
      setBrowserAction((current) => ({
        ...current,
        actionSessionId: event.actionSessionId,
        observationSummary: event.observationSummary,
        progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: "observed", detail: event.observationSummary }],
        error: null
      }));
      appendLog("Browser Action observation ready", "tool");
      return;
    }

    if (event.type === "browserAction.progress") {
      setBrowserAction((current) => ({
        ...current,
        actionSessionId: event.actionSessionId,
        progress: [...current.progress.slice(-7), { id: crypto.randomUUID(), status: event.status, detail: event.detail }],
        error: null
      }));
      appendLog(`Browser Action ${event.status}`, "tool");
      return;
    }

    if (event.type === "browserAction.adapters") {
      const ready = event.adapters.filter((adapter) => adapter.state === "ready").map((adapter) => adapter.id).join(", ") || "none";
      setBrowserAction((current) => ({
        ...current,
        actionSessionId: event.actionSessionId ?? current.actionSessionId,
        adapters: event.adapters,
        progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: "adapters", detail: { ready } }],
        error: null
      }));
      appendLog(`Browser Action adapters ready: ${ready}`, "tool");
      return;
    }

    if (event.type === "browserExtensionBridge.status") {
      setBrowserAction((current) => ({
        ...current,
        bridgeStatus: event.status
      }));
      if (event.status.mode === "permission_needed") {
        appendLog("Browser Bridge needs site permission", "tool");
      } else if (event.status.mode === "disconnected") {
        appendLog("Browser Bridge disconnected", "muted");
      } else if (event.status.mode === "restricted" || event.status.mode === "error") {
        appendLog(event.status.lastError ?? "Browser Bridge unavailable", "error");
      }
      return;
    }

    if (event.type === "browserAction.plan") {
      setBrowserAction((current) => ({
        ...current,
        actionSessionId: event.actionSessionId,
        planSummary: event.plan,
        progress: [...current.progress.slice(-7), { id: crypto.randomUUID(), status: "plan", detail: event.plan }],
        error: null
      }));
      appendLog("Browser Action plan updated", "tool");
      return;
    }

    if (event.type === "browserAction.policies") {
      setBrowserAction((current) => ({
        ...current,
        policies: event.policies
      }));
      return;
    }

    if (event.type === "browserAction.result") {
      setBrowserAction((current) => ({
        ...current,
        actionSessionId: event.actionSessionId,
        resultSummary: event.result,
        progress: [...current.progress.slice(-7), { id: crypto.randomUUID(), status: "result", detail: event.result }],
        error: null
      }));
      appendLog("Browser Action result ready", "tool");
      return;
    }

    if (event.type === "browserAction.error") {
      setBrowserAction((current) => ({
        ...current,
        actionSessionId: event.actionSessionId || current.actionSessionId,
        error: event.error,
        progress: [...current.progress.slice(-7), { id: crypto.randomUUID(), status: "error", detail: event.error }]
      }));
      appendLog(event.error, "error");
      return;
    }

    if (event.type === "terminal.output") {
      appendTerminalOutput(event.id, event.chunk);
      return;
    }

    if (event.type === "runtime.status") {
      setRuntimeStatus(event.status);
      return;
    }

    if (event.type === "error") {
      if (event.id) {
        markAssistantMessage(event.id, "error");
        if (terminalRequestIdsRef.current.has(event.id)) {
          appendTerminalLine("error", event.message);
          terminalRequestIdsRef.current.delete(event.id);
          terminalOutputRequestIdsRef.current.delete(event.id);
        }
        setActiveId(null);
      }
      appendLog(event.message, "error");
    }
  }

  function markAssistantMessage(id: string, status: AssistantMessageStatus) {
    setChatMessages((current) =>
      ensureAssistantMessage(current, id).map((message) =>
        message.role === "assistant" && message.id === id ? { ...message, status } : message
      )
    );
  }

  function appendAssistantDelta(id: string, text: string) {
    if (!text) {
      return;
    }

    streamBuffersRef.current.set(id, `${streamBuffersRef.current.get(id) ?? ""}${text}`);
    setChatMessages((current) =>
      ensureAssistantMessage(current, id).map((message) =>
        message.role === "assistant" && message.id === id && message.status !== "tooling"
          ? { ...message, status: "streaming" }
          : message
      )
    );
    scheduleAssistantTyping();
  }

  function completeAssistantMessage(id: string, text: string) {
    if (text) {
      streamBuffersRef.current.set(id, text);
    } else if (!streamBuffersRef.current.has(id)) {
      streamBuffersRef.current.set(id, "");
    }
    completedResponseIdsRef.current.add(id);
    setChatMessages((current) => ensureAssistantMessage(current, id));
    scheduleAssistantTyping();
  }

  function applyAssistantSnapshot(id: string, text: string, status: MessageSnapshotStatus) {
    streamBuffersRef.current.set(id, text);
    if (status === "done") {
      completedResponseIdsRef.current.add(id);
    } else {
      completedResponseIdsRef.current.delete(id);
    }

    const nextStatus = snapshotStatusToAssistantStatus(status);
    setChatMessages((current) =>
      ensureAssistantMessage(current, id).map((message) =>
        message.role === "assistant" && message.id === id
          ? {
              ...message,
              text,
              status: nextStatus
            }
          : message
      )
    );

    if (isAssistantWorking(nextStatus)) {
      setActiveId(id);
    } else if (activeId === id) {
      setActiveId(null);
    }
  }

  function scheduleAssistantTyping(delay = STREAM_TYPE_BASE_INTERVAL_MS) {
    if (streamTypingTimerRef.current !== null) {
      return;
    }

    streamTypingTimerRef.current = window.setTimeout(runAssistantTypingStep, delay);
  }

  function runAssistantTypingStep() {
    streamTypingTimerRef.current = null;
    let hasMore = false;
    let changed = false;
    let nextDelay = STREAM_TYPE_BASE_INTERVAL_MS;

    const nextMessages: ChatMessage[] = chatMessagesRef.current.map((message): ChatMessage => {
      if (message.role !== "assistant") {
        return message;
      }

      const target = streamBuffersRef.current.get(message.id) ?? message.text;
      const isCompleted = completedResponseIdsRef.current.has(message.id);
      if (message.text.length < target.length) {
        const remaining = target.length - message.text.length;
        const nextLength = getNextTypingLength(target, message.text.length, remaining, isCompleted);
        hasMore = hasMore || nextLength < target.length || nextLength === message.text.length;
        if (nextLength === message.text.length) {
          nextDelay = Math.min(nextDelay, 72);
          return message;
        }
        changed = true;
        nextDelay = Math.min(nextDelay, getTypingDelay(target.charAt(nextLength - 1), remaining));
        const nextStatus: AssistantMessageStatus =
          isCompleted && nextLength >= target.length ? "done" : isCompleted ? "typing" : "streaming";
        return {
          ...message,
          text: target.slice(0, nextLength),
          status: nextStatus
        };
      }

      if (isCompleted && message.status !== "done") {
        changed = true;
        return { ...message, status: "done" };
      }

      return message;
    });

    if (changed) {
      chatMessagesRef.current = nextMessages;
      setChatMessages(nextMessages);
    }

    if (hasMore) {
      scheduleAssistantTyping(nextDelay);
    }
  }

  function appendLog(text: string, tone: LogLine["tone"]) {
    setLogLines((current) => [
      { id: crypto.randomUUID(), text, tone },
      ...current.slice(0, 4)
    ]);
  }

  function registerTerminalRequest(id: string, command: string, echoCommand = true) {
    terminalRequestIdsRef.current.add(id);
    terminalOutputRequestIdsRef.current.delete(id);
    terminalOutputOpenRef.current = false;
    if (echoCommand) {
      appendTerminalLine("command", command);
    }
  }

  function appendTerminalLine(kind: TerminalLine["kind"], text: string) {
    const normalizedLines = normalizeTerminalText(text)
      .split("\n")
      .map((line) => clampTerminalLine(line))
      .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);

    if (normalizedLines.length === 0) {
      return;
    }

    terminalOutputOpenRef.current = false;
    setTerminalLines((current) =>
      limitTerminalLines([
        ...current,
        ...normalizedLines.map((line) => ({
          id: crypto.randomUUID(),
          text: line,
          kind
        }))
      ])
    );
  }

  function appendTerminalOutput(id: string, chunk: string) {
    const normalized = normalizeTerminalText(chunk);
    if (!normalized) {
      return;
    }

    terminalOutputRequestIdsRef.current.add(id);
    setTerminalLines((current) => {
      const next = [...current];
      const parts = normalized.split("\n");
      const firstPart = clampTerminalLine(parts[0] ?? "");
      if (terminalOutputOpenRef.current && next.length > 0 && next[next.length - 1].kind === "output") {
        const last = next[next.length - 1];
        next[next.length - 1] = {
          ...last,
          text: clampTerminalLine(`${last.text}${firstPart}`)
        };
      } else if (firstPart || parts.length > 1) {
        next.push({ id: crypto.randomUUID(), text: firstPart, kind: "output" });
      }

      for (let index = 1; index < parts.length; index += 1) {
        const text = clampTerminalLine(parts[index] ?? "");
        if (text || index < parts.length - 1) {
          next.push({ id: crypto.randomUUID(), text, kind: "output" });
        }
      }

      terminalOutputOpenRef.current = !normalized.endsWith("\n");
      return limitTerminalLines(next);
    });
  }

  function completeTerminalRequest(id: string, text: string) {
    if (!terminalRequestIdsRef.current.has(id)) {
      return;
    }

    const sawOutput = terminalOutputRequestIdsRef.current.has(id);
    const summary = summarizeTerminalCompletion(text, sawOutput);
    if (summary) {
      appendTerminalLine(sawOutput ? "system" : "output", summary);
    }
    terminalRequestIdsRef.current.delete(id);
    terminalOutputRequestIdsRef.current.delete(id);
    terminalOutputOpenRef.current = false;
  }

  function clearTerminalViewport() {
    terminalOutputOpenRef.current = false;
    terminalOutputRequestIdsRef.current.clear();
    setTerminalLines([]);
    appendLog("terminal cleared", "muted");
  }

  function restoreMessageBuffers(messages: ChatMessage[]) {
    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }

      streamBuffersRef.current.set(message.id, message.text);
      if (message.status === "done") {
        completedResponseIdsRef.current.add(message.id);
      }
    }
  }

  function applySessionSnapshot(snapshot: SessionSnapshot) {
    const nextMessages = snapshot.messages.map(sessionMessageToChatMessage);
    const nextActiveSession = snapshot.sessions.find((session) => session.id === snapshot.activeSessionId) ?? null;
    const previousActiveSessionId = activeSessionIdRef.current;
    activeSessionIdRef.current = snapshot.activeSessionId;
    setActiveSessionId(snapshot.activeSessionId);
    setSessions(snapshot.sessions);
    setTrashedSessions(snapshot.trashedSessions);
    setShowSessionTrash((current) => (snapshot.trashedSessions.length > 0 ? current : false));
    if (
      trashArtifactSessionIdRef.current &&
      !snapshot.trashedSessions.some((session) => session.id === trashArtifactSessionIdRef.current)
    ) {
      trashArtifactSessionIdRef.current = null;
      setTrashArtifactSessionId(null);
      setTrashLedger(null);
    }

    streamBuffersRef.current.clear();
    completedResponseIdsRef.current.clear();
    restoreMessageBuffers(nextMessages);
    chatMessagesRef.current = nextMessages;
    setChatMessages(nextMessages);
    setActiveId(readWorkingAssistantId(nextMessages));
    setInteractions([]);
    setInteractionDrafts({});

    if (nextActiveSession?.activeModel) {
      setSelectedModel(nextActiveSession.activeModel);
      localStorage.setItem(MODEL_STORAGE_KEY, nextActiveSession.activeModel);
    }
    if (nextActiveSession?.activeReasoning) {
      setReasoningEffort(nextActiveSession.activeReasoning);
      localStorage.setItem(REASONING_STORAGE_KEY, nextActiveSession.activeReasoning);
    }
    if (nextActiveSession?.activeMode) {
      setMode(nextActiveSession.activeMode);
    }
    if (previousActiveSessionId && previousActiveSessionId !== snapshot.activeSessionId) {
      pulseSessionControls();
    }
  }

  function send(message: ClientMessage): boolean {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendLog("daemon offline", "error");
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }

  function createNewSession() {
    if (activeId) {
      send({ type: "cancel", id: activeId });
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setShowSessionTrash(false);
    send({
      type: "session.create",
      model: selectedModel,
      reasoningEffort,
      mode
    });
  }

  function openSession(sessionId: string) {
    if (sessionId === activeSessionId) {
      return;
    }
    if (activeId) {
      send({ type: "cancel", id: activeId });
    }
    setShowSessionTrash(false);
    send({ type: "session.open", sessionId });
  }

  function refreshLedger(sessionId = activeSessionId ?? undefined) {
    send({ type: "ledger.refresh", sessionId });
  }

  function viewTrashArtifacts(sessionId: string) {
    const nextSessionId = trashArtifactSessionIdRef.current === sessionId ? null : sessionId;
    trashArtifactSessionIdRef.current = nextSessionId;
    setTrashArtifactSessionId(nextSessionId);
    setTrashLedger(null);
    if (nextSessionId) {
      refreshLedger(nextSessionId);
    }
  }

  function openArtifactFile(artifactFileId: string, versionId?: string) {
    send({ type: "artifact.open", artifactFileId, versionId });
  }

  function trashSession(sessionId: string) {
    if (activeId) {
      send({ type: "cancel", id: activeId });
    }
    if (trashArtifactSessionIdRef.current === sessionId) {
      trashArtifactSessionIdRef.current = null;
      setTrashArtifactSessionId(null);
      setTrashLedger(null);
    }
    if (isDisposableNewChatSession(findSessionSummary(sessionId))) {
      send({ type: "session.discard", sessionId });
      return;
    }
    send({ type: "session.trash", sessionId });
  }

  function restoreSession(sessionId: string) {
    if (activeId) {
      send({ type: "cancel", id: activeId });
    }
    if (trashArtifactSessionIdRef.current === sessionId) {
      trashArtifactSessionIdRef.current = null;
      setTrashArtifactSessionId(null);
      setTrashLedger(null);
    }
    send({ type: "session.restore", sessionId });
  }

  function deleteSession(sessionId: string) {
    if (activeId) {
      send({ type: "cancel", id: activeId });
    }
    if (trashArtifactSessionIdRef.current === sessionId) {
      trashArtifactSessionIdRef.current = null;
      setTrashArtifactSessionId(null);
      setTrashLedger(null);
    }
    send({ type: "session.delete", sessionId });
  }

  function findSessionSummary(sessionId: string): SessionSummary | undefined {
    return sessions.find((session) => session.id === sessionId) ?? trashedSessions.find((session) => session.id === sessionId);
  }

  function isDisposableNewChatSession(session: SessionSummary | undefined): boolean {
    return Boolean(
      session &&
        session.title.trim().toLowerCase() === "new chat" &&
        (session.messageCount ?? 0) === 0 &&
        (session.artifactCount ?? 0) === 0
    );
  }

  function resetVisibleSession(sendToDaemon = true) {
    if (activeId && sendToDaemon) {
      send({ type: "cancel", id: activeId });
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    streamBuffersRef.current.clear();
    completedResponseIdsRef.current.clear();
    terminalRequestIdsRef.current.clear();
    terminalOutputRequestIdsRef.current.clear();
    terminalOutputOpenRef.current = false;
    setActiveId(null);
    setSpeakingMessageId(null);
    setOpenActionMenuId(null);
    setInteractions([]);
    setInteractionDrafts({});
    updateBranchContext(null);
    setChatMessages([]);
    setTerminalLines([]);
    localStorage.removeItem(CHAT_STORAGE_KEY);
    if (sendToDaemon) {
      send({ type: "session.reset" });
    }
  }

  function respondToInteraction(
    interaction: RuntimeInteraction,
    decision: RuntimeInteractionDecision
  ) {
    const answers = interactionDrafts[interaction.id] ?? {};
    send({
      type: "interaction.respond",
      id: interaction.id,
      decision,
      action: interaction.action,
      answers
    });
    setInteractions((current) => current.filter((item) => item.id !== interaction.id));
    setInteractionDrafts((current) => {
      const next = { ...current };
      delete next[interaction.id];
      return next;
    });
    appendLog(decision === "approve" || decision === "always_allow" ? "approved" : decision === "decline" ? "declined" : "submitted", "tool");
  }

  function updateExecutionPermission(action: string, decision: ExecutionPermissionDecision) {
    send({
      type: "execution.permission.set",
      action,
      decision
    });
  }

  function startBrowserAction(mode: BrowserActionMode) {
    const actionSessionId = `browser-action-ui-${crypto.randomUUID()}`;
    setBrowserAction((current) => ({
      ...current,
      actionSessionId,
      safetyMode: mode,
      progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: "starting" }],
      error: null
    }));
    send({
      type: "browserAction.start",
      actionSessionId,
      sessionId: activeSessionId ?? undefined,
      mode
    });
    send({ type: "browserAction.adapters", actionSessionId });
  }

  function refreshBrowserActionAdapters() {
    send({ type: "browserAction.adapters", actionSessionId: browserAction.actionSessionId ?? undefined });
  }

  function observeBrowserAction() {
    if (!browserAction.actionSessionId) {
      startBrowserAction(browserAction.safetyMode);
      return;
    }
    send({ type: "browserAction.observe", actionSessionId: browserAction.actionSessionId });
  }

  function runBrowserActionCommand(command: BrowserActionDirectCommandInput) {
    const actionSessionId = browserAction.actionSessionId ?? command.actionSessionId;
    send({
      type: "browserAction.command",
      requestId: `browser-action-direct-${crypto.randomUUID()}`,
      command: {
        ...command,
        actionSessionId: actionSessionId ?? undefined,
        sessionId: activeSessionId ?? command.sessionId,
        mode: command.mode ?? browserAction.safetyMode
      }
    });
    setBrowserAction((current) => ({
      ...current,
      progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: `direct_${command.kind}` }],
      error: null
    }));
  }

  function setBrowserActionSafetyMode(mode: BrowserActionMode) {
    setBrowserAction((current) => ({
      ...current,
      safetyMode: mode
    }));
  }

  function cancelBrowserAction() {
    if (!browserAction.actionSessionId) {
      return;
    }
    send({ type: "browserAction.cancel", actionSessionId: browserAction.actionSessionId });
    setBrowserAction((current) => ({
      ...current,
      progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: "cancel_requested" }]
    }));
  }

  function updateBrowserActionPolicy(decision: BrowserActionPolicyDecision) {
    send({
      type: "browserAction.policy.set",
      policy: {
        decision,
        actionFamily: decision === "deny" ? "all" : decision === "allow" ? "safe_read_scroll" : "safe_click_type",
        targetRisk: decision === "deny" ? "destructive" : "low",
        mode: "any",
        note: decision === "allow" ? "Renderer quick policy for safe Browser Action reads and scrolls." : "Renderer quick Browser Action policy."
      }
    });
  }

  function updateInteractionDraft(interactionId: string, fieldId: string, value: string) {
    setInteractionDrafts((current) => ({
      ...current,
      [interactionId]: {
        ...(current[interactionId] ?? {}),
        [fieldId]: value
      }
    }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!startAsk(text, mode)) {
      return;
    }

    setInput("");
  }

  function startAsk(text: string, requestMode: WidgetMode): boolean {
    if (!text || activeId) {
      return false;
    }

    const id = crypto.randomUUID();
    const userMessage: ChatMessage = {
      id: `user:${id}`,
      role: "user",
      text
    };
    const assistantMessage: ChatMessage = {
      id,
      role: "assistant",
      text: "",
      status: "pending"
    };
    setActiveId(id);
    streamBuffersRef.current.set(id, "");
    completedResponseIdsRef.current.delete(id);
    if (requestMode === "terminal") {
      registerTerminalRequest(id, text);
    }
    setChatMessages((current) => [...current, userMessage, assistantMessage]);
    const currentBranchContext = branchContextRef.current;
    send({
      type: "ask",
      id,
      text,
      mode: requestMode,
      sessionId: activeSessionId ?? undefined,
      model: selectedModel,
      reasoningEffort,
      branchContext: currentBranchContext ?? undefined
    });
    updateBranchContext(null);
    return true;
  }

  function submitFromPromptKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function cancel() {
    if (!activeId) {
      return;
    }
    send({ type: "cancel", id: activeId });
    markAssistantMessage(activeId, "cancelled");
    setActiveId(null);
  }

  function selectMode(nextMode: WidgetMode) {
    if (nextMode === mode) {
      if (nextMode === "browser") {
        setShowBrowserActionMenu((current) => !current);
      }
      return;
    }

    if (nextMode === "screen") {
      setMode("screen");
      setShowVisionMenu(true);
      setShowBrowserActionMenu(false);
      return;
    }

    if (nextMode === "browser") {
      setMode("browser");
      setShowBrowserActionMenu(true);
      setShowVisionMenu(false);
      return;
    }

    setShowVisionMenu(false);
    setShowBrowserActionMenu(false);
    setMode(nextMode);
  }

  function toggleVisionMenuFromModeBar() {
    setShowVisionMenu((current) => !current);
  }

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

  function captureScreen() {
    setMode("screen");
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
    send({
      type: "provider.captureScreen",
      description: input.trim() || undefined,
      crop: buildScreenCrop(screenCrop)
    });
  }

  async function startVisionRecording() {
    setMode("screen");
    setShowVisionMenu(false);
    if (!canUseDisplayCapture() || typeof MediaRecorder === "undefined") {
      appendLog("screen recording unavailable", "error");
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
      send({
        type: "provider.vision.start",
        id,
        mode: "recording",
        sessionId: activeSessionId ?? undefined,
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
      send({ type: "provider.vision.error", id, message: error instanceof Error ? error.message : "Unable to start screen recording." });
      appendLog(error instanceof Error ? error.message : "recording failed", "error");
    }
  }

  async function startAgentScreenStream() {
    setMode("screen");
    setShowVisionMenu(false);
    if (!canUseDisplayCapture()) {
      appendLog("screen sharing unavailable", "error");
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
      send({
        type: "visionContext.start",
        captureId: id,
        sessionId: activeSessionId ?? undefined,
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
      if (input.trim()) {
        send({
          type: "visionContext.event",
          captureId: id,
          event: {
            type: "speech",
            t: 0,
            text: input.trim(),
            confidence: 0.9
          }
        });
      }
      send({
        type: "provider.vision.start",
        id,
        mode: "agent_stream",
        sessionId: activeSessionId ?? undefined,
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
      send({ type: "provider.vision.error", id, message: error instanceof Error ? error.message : "Unable to start Agent screen stream." });
      appendLog(error instanceof Error ? error.message : "screen stream failed", "error");
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
      send({ type: "provider.vision.stop", id: visionSession.id, reason });
    }
  }

  function stopAgentScreenStream(id = visionSession?.id, reason = "user stopped") {
    setShowVisionMenu(false);
    clearVisionGuardTimer();
    stopVisionFrameStreaming();
    stopVisionMediaTracks();
    if (id && !visionFinalizedIdsRef.current.has(id)) {
      visionFinalizedIdsRef.current.add(id);
      send({ type: "provider.vision.stop", id, reason });
      send({
        type: "visionContext.stop",
        captureId: id,
        sendToAgent: true,
        sessionId: activeSessionId ?? undefined,
        model: selectedModel,
        reasoningEffort
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
      send({ type: "provider.vision.error", id, message: "Recording exceeded the local size guardrail." });
      appendLog("recording too large", "error");
      return;
    }
    if (blob.size === 0) {
      send({ type: "provider.vision.stop", id, reason: "empty recording" });
      return;
    }
    const dataUrl = await blobToDataUrl(blob);
    send({
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
      const response = await fetch(`http://127.0.0.1:${daemonPort}/providers/screen/snapshot`, {
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
        appendLog("screen stream frame failed", "error");
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

  function toggleVoicePromptInput() {
    if (voiceListening) {
      stopVoicePromptInput();
      return;
    }
    startVoicePromptInput();
  }

  function startVoicePromptInput() {
    const Recognition = readSpeechRecognitionConstructor();
    if (!Recognition) {
      appendLog("voice input unavailable", "error");
      return;
    }

    stopVoicePromptInput(false);
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    voicePromptBaseRef.current = input.trimEnd();
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
      }
      const separator = voicePromptBaseRef.current && transcript.trim() ? " " : "";
      setInput(`${voicePromptBaseRef.current}${separator}${transcript}`.trimStart());
    };
    recognition.onerror = (event) => {
      appendLog(event.error ? `voice input ${event.error}` : "voice input failed", "error");
    };
    recognition.onend = () => {
      if (voiceRecognitionRef.current === recognition) {
        voiceRecognitionRef.current = null;
      }
      setVoiceListening(false);
    };
    voiceRecognitionRef.current = recognition;
    setVoiceListening(true);
    try {
      recognition.start();
    } catch (error) {
      voiceRecognitionRef.current = null;
      setVoiceListening(false);
      appendLog(error instanceof Error ? error.message : "voice input failed", "error");
    }
  }

  function stopVoicePromptInput(updateState = true) {
    const recognition = voiceRecognitionRef.current;
    voiceRecognitionRef.current = null;
    if (recognition) {
      recognition.stop();
    }
    if (updateState) {
      setVoiceListening(false);
    }
  }

  function updateScreenCropField(field: keyof ScreenCrop, value: string) {
    setScreenCrop((current) => ({
      ...current,
      [field]: normalizeScreenCropField(field, Number.parseInt(value, 10))
    }));
  }

  function setScreenCropPicker(next: ScreenCropPickerState | null) {
    screenCropPickerRef.current = next;
    setScreenCropPickerState(next);
  }

  async function startScreenCropPicker() {
    setMode("screen");
    const geometry = await readWidgetWindowGeometry();
    setScreenCropPicker({
      pointerId: null,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      geometry
    });
    appendLog("drag crop region", "tool");
  }

  function beginScreenCropPick(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const current = screenCropPickerRef.current;
    if (!current) {
      return;
    }

    const point = readCropPickerPoint(event.currentTarget, event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setScreenCropPicker({
      ...current,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y
    });
  }

  function updateScreenCropPick(event: PointerEvent<HTMLDivElement>) {
    const current = screenCropPickerRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    const point = readCropPickerPoint(event.currentTarget, event);
    setScreenCropPicker({
      ...current,
      currentX: point.x,
      currentY: point.y
    });
  }

  function finishScreenCropPick(event: PointerEvent<HTMLDivElement>) {
    const current = screenCropPickerRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const selection = readScreenCropPickerSelection(current);
    if (selection.width >= 8 && selection.height >= 8) {
      setScreenCrop({
        enabled: true,
        ...convertPickerSelectionToScreenCrop(selection, current)
      });
    }
    setScreenCropPicker(null);
  }

  function runTerminalQuickAction(command: string) {
    setMode("terminal");
    startAsk(command, "terminal");
  }

  function openTerminalPopout() {
    setMode("terminal");
    const url = new URL(window.location.href);
    url.searchParams.set("daemonPort", daemonPort);
    url.searchParams.set("mode", "terminal");
    url.searchParams.set("surface", "pty");
    const popup = window.open(url.toString(), "codex-widget-pty", "popup,width=920,height=640");
    appendLog(popup ? "pty popup opened" : "pty popup blocked", popup ? "tool" : "error");
  }

  function sendTerminalRawInput(data: string, label: string) {
    const id = crypto.randomUUID();
    return send({
      type: "terminal.input",
      id,
      data,
      label
    });
  }

  function sendTerminalInput() {
    const text = terminalInput.trimEnd();
    if (!text) {
      return;
    }

    if (sendTerminalRawInput(`${text}\r`, text)) {
      setTerminalInput("");
    }
  }

  function sendTerminalKey(name: TerminalKeyName) {
    sendTerminalRawInput(terminalKeyToInput(name), terminalKeyToLabel(name));
  }

  function copyMessage(id: string, fallbackText: string) {
    const text = streamBuffersRef.current.get(id) ?? fallbackText;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => appendLog("copied response", "tool"))
      .catch(() => appendLog("copy unavailable", "error"));
  }

  function copyCodeBlock(text: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => appendLog("copied code", "tool"))
      .catch(() => appendLog("copy unavailable", "error"));
  }

  function branchFromAssistantMessage(messageId: string) {
    if (activeId) {
      setOpenActionMenuId(null);
      appendLog("branch unavailable while active", "muted");
      return;
    }

    const messageIndex = chatMessages.findIndex((message) => message.id === messageId);
    const assistantMessage = chatMessages[messageIndex];
    const userMessage = findPreviousUserMessage(chatMessages, messageIndex);
    if (!userMessage || assistantMessage?.role !== "assistant") {
      setOpenActionMenuId(null);
      appendLog("branch unavailable", "error");
      return;
    }

    const assistantText = streamBuffersRef.current.get(messageId) ?? assistantMessage.text;
    const nextBranchContext: BranchContextMessage[] = [
      { role: "user", text: userMessage.text },
      { role: "assistant", text: assistantText }
    ];
    setOpenActionMenuId(null);
    if (
      !send({
        type: "session.branch",
        messages: nextBranchContext,
        sourceMessageId: messageId,
        title: userMessage.text,
        model: selectedModel,
        reasoningEffort,
        mode
      })
    ) {
      return;
    }
    streamBuffersRef.current.clear();
    completedResponseIdsRef.current.clear();
    updateBranchContext(nextBranchContext);
    appendLog("branched to new session", "tool");
    showToast("Branched to new session");
  }

  function updateBranchContext(nextContext: BranchContextMessage[] | null) {
    branchContextRef.current = nextContext;
    setBranchContext(nextContext);
  }

  function readMessageAloud(id: string, fallbackText: string) {
    if (speakingMessageId === id) {
      stopReadAloud();
      return;
    }

    const text = createSpeechText(streamBuffersRef.current.get(id) ?? fallbackText);
    if (!text) {
      setOpenActionMenuId(null);
      appendLog("nothing to read", "muted");
      return;
    }

    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setOpenActionMenuId(null);
      appendLog("speech unavailable", "error");
      return;
    }

    speechRunIdRef.current += 1;
    const speechRunId = speechRunIdRef.current;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = pickSpeechLanguage(text);
    utterance.voice = pickSpeechVoice(utterance.lang);
    utterance.rate = 0.94;
    utterance.pitch = 1;
    utterance.onend = () => {
      if (speechRunIdRef.current === speechRunId) {
        setSpeakingMessageId(null);
      }
    };
    utterance.onerror = () => {
      if (speechRunIdRef.current === speechRunId) {
        setSpeakingMessageId(null);
        appendLog("speech stopped", "muted");
      }
    };
    setSpeakingMessageId(id);
    window.speechSynthesis.speak(utterance);
    setOpenActionMenuId(null);
    appendLog("reading response", "tool");
  }

  function stopReadAloud() {
    speechRunIdRef.current += 1;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageId(null);
    setOpenActionMenuId(null);
    appendLog("reading stopped", "muted");
  }

  function retryAssistantMessage(messageId: string) {
    if (activeId) {
      return;
    }

    const messageIndex = chatMessages.findIndex((message) => message.id === messageId);
    const assistantMessage = chatMessages[messageIndex];
    const userMessage = findPreviousUserMessage(chatMessages, messageIndex);
    if (!userMessage || assistantMessage?.role !== "assistant") {
      appendLog("no prompt to retry", "error");
      return;
    }

    const nextId = crypto.randomUUID();
    const removedAssistantIds = chatMessages
      .slice(messageIndex)
      .filter((message): message is Extract<ChatMessage, { role: "assistant" }> => message.role === "assistant")
      .map((message) => message.id);

    for (const removedId of removedAssistantIds) {
      streamBuffersRef.current.delete(removedId);
      completedResponseIdsRef.current.delete(removedId);
      terminalRequestIdsRef.current.delete(removedId);
      terminalOutputRequestIdsRef.current.delete(removedId);
    }

    setActiveId(nextId);
    streamBuffersRef.current.set(nextId, "");
    completedResponseIdsRef.current.delete(nextId);
    if (mode === "terminal") {
      registerTerminalRequest(nextId, userMessage.text);
    }
    setOpenActionMenuId(null);
    if (speakingMessageId && removedAssistantIds.includes(speakingMessageId)) {
      stopReadAloud();
    }

    const nextAssistant: ChatMessage = {
      id: nextId,
      role: "assistant",
      text: "",
      status: "pending"
    };
    setChatMessages((current) => {
      const currentIndex = current.findIndex((message) => message.id === messageId);
      if (currentIndex < 0) {
        return [...current, nextAssistant];
      }
      return [...current.slice(0, currentIndex), nextAssistant];
    });
    send({
      type: "ask",
      id: nextId,
      text: userMessage.text,
      mode,
      sessionId: activeSessionId ?? undefined,
      model: selectedModel,
      reasoningEffort,
      regenerate: {
        dropTurns: Math.max(1, removedAssistantIds.length),
        replaceFromMessageId: messageId
      }
    });
  }

  function togglePinState() {
    void togglePinned().then((nextPinned) => {
      setPinned(nextPinned);
      appendLog(nextPinned ? "Pinned" : "Unpinned", "tool");
    });
  }

  function minimize() {
    void minimizeWidget().then(() => appendLog("Minimized", "muted"));
  }

  function toggleMaximize() {
    void toggleMaximizeWidget().then((nextMaximized) => {
      setMaximized(nextMaximized);
      appendLog(nextMaximized ? "Maximized" : "Restored", "muted");
    });
  }

  function updateOpacity(value: string) {
    const nextOpacity = clampOpacity(Number(value));
    setOpacity(nextOpacity);
    localStorage.setItem("codex-widget-opacity", String(nextOpacity));
    revealOpacityValue();
  }

  function updateSelectedModel(value: string) {
    const nextModel = normalizeModelId(value);
    setSelectedModel(nextModel);
    localStorage.setItem(MODEL_STORAGE_KEY, nextModel);
  }

  function updateReasoningEffort(value: string) {
    const nextEffort = normalizeReasoningEffort(value);
    setReasoningEffort(nextEffort);
    localStorage.setItem(REASONING_STORAGE_KEY, nextEffort);
  }

  function showToast(text: string) {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastNotice({ id: Date.now(), text });
    toastTimerRef.current = window.setTimeout(() => {
      setToastNotice(null);
      toastTimerRef.current = null;
    }, 1900);
  }

  function pulseSessionControls() {
    if (sessionControlsPulseTimerRef.current !== null) {
      window.clearTimeout(sessionControlsPulseTimerRef.current);
    }
    setSessionControlsFlashing(true);
    sessionControlsPulseTimerRef.current = window.setTimeout(() => {
      setSessionControlsFlashing(false);
      sessionControlsPulseTimerRef.current = null;
    }, 1000);
  }

  function revealOpacityValue() {
    if (opacityValueTimerRef.current !== null) {
      window.clearTimeout(opacityValueTimerRef.current);
    }
    setShowOpacityValue(true);
    opacityValueTimerRef.current = window.setTimeout(() => {
      setShowOpacityValue(false);
      opacityValueTimerRef.current = null;
    }, 850);
  }

  function hideOpacityValueSoon() {
    if (opacityValueTimerRef.current !== null) {
      window.clearTimeout(opacityValueTimerRef.current);
    }
    opacityValueTimerRef.current = window.setTimeout(() => {
      setShowOpacityValue(false);
      opacityValueTimerRef.current = null;
    }, 220);
  }

  function authAction() {
    if (auth.authenticated) {
      send({ type: "auth.logout" });
      return;
    }

    if (auth.signInMethod === "token") {
      setShowSettings(false);
      setShowTokenForm(true);
      if (auth.proxyUrl) {
        setProxyInput(auth.proxyUrl);
      }
      if (auth.modelLabel) {
        setModelLabelInput(auth.modelLabel);
      }
      appendLog("oauth token required", "muted");
      return;
    }

    send({ type: "auth.start" });
  }

  function toggleSettings() {
    setShowSettings((current) => {
      const next = !current;
      if (next) {
        setShowTokenForm(false);
      }
      return next;
    });
  }

  function updateAutostart(enabled: boolean) {
    setAutostartEnabledState(enabled);
    void setAutostartEnabled(enabled)
      .then((nextEnabled) => {
        setAutostartEnabledState(nextEnabled);
        appendLog(nextEnabled ? "start at login enabled" : "start at login disabled", "tool");
      })
      .catch(() => {
        setAutostartEnabledState(!enabled);
        appendLog("start at login unavailable", "error");
      });
  }

  function saveToken(event: FormEvent) {
    event.preventDefault();
    const accessToken = tokenInput.trim();
    const proxyUrl = proxyInput.trim();
    if (!accessToken || !proxyUrl) {
      appendLog("token and proxy required", "error");
      return;
    }

    send({
      type: "auth.save-token",
      accessToken,
      proxyUrl,
      modelLabel: modelLabelInput.trim() || "oauth-token"
    });
  }

  function focusPromptInput(event: PointerEvent<HTMLFormElement>) {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button, .prompt-resize-handle")) {
      return;
    }

    window.requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
  }

  function beginPromptResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    promptResizeRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startHeight: promptHeight
    };
    document.body.classList.add("is-resizing-prompt");
  }

  function updatePromptResize(event: PointerEvent<HTMLDivElement>) {
    const state = promptResizeRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaY = state.startClientY - event.clientY;
    setPromptHeight(clampPromptHeight(state.startHeight + deltaY, readPromptHeightLimit()));
  }

  function readPromptHeightLimit(): number {
    const panel = conversationRef.current?.closest(".widget-panel");
    const panelHeight = panel instanceof HTMLElement ? panel.clientHeight : undefined;
    return getPromptHeightLimit(maximized, panelHeight);
  }

  function finishPromptResize(event: PointerEvent<HTMLDivElement>) {
    const state = promptResizeRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    promptResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.classList.remove("is-resizing-prompt");
  }

  function beginMascotDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.detail >= 2) {
      toggleMaximize();
      return;
    }

    void startDragWidget();
  }

  function beginResize(direction: WidgetResizeDirection, event: PointerEvent<HTMLDivElement>) {
    if (maximized || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startClientX = event.clientX;
    const startClientY = event.clientY;

    void startResizeWidget(direction).then((nativeStarted) => {
      if (nativeStarted) {
        return;
      }

      target.setPointerCapture(pointerId);
      void beginManualResize({
        direction,
        pointerId,
        target,
        startClientX,
        startClientY
      });
    });
  }

  async function beginManualResize(options: {
    direction: WidgetResizeDirection;
    pointerId: number;
    target: HTMLDivElement;
    startClientX: number;
    startClientY: number;
  }) {
    const geometry = await readWidgetWindowGeometry();
    if (!geometry) {
      return;
    }

    resizeDragRef.current = {
      direction: options.direction,
      pointerId: options.pointerId,
      target: options.target,
      startClientX: options.startClientX,
      startClientY: options.startClientY,
      lastClientX: options.startClientX,
      lastClientY: options.startClientY,
      startX: geometry.x,
      startY: geometry.y,
      startWidth: geometry.width,
      startHeight: geometry.height,
      minWidth: MIN_WINDOW_WIDTH * geometry.scaleFactor,
      minHeight: MIN_WINDOW_HEIGHT * geometry.scaleFactor,
      scaleFactor: geometry.scaleFactor,
      frameId: null,
      applying: false,
      queued: false,
      ended: false
    };
    document.body.classList.add("is-resizing-widget");
  }

  function updateResize(event: PointerEvent<HTMLDivElement>) {
    const state = resizeDragRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
    scheduleResizeFrame(state);
  }

  function finishResize(event: PointerEvent<HTMLDivElement>) {
    const state = resizeDragRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    if (state.frameId !== null) {
      window.cancelAnimationFrame(state.frameId);
      state.frameId = null;
    }
    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
    state.ended = true;
    state.queued = true;
    applyLatestResizeFrame(state);
    if (state.target.hasPointerCapture(state.pointerId)) {
      state.target.releasePointerCapture(state.pointerId);
    }
  }

  function scheduleResizeFrame(state: ResizeDragState) {
    if (state.frameId !== null) {
      return;
    }

    state.frameId = window.requestAnimationFrame(() => {
      state.frameId = null;
      applyLatestResizeFrame(state);
    });
  }

  function applyLatestResizeFrame(state: ResizeDragState) {
    if (state.applying) {
      state.queued = true;
      return;
    }

    state.applying = true;
    state.queued = false;
    void setWidgetWindowFrame(calculateResizeFrame(state)).finally(() => {
      state.applying = false;
      if (state.queued) {
        scheduleResizeFrame(state);
        return;
      }
      if (state.ended) {
        cleanupResizeState(state);
      }
    });
  }

  function cleanupResizeState(state: ResizeDragState) {
    if (resizeDragRef.current === state) {
      resizeDragRef.current = null;
    }
    document.body.classList.remove("is-resizing-widget");
  }

  const busy = Boolean(activeId);
  const activeMode = MODES.find((item) => item.mode === mode) ?? MODES[0];
  const ActiveModeIcon = activeMode.icon;
  const providerStatusByMode = useMemo(
    () => new Map(providerStatuses.map((provider) => [provider.mode, provider])),
    [providerStatuses]
  );
  const activeProviderStatus = providerStatusByMode.get(mode);
  const terminalProviderStatus = providerStatusByMode.get("terminal");
  const visibleActivities = ledger?.activities.slice(0, 1) ?? [];
  const providerSnapshots = ledger?.providerSnapshots ?? [];
  const activityBadgeCount = ledger ? ledger.activities.length + ledger.artifacts.length + providerSnapshots.length : 0;
  const statusTone = connected ? (auth.authenticated ? "online" : "warning") : "offline";
  const displayStatus = connected ? status : formatNativeDaemonStatus(nativeDaemonStatus, status);
  const authLabel = auth.authenticated ? "Sign out" : "Sign in";
  const liveLabel = auth.authenticated
    ? auth.modelLabel && auth.modelLabel !== "codex"
      ? auth.modelLabel
      : ""
    : auth.reason ?? "Not signed in";
  const opacityLabel = `${Math.round(opacity * 100)}%`;
  const shellStyle = { "--widget-opacity": String(opacity) } as CSSProperties;
  const authButtonTitle = auth.authenticated
    ? "Sign out"
    : auth.signInAvailable
      ? "Sign in"
      : auth.reason ?? "Sign in is not configured";
  const panelStyle = { "--prompt-composer-height": `${promptHeight}px` } as CSSProperties;
  const isOverlayPanelOpen = showSettings || showTokenForm;
  const cropPickerSelection = screenCropPicker ? readScreenCropPickerSelection(screenCropPicker) : null;
  const cropPickerSelectionStyle = cropPickerSelection ? (cropPickerSelection as CSSProperties) : undefined;
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

  const voiceInputAvailable = canUseVoiceInput();
  const mascotStateClass = [
    "mascot",
    !connected ? "is-offline" : "",
    busy ? "is-working" : "",
    isVisionRecording ? "is-recording" : "",
    isVisionStreaming ? "is-streaming" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const mascotMotionStatus: MascotMotionStatus = !connected
    ? "offline"
    : isVisionRecording
      ? "recording"
      : isVisionStreaming
        ? "streaming"
        : busy
          ? "working"
          : "idle";

  return (
    <main className={maximized ? "widget-shell is-maximized" : "widget-shell"} style={shellStyle}>
      <section
        className={isOverlayPanelOpen ? "widget-panel is-overlay-mode" : "widget-panel"}
        style={panelStyle}
        aria-live="polite"
      >
        {RESIZE_HANDLES.map((handle) => (
          <div
            key={handle.direction}
            className={`resize-handle ${handle.className}`}
            aria-hidden="true"
            onPointerDown={(event) => beginResize(handle.direction, event)}
            onPointerMove={updateResize}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
          />
        ))}

        <TitleBar
          appIconUrl={appIconUrl}
          opacity={opacity}
          opacityLabel={opacityLabel}
          showOpacityValue={showOpacityValue}
          pinned={pinned}
          maximized={maximized}
          onOpacityChange={updateOpacity}
          onOpacityEditStart={revealOpacityValue}
          onOpacityEditEnd={hideOpacityValueSoon}
          onTogglePin={togglePinState}
          onMinimize={minimize}
          onToggleMaximize={toggleMaximize}
          onClose={() => void closeWidget()}
        />

        <SystemStrip
          statusTone={statusTone}
          displayStatus={displayStatus}
          statusTitle={nativeDaemonStatus?.lastEvent ?? undefined}
          liveLabel={liveLabel}
          authenticated={auth.authenticated}
          authLabel={authLabel}
          authButtonTitle={authButtonTitle}
          authDisabled={!connected || (!auth.authenticated && !auth.signInAvailable)}
          settingsOpen={showSettings}
          onAuthAction={authAction}
          onToggleSettings={toggleSettings}
        />

        <SessionStrip
          sessions={sessions}
          activeSessionId={activeSessionId}
          trashedSessions={trashedSessions}
          showSessionTrash={showSessionTrash}
          trashArtifactSessionId={trashArtifactSessionId}
          trashLedger={trashLedger}
          onOpenSession={openSession}
          onTrashSession={trashSession}
          onCreateNewSession={createNewSession}
          onToggleTrash={() => setShowSessionTrash((current) => !current)}
          onViewTrashArtifacts={viewTrashArtifacts}
          onRestoreSession={restoreSession}
          onDeleteSession={deleteSession}
          onOpenArtifactFile={openArtifactFile}
        />

        {toastNotice ? (
          <div key={toastNotice.id} className="widget-toast" role="status" aria-live="polite">
            <Check size={13} />
            <span>{toastNotice.text}</span>
          </div>
        ) : null}

        <ModeTabs
          mode={mode}
          providerStatusByMode={providerStatusByMode}
          browserButtonRef={browserModeButtonRef}
          visionButtonRef={visionModeButtonRef}
          onModeChange={selectMode}
        />

        <BrowserActionMenu
          open={showBrowserActionMenu}
          state={browserAction}
          anchorRef={browserModeButtonRef}
          onCommand={runBrowserActionCommand}
          onCancel={cancelBrowserAction}
          onPolicyChange={updateBrowserActionPolicy}
          onSafetyModeChange={setBrowserActionSafetyMode}
        />

        <VisionActionMenu
          open={showVisionMenu}
          statusLabel={visionStateLabel}
          recording={isVisionRecording}
          streaming={isVisionStreaming}
          settings={visionStreamSettings}
          frameStats={visionFrameStats}
          streamStatusText={visionStreamStatusText}
          anchorRef={visionModeButtonRef}
          renderTrigger={false}
          onToggle={toggleVisionMenuFromModeBar}
          onCapture={captureScreen}
          onRecord={isVisionRecording ? () => stopVisionRecording() : startVisionRecording}
          onStream={isVisionStreaming ? () => stopAgentScreenStream() : startAgentScreenStream}
          onFrameIntervalChange={updateVisionFrameInterval}
          onMaxDurationChange={updateVisionMaxDuration}
        />

        <VisionStatusPanel
          notice={visionNotice}
          onStopLive={isVisionRecording ? () => stopVisionRecording() : isVisionStreaming ? () => stopAgentScreenStream() : undefined}
        />

        {showSettings ? (
          <SettingsPanel
            autostartEnabled={autostartEnabled}
            runtimeStatus={runtimeStatus}
            nativeDaemonStatus={nativeDaemonStatus}
            providerStatuses={providerStatuses}
            executionPermissions={executionPermissions}
            screenCrop={screenCrop}
            onAutostartChange={updateAutostart}
            onExecutionPermissionChange={updateExecutionPermission}
            onCaptureScreen={captureScreen}
            onScreenCropEnabledChange={(enabled) => setScreenCrop((current) => ({ ...current, enabled }))}
            onScreenCropFieldChange={updateScreenCropField}
            onStartScreenCropPicker={startScreenCropPicker}
          />
        ) : showTokenForm ? (
          <form className="auth-panel" onSubmit={saveToken}>
            <label>
              <span>Agent proxy URL</span>
              <input
                value={proxyInput}
                onChange={(event) => setProxyInput(event.target.value)}
                placeholder="http://127.0.0.1:8787/agent/stream"
              />
            </label>
            <label>
              <span>Label</span>
              <input
                value={modelLabelInput}
                onChange={(event) => setModelLabelInput(event.target.value)}
                placeholder="oauth-token"
              />
            </label>
            <label className="token-field">
              <span>OAuth access token</span>
              <textarea
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="Paste token"
                spellCheck={false}
              />
            </label>
            <div className="auth-panel-actions">
              <button type="button" onClick={() => setShowTokenForm(false)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Save
              </button>
            </div>
          </form>
        ) : (
          <ConversationPanel
            conversationRef={conversationRef}
            mode={mode}
            busy={busy}
            authAuthenticated={auth.authenticated}
            activeProviderStatus={activeProviderStatus}
            terminalProviderStatus={terminalProviderStatus}
            activeModeLabel={activeMode.label}
            activeModeIcon={activeMode.icon}
            chatMessages={chatMessages}
            interactions={interactions}
            interactionDrafts={interactionDrafts}
            ledger={ledger}
            activeRequestId={activeId}
            openActionMenuId={openActionMenuId}
            speakingMessageId={speakingMessageId}
            terminalLines={terminalLines}
            terminalInput={terminalInput}
            terminalMouseEnabled={terminalMouseEnabled}
            showTerminalGuide={showTerminalGuide}
            browserAction={browserAction}
            onRunTerminalQuickAction={runTerminalQuickAction}
            onClearTerminal={clearTerminalViewport}
            onOpenTerminalPopout={openTerminalPopout}
            onTerminalInputChange={setTerminalInput}
            onTerminalInputSubmit={sendTerminalInput}
            onTerminalKeySend={sendTerminalKey}
            onTerminalMouseEnabledChange={setTerminalMouseEnabled}
            onTerminalMouseInput={sendTerminalRawInput}
            onToggleTerminalGuide={() => setShowTerminalGuide((current) => !current)}
            onBrowserActionStart={startBrowserAction}
            onBrowserActionRefreshAdapters={refreshBrowserActionAdapters}
            onBrowserActionObserve={observeBrowserAction}
            onBrowserActionCancel={cancelBrowserAction}
            onBrowserActionPolicyChange={updateBrowserActionPolicy}
            onCopyCodeBlock={copyCodeBlock}
            onCopyMessage={copyMessage}
            onRegenerateMessage={retryAssistantMessage}
            onToggleMessageActions={(messageId) => setOpenActionMenuId((current) => (current === messageId ? null : messageId))}
            onBranchMessage={branchFromAssistantMessage}
            onReadMessageAloud={readMessageAloud}
            onOpenArtifactFile={openArtifactFile}
            onInteractionChange={updateInteractionDraft}
            onInteractionRespond={respondToInteraction}
          />
        )}

        {!isOverlayPanelOpen ? (
          <>
        <PromptComposer
          promptInputRef={promptInputRef}
          value={input}
          connected={connected}
          busy={busy}
          voiceListening={voiceListening}
          voiceInputAvailable={voiceInputAvailable}
          onValueChange={setInput}
          onSubmit={submit}
          onPromptKeyDown={submitFromPromptKey}
          onFocusFromRow={focusPromptInput}
          onBeginResize={beginPromptResize}
          onUpdateResize={updatePromptResize}
          onFinishResize={finishPromptResize}
          onToggleVoice={toggleVoicePromptInput}
          onCancel={cancel}
        />

        <ModelControls
          selectedModel={selectedModel}
          reasoningEffort={reasoningEffort}
          flashing={sessionControlsFlashing}
          onModelChange={updateSelectedModel}
          onReasoningChange={updateReasoningEffort}
        />

        <ActivityLog
          visibleActivities={visibleActivities}
          fallbackLines={logLines}
          showDetails={showActivityDetails}
          activityBadgeCount={activityBadgeCount}
          ledger={ledger}
          providerSnapshots={providerSnapshots}
          onToggleDetails={() => setShowActivityDetails((current) => !current)}
          onRefresh={refreshLedger}
        />
          </>
        ) : null}
      </section>

      <MascotSprite
        className={mascotStateClass}
        status={mascotMotionStatus}
        onPointerDown={beginMascotDrag}
      />
      {screenCropPicker ? (
        <ScreenCropOverlay
          selection={cropPickerSelection}
          selectionStyle={cropPickerSelectionStyle}
          onPointerDown={beginScreenCropPick}
          onPointerMove={updateScreenCropPick}
          onPointerUp={finishScreenCropPick}
          onCancel={() => setScreenCropPicker(null)}
        />
      ) : null}
      <FloatingTooltipRoot />
    </main>
  );
}



function clampPromptHeight(value: number, maxHeight = PROMPT_COMPOSER_MAX_HEIGHT): number {
  if (!Number.isFinite(value)) {
    return PROMPT_COMPOSER_MIN_HEIGHT;
  }
  return Math.min(maxHeight, Math.max(PROMPT_COMPOSER_MIN_HEIGHT, value));
}

function getPromptHeightLimit(isMaximized: boolean, panelHeight?: number): number {
  const mascotStage = isMaximized ? 0 : readCssPixelVariable("--mascot-stage", DEFAULT_MASCOT_STAGE_HEIGHT);
  const effectivePanelHeight = panelHeight ?? window.innerHeight - mascotStage;
  const availableHeight =
    effectivePanelHeight -
    PROMPT_COMPOSER_RESERVED_ROWS_HEIGHT -
    PROMPT_COMPOSER_MIN_CONVERSATION_HEIGHT;
  return Math.min(
    PROMPT_COMPOSER_MAX_HEIGHT,
    Math.max(PROMPT_COMPOSER_MIN_HEIGHT, availableHeight)
  );
}

function readCssPixelVariable(name: string, fallback: number): number {
  const rawValue = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(rawValue);
  return Number.isFinite(value) ? value : fallback;
}




function createInteractionDraft(interaction: RuntimeInteraction): Record<string, string> {
  const fields = interaction.fields ?? [];
  if (fields.length === 0) {
    return {};
  }

  return Object.fromEntries(fields.map((field) => [field.id, ""]));
}


function calculateResizeFrame(state: ResizeDragState) {
  const direction = state.direction;
  const deltaX = (state.lastClientX - state.startClientX) * state.scaleFactor;
  const deltaY = (state.lastClientY - state.startClientY) * state.scaleFactor;
  let nextX = state.startX;
  let nextY = state.startY;
  let nextWidth = state.startWidth;
  let nextHeight = state.startHeight;

  if (direction.includes("East")) {
    nextWidth = Math.max(state.minWidth, state.startWidth + deltaX);
  }

  if (direction.includes("South")) {
    nextHeight = Math.max(state.minHeight, state.startHeight + deltaY);
  }

  if (direction.includes("West")) {
    nextWidth = Math.max(state.minWidth, state.startWidth - deltaX);
    nextX = state.startX + state.startWidth - nextWidth;
  }

  if (direction.includes("North")) {
    nextHeight = Math.max(state.minHeight, state.startHeight - deltaY);
    nextY = state.startY + state.startHeight - nextHeight;
  }

  return {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight
  };
}
