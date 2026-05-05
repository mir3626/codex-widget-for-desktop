import {
  Activity,
  Ban,
  Bot,
  Camera,
  Check,
  CircleDot,
  CircleStop,
  Copy,
  Eye,
  Globe2,
  LogIn,
  LogOut,
  MessageSquarePlus,
  MoreHorizontal,
  Minus,
  Pin,
  PinOff,
  Play,
  RotateCw,
  Send,
  Settings,
  Square,
  SquareTerminal,
  Trash2,
  Volume2,
  X
} from "lucide-react";
import {
  Children,
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import appIconUrl from "../../src-tauri/icons/icon.png";
import mascotUrl from "./assets/mascot.png";
import {
  MODEL_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  normalizeModelId,
  normalizeReasoningEffort,
  type AuthStatus,
  type BranchContextMessage,
  type ClientMessage,
  type MessageSnapshotStatus,
  type ModelId,
  type ProviderStatus,
  type ReasoningEffort,
  type RuntimeInteraction,
  type RuntimeStatus,
  type ServerEvent,
  type WidgetMode
} from "../shared/protocol.js";
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

type LogLine = {
  id: string;
  text: string;
  tone: "muted" | "tool" | "error";
};

type TerminalLine = {
  id: string;
  text: string;
  kind: "command" | "output" | "system" | "error";
};

type AssistantMessageStatus = "pending" | "thinking" | "tooling" | "streaming" | "typing" | "done" | "cancelled" | "error";

type ChatMessage =
  | {
      id: string;
      role: "user";
      text: string;
    }
  | {
      id: string;
      role: "assistant";
      text: string;
      status: AssistantMessageStatus;
    };

type InteractionDrafts = Record<string, Record<string, string>>;

const MODES: Array<{ mode: WidgetMode; label: string; icon: typeof Bot }> = [
  { mode: "agent", label: "Agent", icon: Bot },
  { mode: "browser", label: "DOM", icon: Globe2 },
  { mode: "screen", label: "Vision", icon: Eye },
  { mode: "terminal", label: "PTY", icon: SquareTerminal }
];

const MODEL_STORAGE_KEY = "codex-widget-model";
const REASONING_STORAGE_KEY = "codex-widget-reasoning-effort";
const CHAT_STORAGE_KEY = "codex-widget-chat-messages:v1";
const BRANCH_CONTEXT_STORAGE_KEY = "codex-widget-branch-context:v1";
const MIN_WINDOW_WIDTH = 320;
const MIN_WINDOW_HEIGHT = 480;
const PROMPT_COMPOSER_MIN_HEIGHT = 46;
const PROMPT_COMPOSER_MAX_HEIGHT = 192;
const PROMPT_COMPOSER_RESERVED_ROWS_HEIGHT = 210;
const PROMPT_COMPOSER_MIN_CONVERSATION_HEIGHT = 48;
const DEFAULT_MASCOT_STAGE_HEIGHT = 126;
const STREAM_TYPE_BASE_INTERVAL_MS = 18;
const TERMINAL_LINE_LIMIT = 260;
const TERMINAL_LINE_MAX_CHARS = 1800;

const RESIZE_HANDLES: Array<{ direction: WidgetResizeDirection; className: string }> = [
  { direction: "North", className: "resize-n" },
  { direction: "East", className: "resize-e" },
  { direction: "South", className: "resize-s" },
  { direction: "West", className: "resize-w" },
  { direction: "NorthEast", className: "resize-ne" },
  { direction: "NorthWest", className: "resize-nw" },
  { direction: "SouthEast", className: "resize-se" },
  { direction: "SouthWest", className: "resize-sw" }
];

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

type PromptResizeState = {
  pointerId: number;
  startClientY: number;
  startHeight: number;
};

export function App() {
  const [mode, setMode] = useState<WidgetMode>("agent");
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
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [branchContext, setBranchContext] = useState<BranchContextMessage[] | null>(() => readStoredBranchContext());
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
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
  const branchContextRef = useRef<BranchContextMessage[] | null>(branchContext);
  const streamBuffersRef = useRef<Map<string, string>>(new Map());
  const completedResponseIdsRef = useRef<Set<string>>(new Set());
  const terminalRequestIdsRef = useRef<Set<string>>(new Set());
  const terminalOutputRequestIdsRef = useRef<Set<string>>(new Set());
  const terminalOutputOpenRef = useRef(false);
  const streamTypingTimerRef = useRef<number | null>(null);
  const speechRunIdRef = useRef(0);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const promptResizeRef = useRef<PromptResizeState | null>(null);
  const opacityValueTimerRef = useRef<number | null>(null);
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
      if (streamTypingTimerRef.current !== null) {
        window.clearTimeout(streamTypingTimerRef.current);
      }
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
      if (target instanceof Element && target.closest(".message-actions-shell")) {
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

  function send(message: ClientMessage): boolean {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendLog("daemon offline", "error");
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
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
    decision: "approve" | "decline" | "submit"
  ) {
    const answers = interactionDrafts[interaction.id] ?? {};
    send({
      type: "interaction.respond",
      id: interaction.id,
      decision,
      answers
    });
    setInteractions((current) => current.filter((item) => item.id !== interaction.id));
    setInteractionDrafts((current) => {
      const next = { ...current };
      delete next[interaction.id];
      return next;
    });
    appendLog(decision === "approve" ? "approved" : decision === "decline" ? "declined" : "submitted", "tool");
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

  function captureScreen() {
    setMode("screen");
    send({
      type: "provider.captureScreen",
      description: input.trim() || undefined
    });
  }

  function runTerminalQuickAction(command: string) {
    setMode("terminal");
    startAsk(command, "terminal");
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

    const branchId = crypto.randomUUID();
    const assistantText = streamBuffersRef.current.get(messageId) ?? assistantMessage.text;
    const nextBranchContext: BranchContextMessage[] = [
      { role: "user", text: userMessage.text },
      { role: "assistant", text: assistantText }
    ];
    setOpenActionMenuId(null);
    if (!send({ type: "session.branch" })) {
      return;
    }
    streamBuffersRef.current.clear();
    streamBuffersRef.current.set(branchId, assistantText);
    completedResponseIdsRef.current.clear();
    completedResponseIdsRef.current.add(branchId);
    updateBranchContext(nextBranchContext);
    setChatMessages([
      {
        id: `user:${branchId}`,
        role: "user",
        text: userMessage.text
      },
      {
        id: branchId,
        role: "assistant",
        text: assistantText,
        status: "done"
      }
    ]);
    appendLog("branched chat", "tool");
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
      model: selectedModel,
      reasoningEffort,
      regenerate: {
        dropTurns: Math.max(1, removedAssistantIds.length)
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

  function beginMascotDrag(event: PointerEvent<HTMLImageElement>) {
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
              onChange={(event) => updateOpacity(event.target.value)}
              onPointerDown={revealOpacityValue}
              onPointerUp={hideOpacityValueSoon}
              onPointerCancel={hideOpacityValueSoon}
              onFocus={revealOpacityValue}
              onBlur={hideOpacityValueSoon}
              aria-label="Widget opacity"
            />
            <output>{opacityLabel}</output>
          </label>

          <div className="titlebar-grip" data-tauri-drag-region />

          <div className="window-controls">
            <button
              className="titlebar-button"
              title="New chat"
              aria-label="New chat"
              onClick={() => resetVisibleSession(true)}
            >
              <MessageSquarePlus size={14} />
            </button>
            <button
              className={pinned ? "pin-button active" : "pin-button"}
              title={pinned ? "Pinned" : "Unpinned"}
              aria-label={pinned ? "Pinned" : "Unpinned"}
              aria-pressed={pinned}
              onClick={togglePinState}
            >
              {pinned ? <Pin size={14} /> : <PinOff size={14} />}
            </button>
            <button
              className="titlebar-button"
              title="Minimize"
              aria-label="Minimize"
              onClick={minimize}
            >
              <Minus size={14} />
            </button>
            <button
              className={maximized ? "titlebar-button active" : "titlebar-button"}
              title={maximized ? "Restore" : "Maximize"}
              aria-label={maximized ? "Restore" : "Maximize"}
              aria-pressed={maximized}
              onClick={toggleMaximize}
            >
              <Square size={12} />
            </button>
            <button className="titlebar-button close" title="Hide to tray" aria-label="Hide to tray" onClick={() => void closeWidget()}>
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="system-strip">
          <div className="status-copy">
            <span className={`status-dot ${statusTone}`} />
            <span className="status-text" title={nativeDaemonStatus?.lastEvent ?? undefined}>
              {displayStatus}
            </span>
            {liveLabel ? <span className="model-label">{liveLabel}</span> : null}
          </div>
          <button
            type="button"
            className={auth.authenticated ? "auth-button signed-in" : "auth-button"}
            title={authButtonTitle}
            aria-label={authLabel}
            disabled={!connected || (!auth.authenticated && !auth.signInAvailable)}
            onClick={authAction}
          >
            {auth.authenticated ? <LogOut size={14} /> : <LogIn size={14} />}
            <span>{authLabel}</span>
          </button>
          <button
            type="button"
            className={showSettings ? "icon-button active" : "icon-button"}
            title="Settings"
            aria-label="Settings"
            aria-pressed={showSettings}
            onClick={toggleSettings}
          >
            <Settings size={14} />
          </button>
        </div>

        <div className="mode-row" role="tablist" aria-label="Mode">
          {MODES.map((item) => {
            const Icon = item.icon;
            const providerStatus = providerStatusByMode.get(item.mode);
            return (
              <button
                key={item.mode}
                className={mode === item.mode ? "mode active" : "mode"}
                title={providerStatus ? `${item.label}: ${providerStatus.detail}` : item.label}
                aria-pressed={mode === item.mode}
                onClick={() => setMode(item.mode)}
              >
                <Icon size={15} />
                <span>{item.label}</span>
                {providerStatus ? <span className={`mode-status-dot ${providerStatus.state}`} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        {showSettings ? (
          <section className="settings-panel" aria-label="Settings">
            <div className="settings-section">
              <div className="settings-heading">
                <strong>Resident</strong>
                <span>Desktop behavior</span>
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={autostartEnabled}
                  onChange={(event) => updateAutostart(event.target.checked)}
                />
                <span>
                  <strong>Start at login</strong>
                  <small>Register this app in the Windows user startup list.</small>
                </span>
              </label>
            </div>

            <div className="settings-section">
              <div className="settings-heading">
                <strong>Runtime</strong>
                <span>{runtimeStatus ? formatRuntimeAge(runtimeStatus.uptimeSeconds) : "Waiting for daemon"}</span>
              </div>
              <div className="runtime-grid">
                <RuntimeMetric label="Clients" value={runtimeStatus?.clients ?? 0} />
                <RuntimeMetric label="Active" value={runtimeStatus?.activeRequests ?? 0} />
                <RuntimeMetric label="Codex" value={runtimeStatus?.codexAppServer.state ?? "closed"} />
                <RuntimeMetric label="Thread" value={runtimeStatus?.codexAppServer.hasThread ? "ready" : "none"} />
                <RuntimeMetric label="Starts" value={runtimeStatus?.codexAppServer.startCount ?? 0} />
                <RuntimeMetric label="Error" value={runtimeStatus?.codexAppServer.lastError ?? "none"} />
                <RuntimeMetric label="Shell" value={nativeDaemonStatus?.state ?? "unknown"} />
                <RuntimeMetric label="Restarts" value={nativeDaemonStatus?.restartCount ?? 0} />
              </div>
            </div>

            <div className="settings-section provider-settings">
              <div className="settings-heading">
                <strong>Providers</strong>
                <span>{providerStatuses.length} modes</span>
              </div>
              {providerStatuses.map((provider) => (
                <div key={provider.mode} className={provider.mode === "screen" ? "provider-row has-action" : "provider-row"}>
                  <span className={`mode-status-dot ${provider.state}`} aria-hidden="true" />
                  <strong>{provider.label}</strong>
                  <span>{provider.detail}</span>
                  {provider.mode === "screen" ? (
                    <button type="button" className="provider-action" title="Capture screen" aria-label="Capture screen" onClick={captureScreen}>
                      <Camera size={12} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
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
          <section ref={conversationRef} className="conversation" aria-label="Conversation">
            {mode === "terminal" ? (
              <TerminalViewport
                lines={terminalLines}
                providerStatus={terminalProviderStatus}
                busy={busy}
                onStart={() => runTerminalQuickAction("/pty start")}
                onStatus={() => runTerminalQuickAction("/pty status")}
                onStop={() => runTerminalQuickAction("/pty stop")}
                onClear={clearTerminalViewport}
              />
            ) : null}
            {chatMessages.length === 0 && interactions.length === 0 && mode !== "terminal" ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <ActiveModeIcon size={20} />
                </span>
                <strong>{auth.authenticated ? "Ready" : "Sign in required"}</strong>
                <span>{activeProviderStatus?.state === "stub" ? "Provider pending" : activeMode.label}</span>
                {mode === "screen" ? (
                  <button type="button" className="empty-action" onClick={captureScreen}>
                    <Camera size={13} />
                    <span>Capture</span>
                  </button>
                ) : null}
              </div>
            ) : (
              <>
              {chatMessages.map((message) =>
                message.role === "user" ? (
                  <article key={message.id} className="message user-message">
                    <p>{message.text}</p>
                  </article>
                ) : (
                  <article
                    key={message.id}
                    className={isAssistantWorking(message.status) ? "message assistant-message is-live" : "message assistant-message"}
                  >
                    {isAssistantWorking(message.status) || message.status === "cancelled" || message.status === "error" ? (
                      <div className="message-state-row">
                        <span className={`response-state ${message.status}`}>
                          {assistantStatusLabel(message.status)}
                          {isAssistantWorking(message.status) ? (
                            <span className="typing-dots" aria-hidden="true">
                              <span />
                              <span />
                              <span />
                            </span>
                          ) : null}
                        </span>
                      </div>
                    ) : null}
                    {message.text ? (
                      <>
                        <div className="markdown-body">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              pre: (props) => <MarkdownPre {...props} onCopyCode={copyCodeBlock} />,
                              table: (props) => <MarkdownTable {...props} />
                            }}
                          >
                            {message.text}
                          </ReactMarkdown>
                          {isAssistantWorking(message.status) ? <span className="typing-cursor" aria-hidden="true" /> : null}
                        </div>
                        {!isAssistantWorking(message.status) ? (
                          <div className="message-actions-shell">
                            <div className="message-actions" aria-label="Response actions">
                              <button
                                type="button"
                                data-tooltip="Copy"
                                aria-label="Copy response"
                                onClick={() => copyMessage(message.id, message.text)}
                              >
                                <Copy size={13} />
                              </button>
                              <button
                                type="button"
                                data-tooltip="Regenerate"
                                aria-label="Regenerate response"
                                disabled={Boolean(activeId)}
                                onClick={() => retryAssistantMessage(message.id)}
                              >
                                <RotateCw size={13} />
                              </button>
                              <button
                                type="button"
                                className={openActionMenuId === message.id ? "active" : ""}
                                data-tooltip="More"
                                aria-label="More response actions"
                                aria-expanded={openActionMenuId === message.id}
                                onClick={() => setOpenActionMenuId((current) => (current === message.id ? null : message.id))}
                              >
                                <MoreHorizontal size={13} />
                              </button>
                        </div>
                            {openActionMenuId === message.id ? (
                              <div className="message-action-menu" role="menu">
                                <button type="button" role="menuitem" onClick={() => branchFromAssistantMessage(message.id)}>
                                  Branch in new chat
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className={speakingMessageId === message.id ? "is-stop" : ""}
                                  onClick={() => readMessageAloud(message.id, message.text)}
                                >
                                  {speakingMessageId === message.id ? (
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
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : isAssistantWorking(message.status) ? (
                      <div className="answer-skeleton" aria-hidden="true" />
                    ) : (
                      <p className="assistant-empty-response">{assistantFallbackText(message.status)}</p>
                    )}
                  </article>
                )
              )}
              {interactions.map((interaction) => (
                <InteractionCard
                  key={interaction.id}
                  interaction={interaction}
                  values={interactionDrafts[interaction.id] ?? {}}
                  onChange={updateInteractionDraft}
                  onRespond={respondToInteraction}
                />
              ))}
              </>
            )}
          </section>
        )}

        {!isOverlayPanelOpen ? (
          <>
        <form className="prompt-row" onPointerDownCapture={focusPromptInput} onSubmit={submit}>
          <div
            className="prompt-resize-handle"
            role="separator"
            aria-label="Resize prompt"
            aria-orientation="horizontal"
            onPointerDown={beginPromptResize}
            onPointerMove={updatePromptResize}
            onPointerUp={finishPromptResize}
            onPointerCancel={finishPromptResize}
          />
          <textarea
            ref={promptInputRef}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={submitFromPromptKey}
            placeholder="Ask Codex"
            disabled={!connected}
            aria-label="Ask Codex"
          />
          {busy ? (
            <button type="button" className="send-button stop" title="Stop" aria-label="Stop response" onClick={cancel}>
              <CircleDot size={17} />
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              title="Send"
              aria-label="Send prompt"
              disabled={!connected || !input.trim()}
            >
              <Send size={17} />
            </button>
          )}
        </form>

        <div className="model-row" aria-label="Model settings">
          <label className="model-field model-field-wide" htmlFor="codex-widget-model-select">
            <span>Model</span>
            <select
              id="codex-widget-model-select"
              aria-label="Model"
              value={selectedModel}
              onChange={(event) => updateSelectedModel(event.target.value)}
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="model-field" htmlFor="codex-widget-reasoning-select">
            <span>Reason</span>
            <select
              id="codex-widget-reasoning-select"
              aria-label="Reasoning effort"
              value={reasoningEffort}
              onChange={(event) => updateReasoningEffort(event.target.value)}
            >
              {REASONING_EFFORT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="log-list" aria-label="Activity">
          <div className="log-statusbar">
            <div className="log-heading">
              <Activity size={12} />
              <span>Activity</span>
            </div>
          </div>
          <div className="log-lines">
            {logLines.slice(0, 2).map((line) => (
              <div key={line.id} className={`log-line ${line.tone}`}>
                {line.text}
              </div>
            ))}
          </div>
        </div>
          </>
        ) : null}
      </section>

      <img
        className="mascot"
        src={mascotUrl}
        alt=""
        draggable={false}
        onPointerDown={beginMascotDrag}
      />
    </main>
  );
}

type TerminalViewportProps = {
  lines: TerminalLine[];
  providerStatus: ProviderStatus | undefined;
  busy: boolean;
  onStart: () => void;
  onStatus: () => void;
  onStop: () => void;
  onClear: () => void;
};

function TerminalViewport({ lines, providerStatus, busy, onStart, onStatus, onStop, onClear }: TerminalViewportProps) {
  const outputRef = useRef<HTMLDivElement | null>(null);
  const providerState = providerStatus?.state ?? "unavailable";
  const providerDetail = providerStatus?.detail ?? "waiting";

  useEffect(() => {
    const output = outputRef.current;
    if (!output) {
      return;
    }
    output.scrollTop = output.scrollHeight;
  }, [lines, busy]);

  return (
    <section className={busy ? "terminal-viewport is-live" : "terminal-viewport"} aria-label="Terminal viewport">
      <div className="terminal-toolbar">
        <div className="terminal-title">
          <SquareTerminal size={14} />
          <strong>PTY</strong>
          <span className={`terminal-state-dot ${providerState}`} aria-hidden="true" />
          <span className="terminal-detail" title={providerDetail}>
            {providerDetail}
          </span>
        </div>
        <div className="terminal-actions" aria-label="Terminal actions">
          <button type="button" title="Start" aria-label="Start terminal session" disabled={busy} onClick={onStart}>
            <Play size={13} />
          </button>
          <button type="button" title="Status" aria-label="Show terminal status" disabled={busy} onClick={onStatus}>
            <Activity size={13} />
          </button>
          <button type="button" title="Stop" aria-label="Stop terminal session" disabled={busy} onClick={onStop}>
            <CircleStop size={13} />
          </button>
          <button type="button" title="Clear" aria-label="Clear terminal viewport" onClick={onClear}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div ref={outputRef} className="terminal-output" role="log" aria-live="polite" aria-label="Terminal output">
        {lines.length === 0 ? (
          <div className="terminal-empty">No terminal output</div>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`terminal-line ${line.kind}`}>
              <span className="terminal-prefix" aria-hidden="true">
                {terminalLinePrefix(line.kind)}
              </span>
              <span className="terminal-line-text">{line.text || " "}</span>
            </div>
          ))
        )}
        {busy ? (
          <div className="terminal-line system terminal-working">
            <span className="terminal-prefix" aria-hidden="true">
              *
            </span>
            <span className="terminal-line-text">working</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & {
  onCopyCode: (text: string) => void;
};

type InteractionCardProps = {
  interaction: RuntimeInteraction;
  values: Record<string, string>;
  onChange: (interactionId: string, fieldId: string, value: string) => void;
  onRespond: (interaction: RuntimeInteraction, decision: "approve" | "decline" | "submit") => void;
};

function RuntimeMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="runtime-metric">
      <span>{label}</span>
      <strong title={String(value)}>{value}</strong>
    </div>
  );
}

function InteractionCard({ interaction, values, onChange, onRespond }: InteractionCardProps) {
  const fields = interaction.fields ?? [];

  return (
    <article className="interaction-card">
      <div className="interaction-copy">
        <strong>{interaction.title}</strong>
        <p>{interaction.body}</p>
      </div>
      {interaction.kind === "input" ? (
        <div className="interaction-fields">
          {fields.map((field) => (
            <label key={field.id}>
              <span>{field.label}</span>
              {field.multiline ? (
                <textarea
                  value={values[field.id] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) => onChange(interaction.id, field.id, event.target.value)}
                />
              ) : (
                <input
                  value={values[field.id] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) => onChange(interaction.id, field.id, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
      <div className="interaction-actions">
        <button type="button" className="ghost" onClick={() => onRespond(interaction, "decline")}>
          <Ban size={13} />
          <span>Deny</span>
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onRespond(interaction, interaction.kind === "input" ? "submit" : "approve")}
        >
          <Check size={13} />
          <span>{interaction.kind === "input" ? "Send" : "Allow"}</span>
        </button>
      </div>
    </article>
  );
}

function MarkdownTable({ children, ...props }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="markdown-table-scroll">
      <table {...props}>{children}</table>
    </div>
  );
}

function MarkdownPre({ children, onCopyCode, ...props }: MarkdownPreProps) {
  const codeText = extractReactNodeText(children);
  const language = readCodeLanguage(children);

  return (
    <div className="codeblock">
      <div className="codeblock-header">
        <span>{language}</span>
        <button type="button" title="Copy code" aria-label="Copy code" onClick={() => onCopyCode(codeText)}>
          <Copy size={12} />
        </button>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

function readCodeLanguage(node: ReactNode): string {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ className?: unknown }>(child)) {
      continue;
    }

    const className = child.props.className;
    if (typeof className !== "string") {
      continue;
    }

    const match = /language-([A-Za-z0-9_-]+)/.exec(className);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "text";
}

function extractReactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractReactNodeText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractReactNodeText(node.props.children);
  }
  return "";
}

function isTerminalToolEvent(tool: string): boolean {
  return tool === "terminal" || tool.startsWith("terminal:") || tool.startsWith("terminal-session:");
}

function terminalToolLabel(tool: string): string {
  return tool.startsWith("terminal-session:") ? "pty" : "terminal";
}

function terminalLinePrefix(kind: TerminalLine["kind"]): string {
  if (kind === "command") {
    return ">";
  }
  if (kind === "error") {
    return "!";
  }
  if (kind === "system") {
    return "*";
  }
  return "|";
}

function normalizeTerminalText(text: string): string {
  return text
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function clampTerminalLine(text: string): string {
  return text.length > TERMINAL_LINE_MAX_CHARS ? `${text.slice(0, TERMINAL_LINE_MAX_CHARS)}...` : text;
}

function limitTerminalLines(lines: TerminalLine[]): TerminalLine[] {
  return lines.length > TERMINAL_LINE_LIMIT ? lines.slice(-TERMINAL_LINE_LIMIT) : lines;
}

function summarizeTerminalCompletion(markdown: string, sawOutput: boolean): string {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~#>|]/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (sawOutput) {
    const statusLine = cleaned.find((line) => /\b(completed|exited with|blocked|stopped|timed out)\b/i.test(line));
    return statusLine ? clampTerminalLine(statusLine) : "completed";
  }

  const summaryLine =
    cleaned.find((line) => /\b(Terminal|PTY|session|started|running|stopped|resized|input sent|blocked|No output)\b/i.test(line)) ??
    cleaned[0] ??
    "";
  return clampTerminalLine(summaryLine);
}

function createSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "\n \n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, " ")
    .replace(/^\s*thought\s+for\s+.+$/gim, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~#>|]/g, " ")
    .replace(/[()[\]{}<>]/g, " ")
    .replace(/[\\/]+/g, " ")
    .replace(/[-=]{3,}/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/[;:]+/g, ", ")
    .replace(/[?!]{2,}/g, ".")
    .replace(/[.]{2,}/g, ".")
    .replace(/\s*([.!?。！？])\s*/g, "$1 ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickSpeechLanguage(text: string): string {
  if (/[가-힣]/.test(text)) {
    return "ko-KR";
  }
  if (/[ぁ-んァ-ン一-龯]/.test(text)) {
    return "ja-JP";
  }
  return navigator.language || "en-US";
}

function pickSpeechVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => voice.lang === lang) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) ??
    null
  );
}

function readStoredOpacity(): number {
  const stored = localStorage.getItem("codex-widget-opacity");
  if (!stored) {
    return 0.95;
  }
  return clampOpacity(Number(stored));
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.95;
  }
  return Math.min(1, Math.max(0, value > 1 ? value / 100 : value));
}

function ensureAssistantMessage(messages: ChatMessage[], id: string): ChatMessage[] {
  if (messages.some((message) => message.role === "assistant" && message.id === id)) {
    return messages;
  }
  return [
    ...messages,
    {
      id,
      role: "assistant",
      text: "",
      status: "pending"
    }
  ];
}

function findPreviousUserMessage(messages: ChatMessage[], startIndex: number): Extract<ChatMessage, { role: "user" }> | null {
  for (let index = Math.min(startIndex - 1, messages.length - 1); index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return message;
    }
  }
  return null;
}

function getNextTypingLength(text: string, currentLength: number, remaining: number, isCompleted: boolean): number {
  const atomicEnd = readAtomicTokenEnd(text, currentLength, isCompleted);
  if (atomicEnd !== null) {
    return atomicEnd;
  }

  const nextLength = Math.min(text.length, currentLength + getTypingStepSize(remaining));
  const atomicStart = findAtomicTokenStart(text, currentLength + 1, nextLength);
  return atomicStart ?? nextLength;
}

function findAtomicTokenStart(text: string, start: number, end: number): number | null {
  for (let index = start; index < end; index += 1) {
    if (isAtomicTokenStart(text, index)) {
      return index;
    }
  }
  return null;
}

function readAtomicTokenEnd(text: string, start: number, isCompleted: boolean): number | null {
  if (text.charAt(start) === "!" && text.charAt(start + 1) === "[") {
    const imageEnd = readMarkdownLinkEnd(text, start + 1);
    return imageEnd ?? (isCompleted ? null : start);
  }
  if (text.charAt(start) === "[") {
    const linkEnd = readMarkdownLinkEnd(text, start);
    return linkEnd ?? (isCompleted ? null : start);
  }
  if (isAutoUrlStart(text, start)) {
    return readAutoUrlEnd(text, start, isCompleted);
  }
  return null;
}

function isAtomicTokenStart(text: string, start: number): boolean {
  return (
    text.charAt(start) === "[" ||
    (text.charAt(start) === "!" && text.charAt(start + 1) === "[") ||
    isAutoUrlStart(text, start)
  );
}

function readMarkdownLinkEnd(text: string, start: number): number | null {
  if (text.charAt(start) !== "[") {
    return null;
  }

  let labelEnd = start + 1;
  while (labelEnd < text.length) {
    labelEnd = text.indexOf("]", labelEnd);
    if (labelEnd < 0) {
      return null;
    }
    if (text.charAt(labelEnd - 1) === "\\") {
      labelEnd += 1;
      continue;
    }
    break;
  }

  if (text.charAt(labelEnd + 1) !== "(") {
    return null;
  }

  const urlEnd = text.indexOf(")", labelEnd + 2);
  return urlEnd > labelEnd ? urlEnd + 1 : null;
}

function isAutoUrlStart(text: string, start: number): boolean {
  return text.startsWith("https://", start) || text.startsWith("http://", start);
}

function readAutoUrlEnd(text: string, start: number, isCompleted: boolean): number | null {
  if (!isAutoUrlStart(text, start)) {
    return null;
  }

  const rest = text.slice(start);
  const boundary = /[\s<>"`]/.exec(rest);
  if (!boundary && !isCompleted) {
    return start;
  }

  let end = boundary ? start + boundary.index : text.length;
  while (end > start && /[.,;:!?)]/.test(text.charAt(end - 1))) {
    end -= 1;
  }
  return end > start ? end : null;
}

function getTypingStepSize(remaining: number): number {
  if (remaining > 900) {
    return 6;
  }
  if (remaining > 360) {
    return 4;
  }
  if (remaining > 120) {
    return 3;
  }
  if (remaining > 32) {
    return 2;
  }
  return 1;
}

function getTypingDelay(character: string, remaining: number): number {
  if (remaining > 360) {
    return 12;
  }
  if (character === "\n") {
    return 62;
  }
  if (/[.!?。！？]$/.test(character)) {
    return 76;
  }
  if (/[,;:，、]$/.test(character)) {
    return 42;
  }
  if (character === " ") {
    return 14;
  }
  return STREAM_TYPE_BASE_INTERVAL_MS;
}

function isAssistantWorking(status: AssistantMessageStatus): boolean {
  return status === "pending" || status === "thinking" || status === "tooling" || status === "streaming" || status === "typing";
}

function snapshotStatusToAssistantStatus(status: MessageSnapshotStatus): AssistantMessageStatus {
  return status === "done" ||
    status === "cancelled" ||
    status === "error" ||
    status === "thinking" ||
    status === "tooling" ||
    status === "streaming"
    ? status
    : "pending";
}

function assistantStatusLabel(status: AssistantMessageStatus): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "thinking":
      return "Thinking";
    case "tooling":
      return "Working";
    case "streaming":
      return "Streaming";
    case "typing":
      return "Typing";
    case "cancelled":
      return "Stopped";
    case "error":
      return "Error";
    case "done":
    default:
      return "Done";
  }
}

function assistantFallbackText(status: AssistantMessageStatus): string {
  if (status === "cancelled") {
    return "Stopped before a response was returned.";
  }
  if (status === "error") {
    return "The response could not be completed.";
  }
  return "";
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

function readStoredModel(): ModelId {
  return normalizeModelId(localStorage.getItem(MODEL_STORAGE_KEY));
}

function readStoredReasoningEffort(): ReasoningEffort {
  return normalizeReasoningEffort(localStorage.getItem(REASONING_STORAGE_KEY));
}

function formatRuntimeAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "just started";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return `${seconds}s uptime`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 1) {
    return `${minutes}m uptime`;
  }
  return `${hours}h ${minutes % 60}m uptime`;
}

function formatNativeDaemonStatus(snapshot: NativeDaemonStatus | null, fallback: string): string {
  if (!snapshot) {
    return fallback;
  }
  if (!snapshot.enabled) {
    return "dev services";
  }
  if (snapshot.state === "running") {
    return "daemon running";
  }
  if (snapshot.state === "restarting") {
    return "daemon restarting";
  }
  if (snapshot.state === "starting") {
    return "daemon starting";
  }
  if (snapshot.state === "error") {
    return "daemon error";
  }
  if (snapshot.state === "stopped") {
    return "daemon stopped";
  }
  return fallback;
}

function createInteractionDraft(interaction: RuntimeInteraction): Record<string, string> {
  const fields = interaction.fields ?? [];
  if (fields.length === 0) {
    return {};
  }

  return Object.fromEntries(fields.map((field) => [field.id, ""]));
}

function readStoredChatMessages(): ChatMessage[] {
  const stored = localStorage.getItem(CHAT_STORAGE_KEY);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap(readStoredChatMessage).slice(-80);
  } catch {
    return [];
  }
}

function readStoredChatMessage(value: unknown): ChatMessage[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.text !== "string") {
    return [];
  }

  if (record.role === "user") {
    return [{ id: record.id, role: "user", text: record.text }];
  }

  if (record.role === "assistant") {
    const status = record.status === "error" || record.status === "cancelled" ? record.status : "done";
    return [{ id: record.id, role: "assistant", text: record.text, status }];
  }

  return [];
}

function readStoredBranchContext(): BranchContextMessage[] | null {
  const stored = localStorage.getItem(BRANCH_CONTEXT_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    const context = parsed.flatMap(readStoredBranchContextMessage).slice(-2);
    return context.length > 0 ? context : null;
  } catch {
    return null;
  }
}

function readStoredBranchContextMessage(value: unknown): BranchContextMessage[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const record = value as Record<string, unknown>;
  if ((record.role !== "user" && record.role !== "assistant") || typeof record.text !== "string" || !record.text.trim()) {
    return [];
  }

  return [{ role: record.role, text: record.text }];
}

function persistChatMessages(messages: ChatMessage[]): void {
  const persisted = messages
    .slice(-80)
    .map((message): ChatMessage =>
      message.role === "assistant" && isAssistantWorking(message.status)
        ? { ...message, status: "cancelled" }
        : message
    );

  if (persisted.length === 0) {
    localStorage.removeItem(CHAT_STORAGE_KEY);
    return;
  }

  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(persisted));
}

function persistBranchContext(context: BranchContextMessage[] | null): void {
  if (!context?.length) {
    localStorage.removeItem(BRANCH_CONTEXT_STORAGE_KEY);
    return;
  }

  localStorage.setItem(BRANCH_CONTEXT_STORAGE_KEY, JSON.stringify(context.slice(-2)));
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
