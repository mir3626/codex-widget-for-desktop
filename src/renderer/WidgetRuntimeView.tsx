import type {
  CSSProperties,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  PointerEvent,
  RefObject,
  SetStateAction
} from "react";
import appIconUrl from "../../src-tauri/icons/icon.png";
import type {
  BrowserActionDirectCommandInput,
  BrowserActionMode,
  BrowserActionPolicyDecision,
  ExecutionPermissionDecision,
  ExecutionPermissionSummary,
  LedgerSnapshot,
  ModelId,
  ProviderStatus,
  ReasoningEffort,
  RuntimeInteraction,
  RuntimeInteractionDecision,
  RuntimeStatus,
  ScreenCrop,
  SessionSummary,
  WidgetMode
} from "../shared/protocol.js";
import { MODES, RESIZE_HANDLES } from "./config";
import type { MascotMotionStatus } from "./components/MascotSprite";
import { WidgetBody } from "./components/widget-runtime/WidgetBody";
import { WidgetChrome } from "./components/widget-runtime/WidgetChrome";
import { WidgetFooter } from "./components/widget-runtime/WidgetFooter";
import { WidgetModeArea } from "./components/widget-runtime/WidgetModeArea";
import { WidgetOverlays } from "./components/widget-runtime/WidgetOverlays";
import { WidgetResizeHandles } from "./components/widget-runtime/WidgetResizeHandles";
import { closeWidget, type NativeDaemonStatus } from "./shell";
import type {
  BrowserActionUiState,
  ChatMessage,
  InteractionDrafts,
  LogLine,
  ScreenCropSettings,
  ScreenCropPickerState,
  TerminalKeyName,
  TerminalLine,
  ToastNotice,
  VisionFrameStats,
  VisionStreamSettings
} from "./types";
import { canUseVoiceInput } from "./utils/speech";
import type { VisionNotice } from "./components/VisionStatusPanel";

