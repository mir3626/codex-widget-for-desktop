import { Camera, type LucideIcon } from "lucide-react";
import type { RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LedgerSnapshot, ProviderStatus, RuntimeInteraction, WidgetMode } from "../../shared/protocol.js";
import type {
  ChatMessage,
  InteractionDrafts,
  TerminalKeyName,
  TerminalLine,
  VisionFrameStats,
  VisionStreamSettings
} from "../types";
import { assistantFallbackText, assistantStatusLabel, isAssistantWorking } from "../utils/chat";
import { ArtifactLedger } from "./ArtifactLedger";
import { AssistantResponseActions } from "./AssistantResponseActions";
import { InteractionCard } from "./InteractionCard";
import { MarkdownPre, MarkdownTable } from "./MarkdownRenderers";
import { TerminalViewport } from "./TerminalViewport";
import { VisionActionMenu } from "./VisionActionMenu";

type ConversationPanelProps = {
  conversationRef: RefObject<HTMLElement | null>;
  mode: WidgetMode;
  busy: boolean;
  authAuthenticated: boolean;
  activeProviderStatus?: ProviderStatus;
  terminalProviderStatus?: ProviderStatus;
  activeModeLabel: string;
  activeModeIcon: LucideIcon;
  chatMessages: ChatMessage[];
  interactions: RuntimeInteraction[];
  interactionDrafts: InteractionDrafts;
  ledger: LedgerSnapshot | null;
  activeRequestId: string | null;
  openActionMenuId: string | null;
  speakingMessageId: string | null;
  terminalLines: TerminalLine[];
  terminalInput: string;
  terminalMouseEnabled: boolean;
  showTerminalGuide: boolean;
  showVisionMenu: boolean;
  isVisionRecording: boolean;
  isVisionStreaming: boolean;
  visionStateLabel: string;
  visionStreamStatusText: string;
  visionStreamSettings: VisionStreamSettings;
  visionFrameStats: VisionFrameStats;
  onRunTerminalQuickAction: (command: string) => void;
  onClearTerminal: () => void;
  onOpenTerminalPopout: () => void;
  onTerminalInputChange: (value: string) => void;
  onTerminalInputSubmit: () => void;
  onTerminalKeySend: (key: TerminalKeyName) => void;
  onTerminalMouseEnabledChange: (enabled: boolean) => void;
  onTerminalMouseInput: (sequence: string, label: string) => void;
  onToggleTerminalGuide: () => void;
  onToggleVisionMenu: () => void;
  onCaptureScreen: () => void;
  onRecordVision: () => void;
  onStreamVision: () => void;
  onVisionFrameIntervalChange: (value: string) => void;
  onVisionMaxDurationChange: (value: string) => void;
  onCopyCodeBlock: (code: string) => void;
  onCopyMessage: (messageId: string, text: string) => void;
  onRegenerateMessage: (messageId: string) => void;
  onToggleMessageActions: (messageId: string) => void;
  onBranchMessage: (messageId: string) => void;
  onReadMessageAloud: (messageId: string, text: string) => void;
  onOpenArtifactFile: (artifactFileId: string, versionId?: string) => void;
  onInteractionChange: (interactionId: string, fieldId: string, value: string) => void;
  onInteractionRespond: (interaction: RuntimeInteraction, decision: "approve" | "decline" | "submit") => void;
};

