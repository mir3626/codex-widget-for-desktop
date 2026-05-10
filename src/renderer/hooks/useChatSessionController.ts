import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type {
  BranchContextMessage,
  ClientMessage,
  ModelId,
  ReasoningEffort,
  RuntimeInteraction,
  RuntimeInteractionDecision,
  SessionSnapshot,
  SessionSummary,
  WidgetMode,
  MessageSnapshotStatus
} from "../../shared/protocol.js";
import {
  BRANCH_CONTEXT_STORAGE_KEY,
  CHAT_STORAGE_KEY,
  MODEL_STORAGE_KEY,
  REASONING_STORAGE_KEY,
  STREAM_TYPE_BASE_INTERVAL_MS
} from "../config";
import type { AssistantMessageStatus, ChatMessage, InteractionDrafts, LogLine, TerminalLine } from "../types";
import {
  ensureAssistantMessage,
  findPreviousUserMessage,
  getNextTypingLength,
  getTypingDelay,
  isAssistantWorking,
  readWorkingAssistantId,
  sessionMessageToChatMessage,
  snapshotStatusToAssistantStatus
} from "../utils/chat";
import {
  persistBranchContext,
  persistChatMessages,
  readStoredBranchContext,
  readStoredChatMessages
} from "../utils/storage";
import {
  createInteractionDraft,
  isDisposableNewChatSession
} from "./chatSession/sessionHelpers";
import { useAssistantSpeech } from "./chatSession/useAssistantSpeech";

type UseChatSessionControllerInput = {
  mode: WidgetMode;
  setMode(mode: WidgetMode): void;
  selectedModel: ModelId;
  setSelectedModel(model: ModelId): void;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort(reasoningEffort: ReasoningEffort): void;
  send(message: ClientMessage): boolean;
  appendLog(text: string, tone: LogLine["tone"]): void;
  showToast(text: string): void;
  registerTerminalRequest(id: string, command: string, echoCommand?: boolean): void;
  completeTerminalRequest(id: string, text: string): void;
  resetTerminalState(): void;
  terminalRequestIdsRef: React.MutableRefObject<Set<string>>;
  terminalOutputRequestIdsRef: React.MutableRefObject<Set<string>>;
  appendTerminalLine(kind: TerminalLine["kind"], text: string): void;
};