type WidgetRuntimeViewProps = {
  activeId: string | null;
  activeProviderStatus?: ProviderStatus;
  activeSessionId: string | null;
  activityBadgeCount: number;
  authAction: () => void;
  authAuthenticated: boolean;
  authButtonTitle: string;
  authDisabled: boolean;
  authLabel: string;
  autostartEnabled: boolean;
  branchFromAssistantMessage: (messageId: string) => void;
  beginMascotDrag: (event: PointerEvent<HTMLElement>) => void;
  beginPromptResize: (event: PointerEvent<HTMLDivElement>) => void;
  beginResize: (direction: (typeof RESIZE_HANDLES)[number]["direction"], event: PointerEvent<HTMLDivElement>) => void;
  beginScreenCropPick: (event: PointerEvent<HTMLDivElement>) => void;
  browserAction: BrowserActionUiState;
  browserModeButtonRef: RefObject<HTMLButtonElement | null>;
  cancel: () => void;
  cancelBrowserAction: () => void;
  captureScreen: () => void;
  chatMessages: ChatMessage[];
  clearSemanticMemory: () => void;
  clearTerminalViewport: () => void;
  connected: boolean;
  conversationRef: RefObject<HTMLElement | null>;
  copyCodeBlock: (code: string) => void;
  copyMessage: (messageId: string, text: string) => void;
  createNewSession: () => void;
  cropPickerSelection: { width: number; height: number } | null;
  cropPickerSelectionStyle?: CSSProperties;
  deleteSession: (sessionId: string) => void;
  displayStatus: string;
  executionPermissions: ExecutionPermissionSummary[];
  fallbackLines: LogLine[];
  finishPromptResize: (event: PointerEvent<HTMLDivElement>) => void;
  finishResize: (event: PointerEvent<HTMLDivElement>) => void;
  finishScreenCropPick: (event: PointerEvent<HTMLDivElement>) => void;
  focusPromptInput: (event: PointerEvent<HTMLFormElement>) => void;
  hideOpacityValueSoon: () => void;
  input: string;
  interactionDrafts: InteractionDrafts;
  interactions: RuntimeInteraction[];
  isVisionRecording: boolean;
  isVisionStreaming: boolean;
  ledger: LedgerSnapshot | null;
  liveLabel: string;
  maximized: boolean;
  minimize: () => void;
  mode: WidgetMode;
  modelLabelInput: string;
  nativeDaemonStatus: NativeDaemonStatus | null;
  observeBrowserAction: () => void;
  opacity: number;
  opacityLabel: string;
  openActionMenuId: string | null;
  openArtifactFile: (artifactFileId: string, versionId?: string) => void;
  openSession: (sessionId: string) => void;
  openTerminalPopout: () => void;
  pinned: boolean;
  promptHeight: number;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  providerSnapshots: NonNullable<LedgerSnapshot["providerSnapshots"]>;
  providerStatusByMode: Map<WidgetMode, ProviderStatus>;
  providerStatuses: ProviderStatus[];
  proxyInput: string;
  readMessageAloud: (messageId: string, text: string) => void;
  reasoningEffort: ReasoningEffort;
  revealOpacityValue: () => void;
  refreshBrowserActionAdapters: () => void;
  refreshLedger: () => void;
  refreshSemanticMemory: () => void;
  restoreSession: (sessionId: string) => void;
  retryAssistantMessage: (messageId: string) => void;
  saveDebugLogForAssistantMessage: (messageId: string, reason: string) => void;
  runBrowserActionCommand: (command: BrowserActionDirectCommandInput) => void;
  runTerminalQuickAction: (command: string) => void;
  runtimeStatus: RuntimeStatus | null;
  saveToken: (event: FormEvent) => void;
  screenCrop: ScreenCropSettings;
  screenCropPicker: ScreenCropPickerState | null;
  selectedModel: ModelId;
  selectMode: (mode: WidgetMode) => void;
  semanticMemoryEnabled: boolean;
  semanticMemoryReport: {
    nodeCount: number;
    edgeCount: number;
    unresolvedCount: number;
    feedbackCount: number;
    generatedAt: string;
  } | null;
  semanticMemoryStatus: string;
  sendTerminalInput: () => void;
  sendTerminalKey: (key: TerminalKeyName) => void;
  sendTerminalRawInput: (sequence: string, label: string) => void;
  sessionControlsFlashing: boolean;
  sessions: SessionSummary[];
  setBrowserActionSafetyMode: (mode: BrowserActionMode) => void;
  setInput: Dispatch<SetStateAction<string>>;
  setModelLabelInput: Dispatch<SetStateAction<string>>;
  setOpenActionMenuId: Dispatch<SetStateAction<string | null>>;
  setProxyInput: Dispatch<SetStateAction<string>>;
  setScreenCrop: Dispatch<SetStateAction<ScreenCropSettings>>;
  setScreenCropPicker: (next: ScreenCropPickerState | null) => void;
  setShowActivityDetails: Dispatch<SetStateAction<boolean>>;
  setShowSessionTrash: Dispatch<SetStateAction<boolean>>;
  setShowTerminalGuide: Dispatch<SetStateAction<boolean>>;
  setShowTokenForm: Dispatch<SetStateAction<boolean>>;
  setTerminalInput: Dispatch<SetStateAction<string>>;
  setTerminalMouseEnabled: Dispatch<SetStateAction<boolean>>;
  setTokenInput: Dispatch<SetStateAction<string>>;
  showActivityDetails: boolean;
  showBrowserActionMenu: boolean;
  showOpacityValue: boolean;
  showSessionTrash: boolean;
  showSettings: boolean;
  showTerminalGuide: boolean;
  showTokenForm: boolean;
  showVisionMenu: boolean;
  speakingMessageId: string | null;
  startAgentScreenStream: () => void;
  startBrowserAction: (mode: BrowserActionMode) => void;
  startScreenCropPicker: () => void;
  startVisionRecording: () => void;
  statusTone: "online" | "warning" | "offline";
  stopAgentScreenStream: () => void;
  stopVisionRecording: () => void;
  submit: (event: FormEvent) => void;
  submitFromPromptKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  terminalInput: string;
  terminalLines: TerminalLine[];
  terminalMouseEnabled: boolean;
  terminalProviderStatus?: ProviderStatus;
  tokenInput: string;
  toastNotice: ToastNotice | null;
  toggleMaximize: () => void;
  togglePinState: () => void;
  toggleSettings: () => void;
  toggleVisionMenuFromModeBar: () => void;
  toggleVoicePromptInput: () => void;
  trashArtifactSessionId: string | null;
  trashLedger: LedgerSnapshot | null;
  trashSession: (sessionId: string) => void;
  trashedSessions: SessionSummary[];
  updateAutostart: (enabled: boolean) => void;
  updateBrowserActionPolicy: (decision: BrowserActionPolicyDecision) => void;
  updateExecutionPermission: (action: string, decision: ExecutionPermissionDecision) => void;
  updateOpacity: (value: string) => void;
  updateReasoningEffort: (value: string) => void;
  updateScreenCropField: (field: keyof ScreenCrop, value: string) => void;
  updateSelectedModel: (value: string) => void;
  updateSemanticMemoryEnabled: (enabled: boolean) => void;
  updateVisionFrameInterval: (value: string) => void;
  updateVisionMaxDuration: (value: string) => void;
  updateScreenCropPick: (event: PointerEvent<HTMLDivElement>) => void;
  updatePromptResize: (event: PointerEvent<HTMLDivElement>) => void;
  updateResize: (event: PointerEvent<HTMLDivElement>) => void;
  updateInteractionDraft: (interactionId: string, fieldId: string, value: string) => void;
  respondToInteraction: (interaction: RuntimeInteraction, decision: RuntimeInteractionDecision, answerOverride?: Record<string, string>) => void;
  viewTrashArtifacts: (sessionId: string) => void;
  visibleActivities: NonNullable<LedgerSnapshot["activities"]>;
  visionFrameStats: VisionFrameStats;
  visionModeButtonRef: RefObject<HTMLButtonElement | null>;
  visionNotice: VisionNotice | null;
  visionStateLabel: string;
  visionStreamSettings: VisionStreamSettings;
  visionStreamStatusText: string;
  voiceListening: boolean;
};

