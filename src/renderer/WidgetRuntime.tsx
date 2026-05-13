import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  type ExecutionPermissionDecision,
  type ExecutionPermissionSummary,
  type ProviderStatus,
  type RuntimeStatus,
  type ServerEvent,
  type WidgetMode
} from "../shared/protocol.js";
import type { LogLine } from "./types";
import { readInitialWidgetMode } from "./utils/storage";
import { useCapabilityJobsController } from "./hooks/useCapabilityJobsController";
import { useDismissableOverlay } from "./hooks/useDismissableOverlay";
import { useModelSelectionController } from "./hooks/useModelSelectionController";
import { useWidgetAuthController } from "./hooks/useWidgetAuthController";
import { useWidgetResize } from "./hooks/useWidgetResize";
import { useDaemonConnection } from "./hooks/useDaemonConnection";
import { useBrowserActionController } from "./hooks/useBrowserActionController";
import { useSemanticMemoryControls } from "./hooks/useSemanticMemoryControls";
import { useTerminalController } from "./hooks/useTerminalController";
import { useVisionController } from "./hooks/useVisionController";
import { useChatSessionController } from "./hooks/useChatSessionController";
import { useWidgetShellController } from "./hooks/useWidgetShellController";
import { useVoicePromptController } from "./hooks/useVoicePromptController";
import { useWidgetRuntimeDerivedState } from "./hooks/useWidgetRuntimeDerivedState";
import { usePromptSubmission } from "./hooks/usePromptSubmission";
import { handleWidgetServerEvent } from "./runtime/serverEvents";
import { WidgetRuntimeView } from "./WidgetRuntimeView";

