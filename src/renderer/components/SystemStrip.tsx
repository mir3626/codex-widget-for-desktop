import { LogIn, LogOut, Settings } from "lucide-react";

type SystemStripProps = {
  statusTone: string;
  displayStatus: string;
  statusTitle?: string;
  liveLabel: string | null;
  authenticated: boolean;
  authLabel: string;
  authButtonTitle: string;
  authDisabled: boolean;
  settingsOpen: boolean;
  onAuthAction: () => void;
  onToggleSettings: () => void;
};

export function SystemStrip({
  statusTone,
  displayStatus,
  statusTitle,
  liveLabel,
  authenticated,
  authLabel,
  authButtonTitle,
  authDisabled,
  settingsOpen,
  onAuthAction,
  onToggleSettings
}: SystemStripProps) {
  return (
    <div className="system-strip">
      <div className="status-copy">
        <span className={`status-dot ${statusTone}`} />
        <span className="status-text" data-tooltip={statusTitle}>
          {displayStatus}
        </span>
        {liveLabel ? <span className="model-label">{liveLabel}</span> : null}
      </div>
      <button
        type="button"
        className={authenticated ? "auth-button signed-in" : "auth-button"}
        data-tooltip={authButtonTitle}
        aria-label={authLabel}
        disabled={authDisabled}
        onClick={onAuthAction}
      >
        {authenticated ? <LogOut size={14} /> : <LogIn size={14} />}
        <span>{authLabel}</span>
      </button>
      <button
        type="button"
        className={settingsOpen ? "icon-button active" : "icon-button"}
        data-tooltip="Settings"
        aria-label="Settings"
        aria-pressed={settingsOpen}
        onClick={onToggleSettings}
      >
        <Settings size={14} />
      </button>
    </div>
  );
}