export function WidgetRuntimeView(props: WidgetRuntimeViewProps) {
  const busy = Boolean(props.activeId);
  const activeMode = MODES.find((item) => item.mode === props.mode) ?? MODES[0];
  const isOverlayPanelOpen = props.showSettings || props.showTokenForm;
  const shellStyle = { "--widget-opacity": String(props.opacity) } as CSSProperties;
  const panelStyle = { "--prompt-composer-height": `${props.promptHeight}px` } as CSSProperties;
  const voiceInputAvailable = canUseVoiceInput();
  const mascotStateClass = [
    "mascot",
    !props.connected ? "is-offline" : "",
    busy ? "is-working" : "",
    props.isVisionRecording ? "is-recording" : "",
    props.isVisionStreaming ? "is-streaming" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const mascotMotionStatus: MascotMotionStatus = !props.connected
    ? "offline"
    : props.isVisionRecording
      ? "recording"
      : props.isVisionStreaming
        ? "streaming"
        : busy
          ? "working"
          : "idle";

  return (
    <main className={props.maximized ? "widget-shell is-maximized" : "widget-shell"} style={shellStyle}>
      <section
        className={isOverlayPanelOpen ? "widget-panel is-overlay-mode" : "widget-panel"}
        style={panelStyle}
        aria-live="polite"
      >
        <WidgetResizeHandles
          handles={RESIZE_HANDLES}
          onBeginResize={props.beginResize}
          onUpdateResize={props.updateResize}
          onFinishResize={props.finishResize}
        />

        <WidgetChrome
          titleBar={{
            appIconUrl,
            opacity: props.opacity,
            opacityLabel: props.opacityLabel,
            showOpacityValue: props.showOpacityValue,
            pinned: props.pinned,
            maximized: props.maximized,
            onOpacityChange: props.updateOpacity,
            onOpacityEditStart: props.revealOpacityValue,
            onOpacityEditEnd: props.hideOpacityValueSoon,
            onTogglePin: props.togglePinState,
            onMinimize: props.minimize,
            onToggleMaximize: props.toggleMaximize,
            onClose: () => void closeWidget()
          }}
          systemStrip={{
            statusTone: props.statusTone,
            displayStatus: props.displayStatus,
            statusTitle: props.nativeDaemonStatus?.lastEvent ?? undefined,
            liveLabel: props.liveLabel,
            authenticated: props.authAuthenticated,
            authLabel: props.authLabel,
            authButtonTitle: props.authButtonTitle,
            authDisabled: props.authDisabled,
            settingsOpen: props.showSettings,
            onAuthAction: props.authAction,
            onToggleSettings: props.toggleSettings
          }}
          sessionStrip={{
            sessions: props.sessions,
            activeSessionId: props.activeSessionId,
            trashedSessions: props.trashedSessions,
            showSessionTrash: props.showSessionTrash,
            trashArtifactSessionId: props.trashArtifactSessionId,
            trashLedger: props.trashLedger,
            onOpenSession: props.openSession,
            onTrashSession: props.trashSession,
            onCreateNewSession: props.createNewSession,
            onToggleTrash: () => props.setShowSessionTrash((current) => !current),
            onViewTrashArtifacts: props.viewTrashArtifacts,
            onRestoreSession: props.restoreSession,
            onDeleteSession: props.deleteSession,
            onOpenArtifactFile: props.openArtifactFile
          }}
          toast={{
            notice: props.toastNotice
          }}
        />

        <WidgetModeArea
          modeTabs={{
            mode: props.mode,
            providerStatusByMode: props.providerStatusByMode,
            browserButtonRef: props.browserModeButtonRef,
            visionButtonRef: props.visionModeButtonRef,
            onModeChange: props.selectMode
          }}
          browserActionMenu={{
            open: props.showBrowserActionMenu,
            state: props.browserAction,
            anchorRef: props.browserModeButtonRef,
            onCommand: props.runBrowserActionCommand,
            onCancel: props.cancelBrowserAction,
            onPolicyChange: props.updateBrowserActionPolicy,
            onSafetyModeChange: props.setBrowserActionSafetyMode
          }}
          visionActionMenu={{
            open: props.showVisionMenu,
            statusLabel: props.visionStateLabel,
            recording: props.isVisionRecording,
            streaming: props.isVisionStreaming,
            settings: props.visionStreamSettings,
            frameStats: props.visionFrameStats,
            streamStatusText: props.visionStreamStatusText,
            anchorRef: props.visionModeButtonRef,
            renderTrigger: false,
            onToggle: props.toggleVisionMenuFromModeBar,
            onCapture: props.captureScreen,
            onRecord: props.isVisionRecording ? () => props.stopVisionRecording() : props.startVisionRecording,
            onStream: props.isVisionStreaming ? () => props.stopAgentScreenStream() : props.startAgentScreenStream,
            onFrameIntervalChange: props.updateVisionFrameInterval,
            onMaxDurationChange: props.updateVisionMaxDuration
          }}
          visionStatusPanel={{
            notice: props.visionNotice,
            onStopLive: props.isVisionRecording
              ? () => props.stopVisionRecording()
              : props.isVisionStreaming
                ? () => props.stopAgentScreenStream()
                : undefined
          }}
        />

        <WidgetBody
          showSettings={props.showSettings}
          showTokenForm={props.showTokenForm}
          settingsPanel={{
            autostartEnabled: props.autostartEnabled,
            runtimeStatus: props.runtimeStatus,
            nativeDaemonStatus: props.nativeDaemonStatus,
            providerStatuses: props.providerStatuses,
            executionPermissions: props.executionPermissions,
            semanticMemoryEnabled: props.semanticMemoryEnabled,
            semanticMemoryReport: props.semanticMemoryReport,
            semanticMemoryStatus: props.semanticMemoryStatus,
            screenCrop: props.screenCrop,
            onAutostartChange: props.updateAutostart,
            onExecutionPermissionChange: props.updateExecutionPermission,
            onSemanticMemoryEnabledChange: props.updateSemanticMemoryEnabled,
            onSemanticMemoryRefresh: props.refreshSemanticMemory,
            onSemanticMemoryClear: props.clearSemanticMemory,
            onCaptureScreen: props.captureScreen,
            onScreenCropEnabledChange: (enabled) => props.setScreenCrop((current) => ({ ...current, enabled })),
            onScreenCropFieldChange: props.updateScreenCropField,
            onStartScreenCropPicker: props.startScreenCropPicker
          }}
          authTokenPanel={{
            proxyInput: props.proxyInput,
            modelLabelInput: props.modelLabelInput,
            tokenInput: props.tokenInput,
            onProxyInputChange: props.setProxyInput,
            onModelLabelInputChange: props.setModelLabelInput,
            onTokenInputChange: props.setTokenInput,
            onCancel: () => props.setShowTokenForm(false),
            onSubmit: props.saveToken
          }}
          conversationPanel={{
            conversationRef: props.conversationRef,
            mode: props.mode,
            busy,
            authAuthenticated: props.authAuthenticated,
            activeProviderStatus: props.activeProviderStatus,
            terminalProviderStatus: props.terminalProviderStatus,
            activeModeLabel: activeMode.label,
            activeModeIcon: activeMode.icon,
            chatMessages: props.chatMessages,
            interactions: props.interactions,
            interactionDrafts: props.interactionDrafts,
            ledger: props.ledger,
            activeRequestId: props.activeId,
            openActionMenuId: props.openActionMenuId,
            speakingMessageId: props.speakingMessageId,
            terminalLines: props.terminalLines,
            terminalInput: props.terminalInput,
            terminalMouseEnabled: props.terminalMouseEnabled,
            showTerminalGuide: props.showTerminalGuide,
            browserAction: props.browserAction,
            onRunTerminalQuickAction: props.runTerminalQuickAction,
            onClearTerminal: props.clearTerminalViewport,
            onOpenTerminalPopout: props.openTerminalPopout,
            onTerminalInputChange: props.setTerminalInput,
            onTerminalInputSubmit: props.sendTerminalInput,
            onTerminalKeySend: props.sendTerminalKey,
            onTerminalMouseEnabledChange: props.setTerminalMouseEnabled,
            onTerminalMouseInput: props.sendTerminalRawInput,
            onToggleTerminalGuide: () => props.setShowTerminalGuide((current) => !current),
            onBrowserActionStart: props.startBrowserAction,
            onBrowserActionRefreshAdapters: props.refreshBrowserActionAdapters,
            onBrowserActionObserve: props.observeBrowserAction,
            onBrowserActionCancel: props.cancelBrowserAction,
            onBrowserActionPolicyChange: props.updateBrowserActionPolicy,
            onCopyCodeBlock: props.copyCodeBlock,
            onCopyMessage: props.copyMessage,
            onRegenerateMessage: props.retryAssistantMessage,
            onSaveDebugLog: props.saveDebugLogForAssistantMessage,
            onToggleMessageActions: (messageId) => props.setOpenActionMenuId((current) => (current === messageId ? null : messageId)),
            onBranchMessage: props.branchFromAssistantMessage,
            onReadMessageAloud: props.readMessageAloud,
            onOpenArtifactFile: props.openArtifactFile,
            onInteractionChange: props.updateInteractionDraft,
            onInteractionRespond: props.respondToInteraction
          }}
        />

        {!isOverlayPanelOpen ? (
          <WidgetFooter
            promptComposer={{
              promptInputRef: props.promptInputRef,
              value: props.input,
              connected: props.connected,
              busy,
              voiceListening: props.voiceListening,
              voiceInputAvailable,
              onValueChange: props.setInput,
              onSubmit: props.submit,
              onPromptKeyDown: props.submitFromPromptKey,
              onFocusFromRow: props.focusPromptInput,
              onBeginResize: props.beginPromptResize,
              onUpdateResize: props.updatePromptResize,
              onFinishResize: props.finishPromptResize,
              onToggleVoice: props.toggleVoicePromptInput,
              onCancel: props.cancel
            }}
            modelControls={{
              selectedModel: props.selectedModel,
              reasoningEffort: props.reasoningEffort,
              flashing: props.sessionControlsFlashing,
              onModelChange: props.updateSelectedModel,
              onReasoningChange: props.updateReasoningEffort
            }}
            activityLog={{
              visibleActivities: props.visibleActivities,
              fallbackLines: props.fallbackLines,
              showDetails: props.showActivityDetails,
              activityBadgeCount: props.activityBadgeCount,
              ledger: props.ledger,
              providerSnapshots: props.providerSnapshots,
              onToggleDetails: () => props.setShowActivityDetails((current) => !current),
              onRefresh: props.refreshLedger
            }}
          />
        ) : null}
      </section>

      <WidgetOverlays
        mascotSprite={{
          className: mascotStateClass,
          status: mascotMotionStatus,
          onPointerDown: props.beginMascotDrag
        }}
        screenCropOverlay={
          props.screenCropPicker
            ? {
                selection: props.cropPickerSelection,
                selectionStyle: props.cropPickerSelectionStyle,
                onPointerDown: props.beginScreenCropPick,
                onPointerMove: props.updateScreenCropPick,
                onPointerUp: props.finishScreenCropPick,
                onCancel: () => props.setScreenCropPicker(null)
              }
            : null
        }
      />
    </main>
  );
}