export function WidgetRuntime() {
  const [mode, setMode] = useState<WidgetMode>(() => readInitialWidgetMode());
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [input, setInput] = useState("");
  const [executionPermissions, setExecutionPermissions] = useState<ExecutionPermissionSummary[]>([]);
  const [showActivityDetails, setShowActivityDetails] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const conversationRef = useRef<HTMLElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const browserModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const visionModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const daemonPort = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("daemonPort") ?? "4128";
  }, []);
  const {
    selectedModel,
    setSelectedModel,
    reasoningEffort,
    setReasoningEffort,
    updateSelectedModel,
    updateReasoningEffort
  } = useModelSelectionController();
  const {
    autostartEnabled,
    maximized,
    opacity,
    pinned,
    showOpacityValue,
    toastNotice,
    cleanupShellEffects,
    hideOpacityValueSoon,
    minimize,
    revealOpacityValue,
    showToast,
    toggleMaximize,
    togglePinState,
    updateAutostart,
    updateOpacity
  } = useWidgetShellController({
    appendLog
  });
  const {
    voiceListening,
    toggleVoicePromptInput,
    cleanupVoicePrompt
  } = useVoicePromptController({
    input,
    setInput,
    appendLog
  });
  const {
    connected,
    nativeDaemonStatus,
    send,
    status,
    setStatus
  } = useDaemonConnection({
    daemonPort,
    onEvent: handleServerEvent,
    onCleanup: cleanupRuntimeEffects,
    appendLog
  });
  const {
    auth,
    applyAuthStatus,
    showTokenForm,
    setShowTokenForm,
    tokenInput,
    setTokenInput,
    proxyInput,
    setProxyInput,
    modelLabelInput,
    setModelLabelInput,
    authAction,
    saveToken
  } = useWidgetAuthController({
    send,
    appendLog,
    onTokenAuthStart: () => setShowSettings(false)
  });
  const {
    promptHeight,
    beginPromptResize,
    updatePromptResize,
    finishPromptResize,
    beginMascotDrag,
    beginResize,
    updateResize,
    finishResize
  } = useWidgetResize({
    maximized,
    conversationRef,
    onToggleMaximize: toggleMaximize
  });
  const {
    semanticMemoryEnabled,
    semanticMemoryReport,
    semanticMemoryStatus,
    refreshSemanticMemory,
    updateSemanticMemoryEnabled,
    clearSemanticMemory
  } = useSemanticMemoryControls({
    daemonPort,
    appendLog
  });
  const {
    terminalLines,
    terminalInput,
    setTerminalInput,
    terminalMouseEnabled,
    setTerminalMouseEnabled,
    showTerminalGuide,
    setShowTerminalGuide,
    terminalRequestIdsRef,
    terminalOutputRequestIdsRef,
    registerTerminalRequest,
    appendTerminalLine,
    appendTerminalOutput,
    completeTerminalRequest,
    clearTerminalViewport,
    resetTerminalState,
    openTerminalPopout,
    sendTerminalRawInput,
    sendTerminalInput,
    sendTerminalKey
  } = useTerminalController({
    daemonPort,
    send,
    appendLog,
    setMode
  });
  const {
    activeId,
    setActiveId,
    activeSessionId,
    activeSessionIdRef,
    chatMessages,
    interactions,
    interactionDrafts,
    ledger,
    setLedger,
    openActionMenuId,
    setOpenActionMenuId,
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
    saveDebugLogForAssistantMessage,
    startAsk,
    trashSession,
    updateInteractionDraft,
    viewTrashArtifacts
  } = useChatSessionController({
    mode,
    setMode,
    selectedModel,
    setSelectedModel,
    reasoningEffort,
    setReasoningEffort,
    send,
    appendLog,
    showToast,
    registerTerminalRequest,
    completeTerminalRequest,
    resetTerminalState,
    terminalRequestIdsRef,
    terminalOutputRequestIdsRef,
    appendTerminalLine
  });
  const {
    capabilityJobs,
    setCapabilityJobs,
    refreshCapabilityJobs,
    cancelCapabilityJob,
    approveCapabilityJob
  } = useCapabilityJobsController({
    activeSessionId,
    send
  });
  const {
    browserAction,
    setBrowserAction,
    showBrowserActionMenu,
    setShowBrowserActionMenu,
    startBrowserAction,
    refreshBrowserActionAdapters,
    observeBrowserAction,
    runBrowserActionCommand,
    setBrowserActionSafetyMode,
    cancelBrowserAction,
    updateBrowserActionPolicy
  } = useBrowserActionController({
    activeSessionId,
    send
  });
  const {
    showVisionMenu,
    setShowVisionMenu,
    visionNotice,
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
  } = useVisionController({
    daemonPort,
    promptText: input,
    activeSessionId,
    selectedModel,
    reasoningEffort,
    send,
    appendLog,
    setMode
  });

  useDismissableOverlay({
    open: showBrowserActionMenu,
    safeSelector: ".mode-row, .browser-action-menu",
    onDismiss: () => setShowBrowserActionMenu(false)
  });

  useEffect(() => {
    if (!showBrowserActionMenu) {
      return;
    }
    send({ type: "browserAction.adapters", actionSessionId: browserAction.actionSessionId ?? undefined });
  }, [showBrowserActionMenu]);

  useDismissableOverlay({
    open: showVisionMenu,
    safeSelector: ".mode-row, .vision-action-wrap, .vision-action-menu",
    onDismiss: () => setShowVisionMenu(false)
  });

  useDismissableOverlay({
    open: showActivityDetails,
    safeSelector: ".log-list, .activity-popover",
    onDismiss: () => setShowActivityDetails(false)
  });

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

  function cleanupRuntimeEffects() {
    cleanupShellEffects();
    cleanupChatSessionEffects();
    cleanupVisionEffects();
    cleanupVoicePrompt();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function handleServerEvent(event: ServerEvent) {
    handleWidgetServerEvent(event, {
      activeSessionIdRef,
      addInteraction,
      appendAssistantDelta,
      appendLog,
      appendTerminalLine,
      appendTerminalOutput,
      applyAssistantSnapshot,
      applyAuthStatus,
      applySessionSnapshot,
      applyVisionProviderEvent,
      completeAssistantMessage,
      completeTerminalRequest,
      markAssistantMessage,
      registerTerminalRequest,
      resetVisibleSession,
      restorePromptFocus,
      setActiveId,
      setBrowserAction,
      setCapabilityJobs,
      setExecutionPermissions,
      setLedger,
      setProviderStatuses,
      setRuntimeStatus,
      setStatus,
      setTrashLedger,
      terminalOutputRequestIdsRef,
      terminalRequestIdsRef,
      trashArtifactSessionIdRef
    });
  }

  function restorePromptFocus() {
    window.requestAnimationFrame(() => {
      if (showTokenForm || showSettings) {
        return;
      }
      promptInputRef.current?.focus({ preventScroll: true });
    });
  }

  function appendLog(text: string, tone: LogLine["tone"]) {
    setLogLines((current) => [
      { id: crypto.randomUUID(), text, tone },
      ...current.slice(0, 4)
    ]);
  }

  function updateExecutionPermission(action: string, decision: ExecutionPermissionDecision) {
    send({
      type: "execution.permission.set",
      action,
      decision
    });
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

  function runTerminalQuickAction(command: string) {
    setMode("terminal");
    startAsk(command, "terminal");
  }

  function toggleSettings() {
    setShowSettings((current) => {
      const next = !current;
      if (next) {
        setShowTokenForm(false);
        void refreshSemanticMemory();
      }
      return next;
    });
  }

  const { focusPromptInput, submit, submitFromPromptKey } = usePromptSubmission({
    input,
    mode,
    promptInputRef,
    setInput,
    startAsk
  });

  const {
    activeProviderStatus,
    activityBadgeCount,
    authButtonTitle,
    authLabel,
    displayStatus,
    fallbackLines,
    liveLabel,
    opacityLabel,
    providerSnapshots,
    providerStatusByMode,
    statusTone,
    terminalProviderStatus,
    visibleActivities
  } = useWidgetRuntimeDerivedState({
    auth,
    connected,
    ledger,
    logLines,
    mode,
    nativeDaemonStatus,
    providerStatuses,
    runtimeStatus,
    status,
    opacity
  });

  return (
    <WidgetRuntimeView
      activeId={activeId}
      activeProviderStatus={activeProviderStatus}
      activeSessionId={activeSessionId}
      activityBadgeCount={activityBadgeCount}
      authAction={authAction}
      authAuthenticated={auth.authenticated}
      authButtonTitle={authButtonTitle}
      authDisabled={!connected || (!auth.authenticated && !auth.signInAvailable)}
      authLabel={authLabel}
      autostartEnabled={autostartEnabled}
      beginMascotDrag={beginMascotDrag}
      beginPromptResize={beginPromptResize}
      beginResize={beginResize}
      beginScreenCropPick={beginScreenCropPick}
      branchFromAssistantMessage={branchFromAssistantMessage}
      browserAction={browserAction}
      browserModeButtonRef={browserModeButtonRef}
      cancel={cancel}
      cancelBrowserAction={cancelBrowserAction}
      cancelCapabilityJob={cancelCapabilityJob}
      captureScreen={captureScreen}
      chatMessages={chatMessages}
      clearSemanticMemory={clearSemanticMemory}
      clearTerminalViewport={clearTerminalViewport}
      connected={connected}
      conversationRef={conversationRef}
      copyCodeBlock={copyCodeBlock}
      copyMessage={copyMessage}
      createNewSession={createNewSession}
      cropPickerSelection={cropPickerSelection}
      cropPickerSelectionStyle={cropPickerSelectionStyle}
      deleteSession={deleteSession}
      displayStatus={displayStatus}
      daemonPort={daemonPort}
      executionPermissions={executionPermissions}
      fallbackLines={fallbackLines}
      finishPromptResize={finishPromptResize}
      finishResize={finishResize}
      finishScreenCropPick={finishScreenCropPick}
      focusPromptInput={focusPromptInput}
      hideOpacityValueSoon={hideOpacityValueSoon}
      input={input}
      interactionDrafts={interactionDrafts}
      interactions={interactions}
      isVisionRecording={isVisionRecording}
      isVisionStreaming={isVisionStreaming}
      ledger={ledger}
      capabilityJobs={capabilityJobs}
      liveLabel={liveLabel}
      maximized={maximized}
      minimize={minimize}
      mode={mode}
      modelLabelInput={modelLabelInput}
      nativeDaemonStatus={nativeDaemonStatus}
      observeBrowserAction={observeBrowserAction}
      opacity={opacity}
      opacityLabel={opacityLabel}
      openActionMenuId={openActionMenuId}
      openArtifactFile={openArtifactFile}
      openSession={openSession}
      openTerminalPopout={openTerminalPopout}
      pinned={pinned}
      promptHeight={promptHeight}
      promptInputRef={promptInputRef}
      providerSnapshots={providerSnapshots}
      providerStatusByMode={providerStatusByMode}
      providerStatuses={providerStatuses}
      proxyInput={proxyInput}
      readMessageAloud={readMessageAloud}
      reasoningEffort={reasoningEffort}
      refreshBrowserActionAdapters={refreshBrowserActionAdapters}
      refreshCapabilityJobs={refreshCapabilityJobs}
      refreshLedger={refreshLedger}
      refreshSemanticMemory={refreshSemanticMemory}
      respondToInteraction={respondToInteraction}
      restoreSession={restoreSession}
      retryAssistantMessage={retryAssistantMessage}
      saveDebugLogForAssistantMessage={saveDebugLogForAssistantMessage}
      revealOpacityValue={revealOpacityValue}
      approveCapabilityJob={approveCapabilityJob}
      runBrowserActionCommand={runBrowserActionCommand}
      runTerminalQuickAction={runTerminalQuickAction}
      runtimeStatus={runtimeStatus}
      saveToken={saveToken}
      screenCrop={screenCrop}
      screenCropPicker={screenCropPicker}
      selectedModel={selectedModel}
      selectMode={selectMode}
      semanticMemoryEnabled={semanticMemoryEnabled}
      semanticMemoryReport={semanticMemoryReport}
      semanticMemoryStatus={semanticMemoryStatus}
      sendTerminalInput={sendTerminalInput}
      sendTerminalKey={sendTerminalKey}
      sendTerminalRawInput={sendTerminalRawInput}
      sessionControlsFlashing={sessionControlsFlashing}
      sessions={sessions}
      setBrowserActionSafetyMode={setBrowserActionSafetyMode}
      setInput={setInput}
      setModelLabelInput={setModelLabelInput}
      setOpenActionMenuId={setOpenActionMenuId}
      setProxyInput={setProxyInput}
      setScreenCrop={setScreenCrop}
      setScreenCropPicker={setScreenCropPicker}
      setShowActivityDetails={setShowActivityDetails}
      setShowSessionTrash={setShowSessionTrash}
      setShowTerminalGuide={setShowTerminalGuide}
      setShowTokenForm={setShowTokenForm}
      setTerminalInput={setTerminalInput}
      setTerminalMouseEnabled={setTerminalMouseEnabled}
      setTokenInput={setTokenInput}
      showActivityDetails={showActivityDetails}
      showBrowserActionMenu={showBrowserActionMenu}
      showOpacityValue={showOpacityValue}
      showSessionTrash={showSessionTrash}
      showSettings={showSettings}
      showTerminalGuide={showTerminalGuide}
      showTokenForm={showTokenForm}
      showVisionMenu={showVisionMenu}
      speakingMessageId={speakingMessageId}
      startAgentScreenStream={startAgentScreenStream}
      startBrowserAction={startBrowserAction}
      startScreenCropPicker={startScreenCropPicker}
      startVisionRecording={startVisionRecording}
      statusTone={statusTone}
      stopAgentScreenStream={stopAgentScreenStream}
      stopVisionRecording={stopVisionRecording}
      submit={submit}
      submitFromPromptKey={submitFromPromptKey}
      terminalInput={terminalInput}
      terminalLines={terminalLines}
      terminalMouseEnabled={terminalMouseEnabled}
      terminalProviderStatus={terminalProviderStatus}
      tokenInput={tokenInput}
      toastNotice={toastNotice}
      toggleMaximize={toggleMaximize}
      togglePinState={togglePinState}
      toggleSettings={toggleSettings}
      toggleVisionMenuFromModeBar={toggleVisionMenuFromModeBar}
      toggleVoicePromptInput={toggleVoicePromptInput}
      trashArtifactSessionId={trashArtifactSessionId}
      trashLedger={trashLedger}
      trashSession={trashSession}
      trashedSessions={trashedSessions}
      updateAutostart={updateAutostart}
      updateBrowserActionPolicy={updateBrowserActionPolicy}
      updateExecutionPermission={updateExecutionPermission}
      updateInteractionDraft={updateInteractionDraft}
      updateOpacity={updateOpacity}
      updatePromptResize={updatePromptResize}
      updateReasoningEffort={updateReasoningEffort}
      updateResize={updateResize}
      updateScreenCropField={updateScreenCropField}
      updateScreenCropPick={updateScreenCropPick}
      updateSelectedModel={updateSelectedModel}
      updateSemanticMemoryEnabled={updateSemanticMemoryEnabled}
      updateVisionFrameInterval={updateVisionFrameInterval}
      updateVisionMaxDuration={updateVisionMaxDuration}
      viewTrashArtifacts={viewTrashArtifacts}
      visibleActivities={visibleActivities}
      visionFrameStats={visionFrameStats}
      visionModeButtonRef={visionModeButtonRef}
      visionNotice={visionNotice}
      visionStateLabel={visionStateLabel}
      visionStreamSettings={visionStreamSettings}
      visionStreamStatusText={visionStreamStatusText}
      voiceListening={voiceListening}
    />
  );
}
