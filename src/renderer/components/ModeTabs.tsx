import type { ProviderStatus, WidgetMode } from "../../shared/protocol.js";
import { MODES } from "../config";

type ModeTabsProps = {
  mode: WidgetMode;
  providerStatusByMode: Map<WidgetMode, ProviderStatus>;
  onModeChange: (mode: WidgetMode) => void;
};

export function ModeTabs({ mode, providerStatusByMode, onModeChange }: ModeTabsProps) {
  return (
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
            onClick={() => onModeChange(item.mode)}
          >
            <Icon size={15} />
            <span>{item.label}</span>
            {providerStatus ? <span className={`mode-status-dot ${providerStatus.state}`} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
