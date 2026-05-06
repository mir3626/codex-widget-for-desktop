import { FileText, MessageSquarePlus, RotateCcw, Trash2 } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import type { LedgerSnapshot, SessionSummary } from "../../shared/protocol.js";
import { useFloatingSurface } from "../hooks/useFloatingSurface";
import { formatSessionTitle } from "../utils/chat";
import { ArtifactLedger } from "./ArtifactLedger";

type SessionStripProps = {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  trashedSessions: SessionSummary[];
  showSessionTrash: boolean;
  trashArtifactSessionId: string | null;
  trashLedger: LedgerSnapshot | null;
  onOpenSession: (sessionId: string) => void;
  onTrashSession: (sessionId: string) => void;
  onCreateNewSession: () => void;
  onToggleTrash: () => void;
  onViewTrashArtifacts: (sessionId: string) => void;
  onRestoreSession: (sessionId: string) => void;
  onOpenArtifactFile: (artifactFileId: string, versionId?: string) => void;
};

export function SessionStrip({
  sessions,
  activeSessionId,
  trashedSessions,
  showSessionTrash,
  trashArtifactSessionId,
  trashLedger,
  onOpenSession,
  onTrashSession,
  onCreateNewSession,
  onToggleTrash,
  onViewTrashArtifacts,
  onRestoreSession,
  onOpenArtifactFile
}: SessionStripProps) {
  const trashButtonRef = useRef<HTMLButtonElement | null>(null);
  const floating = useFloatingSurface(showSessionTrash, trashButtonRef, { preferred: "bottom-end", offset: 6, margin: 8 });

  return (
    <div className="session-strip" role="tablist" aria-label="Chat sessions">
      <div className="session-tabs">
        {sessions.length > 0 ? (
          sessions.map((session) => (
            <div
              key={session.id}
              className={session.id === activeSessionId ? "session-tab active" : "session-tab"}
              title={session.title}
            >
              <button
                type="button"
                className="session-tab-main"
                role="tab"
                aria-selected={session.id === activeSessionId}
                onClick={() => onOpenSession(session.id)}
              >
                <span>{formatSessionTitle(session.title)}</span>
              </button>
              <button
                type="button"
                className="session-tab-trash"
                title="Move session to trash"
                aria-label={`Move ${session.title} to trash`}
                onClick={() => onTrashSession(session.id)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))
        ) : (
          <span className="session-empty-label">No sessions</span>
        )}
      </div>
      <div className="session-strip-actions">
        <button type="button" title="New chat" aria-label="New chat" onClick={onCreateNewSession}>
          <MessageSquarePlus size={13} />
        </button>
        <button
          ref={trashButtonRef}
          type="button"
          className={showSessionTrash ? "active" : ""}
          title="Session trash"
          aria-label="Session trash"
          aria-pressed={showSessionTrash}
          onClick={onToggleTrash}
        >
          <Trash2 size={13} />
          {trashedSessions.length > 0 ? <span className="session-trash-count">{trashedSessions.length}</span> : null}
        </button>
      </div>
      {showSessionTrash
        ? createPortal(
            <div
              ref={floating.surfaceRef}
              className={`session-trash-popover floating-surface placement-${floating.placement}`}
              style={floating.floatingStyle}
              role="menu"
            >
              <div className="session-trash-heading">
                <strong>Trash</strong>
                <span>{trashedSessions.length}</span>
              </div>
              {trashedSessions.length > 0 ? (
                trashedSessions.map((session) => (
                  <div key={session.id} className="session-trash-entry" role="none">
                    <div className="session-trash-entry-actions">
                      {session.artifactCount ? (
                        <button
                          type="button"
                          className={trashArtifactSessionId === session.id ? "session-trash-view active" : "session-trash-view"}
                          title="View session artifacts"
                          aria-label={`View artifacts for ${session.title}`}
                          aria-pressed={trashArtifactSessionId === session.id}
                          onClick={() => onViewTrashArtifacts(session.id)}
                        >
                          <span className="session-trash-view-title">{formatSessionTitle(session.title)}</span>
                          <span className="session-trash-artifact-count">
                            <FileText size={12} />
                            <span>{session.artifactCount}</span>
                          </span>
                        </button>
                      ) : (
                        <div className="session-trash-title" title={formatSessionTitle(session.title)}>
                          <span>{formatSessionTitle(session.title)}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        className="session-trash-restore"
                        role="menuitem"
                        title={`Restore ${formatSessionTitle(session.title)}`}
                        aria-label={`Restore ${formatSessionTitle(session.title)}`}
                        data-tooltip="Restore"
                        onClick={() => onRestoreSession(session.id)}
                      >
                        <RotateCcw size={13} />
                      </button>
                    </div>
                    {trashArtifactSessionId === session.id ? (
                      <div className="session-trash-artifacts">
                        {trashLedger?.sessionId === session.id && trashLedger.artifacts.length > 0 ? (
                          <ArtifactLedger artifacts={trashLedger.artifacts} onOpenFile={onOpenArtifactFile} density="compact" />
                        ) : (
                          <p>Loading artifacts</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <p>No deleted sessions</p>
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