export function useChatSessionController(input: UseChatSessionControllerInput) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => readStoredChatMessages());
  const [interactions, setInteractions] = useState<RuntimeInteraction[]>([]);
  const [interactionDrafts, setInteractionDrafts] = useState<InteractionDrafts>({});
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [branchContext, setBranchContext] = useState<BranchContextMessage[] | null>(() => readStoredBranchContext());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [trashedSessions, setTrashedSessions] = useState<SessionSummary[]>([]);
  const [showSessionTrash, setShowSessionTrash] = useState(false);
  const [ledger, setLedger] = useState<import("../../shared/protocol.js").LedgerSnapshot | null>(null);
  const [trashLedger, setTrashLedger] = useState<import("../../shared/protocol.js").LedgerSnapshot | null>(null);
  const [trashArtifactSessionId, setTrashArtifactSessionId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sessionControlsFlashing, setSessionControlsFlashing] = useState(false);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const trashArtifactSessionIdRef = useRef<string | null>(trashArtifactSessionId);
  const branchContextRef = useRef<BranchContextMessage[] | null>(branchContext);
  const streamBuffersRef = useRef<Map<string, string>>(new Map());
  const completedResponseIdsRef = useRef<Set<string>>(new Set());
  const streamTypingTimerRef = useRef<number | null>(null);
  const sessionControlsPulseTimerRef = useRef<number | null>(null);
  const {
    speakingMessageId,
    readMessageAloud,
    stopReadAloud,
    cancelAssistantSpeech
  } = useAssistantSpeech({
    streamBuffersRef,
    appendLog: input.appendLog,
    closeActionMenu: () => setOpenActionMenuId(null)
  });

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
      input.setSelectedModel(nextActiveSession.activeModel);
      localStorage.setItem(MODEL_STORAGE_KEY, nextActiveSession.activeModel);
    }
    if (nextActiveSession?.activeReasoning) {
      input.setReasoningEffort(nextActiveSession.activeReasoning);
      localStorage.setItem(REASONING_STORAGE_KEY, nextActiveSession.activeReasoning);
    }
    if (nextActiveSession?.activeMode) {
      input.setMode(nextActiveSession.activeMode);
    }
    if (previousActiveSessionId && previousActiveSessionId !== snapshot.activeSessionId) {
      pulseSessionControls();
    }
  }

  function createNewSession() {
    if (activeId) {
      input.send({ type: "cancel", id: activeId });
    }
    cancelAssistantSpeech();
    setShowSessionTrash(false);
    input.send({
      type: "session.create",
      model: input.selectedModel,
      reasoningEffort: input.reasoningEffort,
      mode: input.mode
    });
  }

  function openSession(sessionId: string) {
    if (sessionId === activeSessionId) {
      return;
    }
    if (activeId) {
      input.send({ type: "cancel", id: activeId });
    }
    setShowSessionTrash(false);
    input.send({ type: "session.open", sessionId });
  }

  function refreshLedger(sessionId = activeSessionId ?? undefined) {
    input.send({ type: "ledger.refresh", sessionId });
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
    input.send({ type: "artifact.open", artifactFileId, versionId });
  }

  function trashSession(sessionId: string) {
    if (activeId) {
      input.send({ type: "cancel", id: activeId });
    }
    if (trashArtifactSessionIdRef.current === sessionId) {
      trashArtifactSessionIdRef.current = null;
      setTrashArtifactSessionId(null);
      setTrashLedger(null);
    }
    if (isDisposableNewChatSession(findSessionSummary(sessionId))) {
      input.send({ type: "session.discard", sessionId });
      return;
    }
    input.send({ type: "session.trash", sessionId });
  }

  function restoreSession(sessionId: string) {
    if (activeId) {
      input.send({ type: "cancel", id: activeId });
    }
    if (trashArtifactSessionIdRef.current === sessionId) {
      trashArtifactSessionIdRef.current = null;
      setTrashArtifactSessionId(null);
      setTrashLedger(null);
    }
    input.send({ type: "session.restore", sessionId });
  }

  function deleteSession(sessionId: string) {
    if (activeId) {
      input.send({ type: "cancel", id: activeId });
    }
    if (trashArtifactSessionIdRef.current === sessionId) {
      trashArtifactSessionIdRef.current = null;
      setTrashArtifactSessionId(null);
      setTrashLedger(null);
    }
    input.send({ type: "session.delete", sessionId });
  }

  function findSessionSummary(sessionId: string): SessionSummary | undefined {
    return sessions.find((session) => session.id === sessionId) ?? trashedSessions.find((session) => session.id === sessionId);
  }

  function resetVisibleSession(sendToDaemon = true) {
    if (activeId && sendToDaemon) {
      input.send({ type: "cancel", id: activeId });
    }
    cancelAssistantSpeech();
    streamBuffersRef.current.clear();
    completedResponseIdsRef.current.clear();
    input.resetTerminalState();
    setActiveId(null);
    setOpenActionMenuId(null);
    setInteractions([]);
    setInteractionDrafts({});
    updateBranchContext(null);
    setChatMessages([]);
    localStorage.removeItem(CHAT_STORAGE_KEY);
    if (sendToDaemon) {
      input.send({ type: "session.reset" });
    }
  }

  function addInteraction(interaction: RuntimeInteraction) {
    setInteractions((current) => [interaction, ...current.filter((item) => item.id !== interaction.id)].slice(0, 3));
    setInteractionDrafts((current) => ({
      ...current,
      [interaction.id]: createInteractionDraft(interaction)
    }));
  }

  function respondToInteraction(
    interaction: RuntimeInteraction,
    decision: RuntimeInteractionDecision
  ) {
    const answers = interactionDrafts[interaction.id] ?? {};
    input.send({
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
    input.appendLog(decision === "approve" || decision === "always_allow" ? "approved" : decision === "decline" ? "declined" : "submitted", "tool");
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
      input.registerTerminalRequest(id, text);
    }
    setChatMessages((current) => [...current, userMessage, assistantMessage]);
    const currentBranchContext = branchContextRef.current;
    input.send({
      type: "ask",
      id,
      text,
      mode: requestMode,
      sessionId: activeSessionId ?? undefined,
      model: input.selectedModel,
      reasoningEffort: input.reasoningEffort,
      branchContext: currentBranchContext ?? undefined
    });
    updateBranchContext(null);
    return true;
  }

  function cancel() {
    if (!activeId) {
      return;
    }
    input.send({ type: "cancel", id: activeId });
    markAssistantMessage(activeId, "cancelled");
    setActiveId(null);
  }

  function copyMessage(id: string, fallbackText: string) {
    const text = streamBuffersRef.current.get(id) ?? fallbackText;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => input.appendLog("copied response", "tool"))
      .catch(() => input.appendLog("copy unavailable", "error"));
  }

  function copyCodeBlock(text: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => input.appendLog("copied code", "tool"))
      .catch(() => input.appendLog("copy unavailable", "error"));
  }

  function branchFromAssistantMessage(messageId: string) {
    if (activeId) {
      setOpenActionMenuId(null);
      input.appendLog("branch unavailable while active", "muted");
      return;
    }

    const messageIndex = chatMessages.findIndex((message) => message.id === messageId);
    const assistantMessage = chatMessages[messageIndex];
    const userMessage = findPreviousUserMessage(chatMessages, messageIndex);
    if (!userMessage || assistantMessage?.role !== "assistant") {
      setOpenActionMenuId(null);
      input.appendLog("branch unavailable", "error");
      return;
    }

    const assistantText = streamBuffersRef.current.get(messageId) ?? assistantMessage.text;
    const nextBranchContext: BranchContextMessage[] = [
      { role: "user", text: userMessage.text },
      { role: "assistant", text: assistantText }
    ];
    setOpenActionMenuId(null);
    if (
      !input.send({
        type: "session.branch",
        messages: nextBranchContext,
        sourceMessageId: messageId,
        title: userMessage.text,
        model: input.selectedModel,
        reasoningEffort: input.reasoningEffort,
        mode: input.mode
      })
    ) {
      return;
    }
    streamBuffersRef.current.clear();
    completedResponseIdsRef.current.clear();
    updateBranchContext(nextBranchContext);
    input.appendLog("branched to new session", "tool");
    input.showToast("Branched to new session");
  }

  function updateBranchContext(nextContext: BranchContextMessage[] | null) {
    branchContextRef.current = nextContext;
    setBranchContext(nextContext);
  }

  function retryAssistantMessage(messageId: string) {
    if (activeId) {
      return;
    }

    const messageIndex = chatMessages.findIndex((message) => message.id === messageId);
    const assistantMessage = chatMessages[messageIndex];
    const userMessage = findPreviousUserMessage(chatMessages, messageIndex);
    if (!userMessage || assistantMessage?.role !== "assistant") {
      input.appendLog("no prompt to retry", "error");
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
      input.terminalRequestIdsRef.current.delete(removedId);
      input.terminalOutputRequestIdsRef.current.delete(removedId);
    }

    setActiveId(nextId);
    streamBuffersRef.current.set(nextId, "");
    completedResponseIdsRef.current.delete(nextId);
    if (input.mode === "terminal") {
      input.registerTerminalRequest(nextId, userMessage.text);
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
    input.send({
      type: "ask",
      id: nextId,
      text: userMessage.text,
      mode: input.mode,
      sessionId: activeSessionId ?? undefined,
      model: input.selectedModel,
      reasoningEffort: input.reasoningEffort,
      regenerate: {
        dropTurns: Math.max(1, removedAssistantIds.length),
        replaceFromMessageId: messageId
      }
    });
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

  function cleanupChatSessionEffects() {
    if (sessionControlsPulseTimerRef.current !== null) {
      window.clearTimeout(sessionControlsPulseTimerRef.current);
    }
    if (streamTypingTimerRef.current !== null) {
      window.clearTimeout(streamTypingTimerRef.current);
    }
    cancelAssistantSpeech();
  }

  return {
    activeId,
    setActiveId,
    activeSessionId,
    activeSessionIdRef,
    branchContext,
    chatMessages,
    interactions,
    interactionDrafts,
    ledger,
    setLedger,
    openActionMenuId,
    setOpenActionMenuId: setOpenActionMenuId as Dispatch<SetStateAction<string | null>>,
    sessionControlsFlashing,
    sessions,
    showSessionTrash,
    setShowSessionTrash,
    speakingMessageId,
    trashArtifactSessionId,
    trashArtifactSessionIdRef,
    trashLedger,
    setTrashLedger,
    trashedSessions,
    addInteraction,
    appendAssistantDelta,
    applyAssistantSnapshot,
    applySessionSnapshot,
    branchFromAssistantMessage,
    cancel,
    cleanupChatSessionEffects,
    completeAssistantMessage,
    completeTerminalRequest: input.completeTerminalRequest,
    copyCodeBlock,
    copyMessage,
    createNewSession,
    deleteSession,
    markAssistantMessage,
    openArtifactFile,
    openSession,
    readMessageAloud,
    refreshLedger,
    resetVisibleSession,
    respondToInteraction,
    restoreSession,
    retryAssistantMessage,
    startAsk,
    stopReadAloud,
    trashSession,
    updateInteractionDraft,
    viewTrashArtifacts
  };
}
