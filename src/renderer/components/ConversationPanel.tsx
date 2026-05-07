import { FileText, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  LedgerSnapshot,
  ProviderStatus,
  RuntimeInteraction,
  RuntimeInteractionDecision,
  WidgetMode
} from "../../shared/protocol.js";
import type {
  ChatMessage,
  InteractionDrafts,
  TerminalKeyName,
  TerminalLine
} from "../types";
import { assistantFallbackText, assistantStatusLabel, isAssistantWorking } from "../utils/chat";
import { ArtifactLedger } from "./ArtifactLedger";
import { AssistantResponseActions } from "./AssistantResponseActions";
import { InteractionCard } from "./InteractionCard";
import { MarkdownPre, MarkdownTable } from "./MarkdownRenderers";
import { TerminalViewport } from "./TerminalViewport";

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
  onRunTerminalQuickAction: (command: string) => void;
  onClearTerminal: () => void;
  onOpenTerminalPopout: () => void;
  onTerminalInputChange: (value: string) => void;
  onTerminalInputSubmit: () => void;
  onTerminalKeySend: (key: TerminalKeyName) => void;
  onTerminalMouseEnabledChange: (enabled: boolean) => void;
  onTerminalMouseInput: (sequence: string, label: string) => void;
  onToggleTerminalGuide: () => void;
  onCopyCodeBlock: (code: string) => void;
  onCopyMessage: (messageId: string, text: string) => void;
  onRegenerateMessage: (messageId: string) => void;
  onToggleMessageActions: (messageId: string) => void;
  onBranchMessage: (messageId: string) => void;
  onReadMessageAloud: (messageId: string, text: string) => void;
  onOpenArtifactFile: (artifactFileId: string, versionId?: string) => void;
  onInteractionChange: (interactionId: string, fieldId: string, value: string) => void;
  onInteractionRespond: (interaction: RuntimeInteraction, decision: RuntimeInteractionDecision) => void;
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
  onRunTerminalQuickAction,
  onClearTerminal,
  onOpenTerminalPopout,
  onTerminalInputChange,
  onTerminalInputSubmit,
  onTerminalKeySend,
  onTerminalMouseEnabledChange,
  onTerminalMouseInput,
  onToggleTerminalGuide,
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
  const artifactCount = ledger?.artifacts.length ?? 0;
  const [showArtifacts, setShowArtifacts] = useState(false);
  const artifactFloatRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (artifactCount === 0) {
      setShowArtifacts(false);
    }
  }, [artifactCount]);

  useEffect(() => {
    if (!showArtifacts) {
      return undefined;
    }

    function closeFromOutside(event: MouseEvent | globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Node && artifactFloatRef.current?.contains(target)) {
        return;
      }
      setShowArtifacts(false);
    }

    function closeFromEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setShowArtifacts(false);
      }
    }

    document.addEventListener("pointerdown", closeFromOutside, true);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside, true);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [showArtifacts]);

  return (
    <section
      ref={conversationRef}
      className={artifactCount > 0 ? "conversation has-artifact-float" : "conversation"}
      aria-label="Conversation"
    >
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

      {chatMessages.length === 0 && interactions.length === 0 && mode !== "terminal" ? (
        <div className="empty-state">
          <span className="empty-icon">
            <ActiveModeIcon size={20} />
          </span>
          <strong>{authAuthenticated ? "Ready" : "Sign in required"}</strong>
          <span>{activeProviderStatus?.state === "stub" ? "Provider pending" : activeModeLabel}</span>
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
      {artifactCount > 0 ? (
        <div ref={artifactFloatRef} className={showArtifacts ? "conversation-artifact-float open" : "conversation-artifact-float"}>
          <button
            type="button"
            className="conversation-artifact-button"
            data-tooltip="Artifacts"
            aria-label="Artifacts"
            aria-expanded={showArtifacts}
            onClick={() => setShowArtifacts((current) => !current)}
          >
            <FileText size={14} />
            <span>{artifactCount}</span>
          </button>
          {showArtifacts && ledger ? (
            <div className="conversation-artifact-panel" role="dialog" aria-label="Session artifacts">
              <ArtifactLedger artifacts={ledger.artifacts} onOpenFile={onOpenArtifactFile} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