export function ConversationPanel({
  conversationRef,
  mode,
  busy,
  authAuthenticated,
  activeProviderStatus,
  terminalProviderStatus,
  activeModeLabel,
  activeModeIcon: ActiveModeIcon,
  chatMessages,
  interactions,
  interactionDrafts,
  ledger,
  activeRequestId,
  openActionMenuId,
  speakingMessageId,
  terminalLines,
  terminalInput,
  terminalMouseEnabled,
  showTerminalGuide,
  showVisionMenu,
  isVisionRecording,
  isVisionStreaming,
  visionStateLabel,
  visionStreamStatusText,
  visionStreamSettings,
  visionFrameStats,
  onRunTerminalQuickAction,
  onClearTerminal,
  onOpenTerminalPopout,
  onTerminalInputChange,
  onTerminalInputSubmit,
  onTerminalKeySend,
  onTerminalMouseEnabledChange,
  onTerminalMouseInput,
  onToggleTerminalGuide,
  onToggleVisionMenu,
  onCaptureScreen,
  onRecordVision,
  onStreamVision,
  onVisionFrameIntervalChange,
  onVisionMaxDurationChange,
  onCopyCodeBlock,
  onCopyMessage,
  onRegenerateMessage,
  onToggleMessageActions,
  onBranchMessage,
  onReadMessageAloud,
  onOpenArtifactFile,
  onInteractionChange,
  onInteractionRespond
}: ConversationPanelProps) {
  return (
    <section ref={conversationRef} className="conversation" aria-label="Conversation">
      {mode === "terminal" ? (
        <TerminalViewport
          lines={terminalLines}
          providerStatus={terminalProviderStatus}
          busy={busy}
          onStart={() => onRunTerminalQuickAction("/pty start")}
          onStatus={() => onRunTerminalQuickAction("/pty status")}
          onStop={() => onRunTerminalQuickAction("/pty stop")}
          onClear={onClearTerminal}
          onPopout={onOpenTerminalPopout}
          inputValue={terminalInput}
          onInputChange={onTerminalInputChange}
          onInputSubmit={onTerminalInputSubmit}
          onKeySend={onTerminalKeySend}
          mouseEnabled={terminalMouseEnabled}
          onMouseEnabledChange={onTerminalMouseEnabledChange}
          onMouseInput={onTerminalMouseInput}
          showGuide={showTerminalGuide}
          onToggleGuide={onToggleTerminalGuide}
        />
      ) : null}

      {mode === "screen" ? (
        <div className="vision-toolbar" aria-label="Vision tools">
          <span className={isVisionRecording || isVisionStreaming ? "vision-live-label active" : "vision-live-label"}>
            {isVisionStreaming ? visionStreamStatusText : visionStateLabel}
          </span>
          <VisionActionMenu
            open={showVisionMenu}
            statusLabel={visionStateLabel}
            recording={isVisionRecording}
            streaming={isVisionStreaming}
            settings={visionStreamSettings}
            frameStats={visionFrameStats}
            streamStatusText={visionStreamStatusText}
            onToggle={onToggleVisionMenu}
            onCapture={onCaptureScreen}
            onRecord={onRecordVision}
            onStream={onStreamVision}
            onFrameIntervalChange={onVisionFrameIntervalChange}
            onMaxDurationChange={onVisionMaxDurationChange}
            expanded
          />
        </div>
      ) : null}

      {chatMessages.length === 0 && interactions.length === 0 && mode !== "terminal" ? (
        <div className="empty-state">
          <span className="empty-icon">
            <ActiveModeIcon size={20} />
          </span>
          <strong>{authAuthenticated ? "Ready" : "Sign in required"}</strong>
          <span>{activeProviderStatus?.state === "stub" ? "Provider pending" : activeModeLabel}</span>
          {mode === "screen" ? (
            <button type="button" className="empty-action" onClick={onToggleVisionMenu}>
              <Camera size={13} />
              <span>Vision tools</span>
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
                          pre: (props) => <MarkdownPre {...props} onCopyCode={onCopyCodeBlock} />,
                          table: (props) => <MarkdownTable {...props} />
                        }}
                      >
                        {message.text}
                      </ReactMarkdown>
                      {isAssistantWorking(message.status) ? <span className="typing-cursor" aria-hidden="true" /> : null}
                    </div>
                    {!isAssistantWorking(message.status) ? (
                      <AssistantResponseActions
                        messageId={message.id}
                        open={openActionMenuId === message.id}
                        disabled={Boolean(activeRequestId)}
                        speaking={speakingMessageId === message.id}
                        onCopy={() => onCopyMessage(message.id, message.text)}
                        onRegenerate={() => onRegenerateMessage(message.id)}
                        onToggle={() => onToggleMessageActions(message.id)}
                        onBranch={() => onBranchMessage(message.id)}
                        onReadAloud={() => onReadMessageAloud(message.id, message.text)}
                      />
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
          {ledger?.artifacts.length ? <ArtifactLedger artifacts={ledger.artifacts} onOpenFile={onOpenArtifactFile} /> : null}
          {interactions.map((interaction) => (
            <InteractionCard
              key={interaction.id}
              interaction={interaction}
              values={interactionDrafts[interaction.id] ?? {}}
              onChange={onInteractionChange}
              onRespond={onInteractionRespond}
            />
          ))}
        </>
      )}
    </section>
  );
}
