import type { RefObject } from "react";
import type { ProviderStatus, WidgetMode } from "../../shared/protocol.js";
import { MODES } from "../config";

type ModeTabsProps = {
  mode: WidgetMode;
  providerStatusByMode: Map<WidgetMode, ProviderStatus>;
  browserButtonRef?: RefObject<HTMLButtonElement | null>;
  visionButtonRef?: RefObject<HTMLButtonElement | null>;
  onModeChange: (mode: WidgetMode) => void;
};

export function ModeTabs({ mode, providerStatusByMode, browserButtonRef, visionButtonRef, onModeChange }: ModeTabsProps) {
  return (
    <div className="mode-row" role="tablist" aria-label="Mode">
      {MODES.map((item) => {
        const Icon = item.icon;
        const providerStatus = providerStatusByMode.get(item.mode);
        return (
          <button
            key={item.mode}
            ref={item.mode === "browser" ? browserButtonRef : item.mode === "screen" ? visionButtonRef : undefined}
            className={mode === item.mode ? "mode active" : "mode"}
            data-tooltip={providerStatus ? `${item.label}: ${providerStatus.detail}` : item.label}
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
