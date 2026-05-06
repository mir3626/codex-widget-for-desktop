import { Camera, Square } from "lucide-react";
import type { ProviderStatus, RuntimeStatus, ScreenCrop } from "../../shared/protocol.js";
import type { NativeDaemonStatus } from "../shell";
import type { ScreenCropSettings } from "../types";
import { formatRuntimeAge } from "../utils/format";
import { RuntimeMetric } from "./RuntimeMetric";

type SettingsPanelProps = {
  autostartEnabled: boolean;
  runtimeStatus: RuntimeStatus | null;
  nativeDaemonStatus: NativeDaemonStatus | null;
  providerStatuses: ProviderStatus[];
  screenCrop: ScreenCropSettings;
  onAutostartChange: (enabled: boolean) => void;
  onCaptureScreen: () => void;
  onScreenCropEnabledChange: (enabled: boolean) => void;
  onScreenCropFieldChange: (field: keyof ScreenCrop, value: string) => void;
  onStartScreenCropPicker: () => void;
};

export function SettingsPanel({
  autostartEnabled,
  runtimeStatus,
  nativeDaemonStatus,
  providerStatuses,
  screenCrop,
  onAutostartChange,
  onCaptureScreen,
  onScreenCropEnabledChange,
  onScreenCropFieldChange,
  onStartScreenCropPicker
}: SettingsPanelProps) {
  return (
    <section className="settings-panel" aria-label="Settings">
      <div className="settings-section">
        <div className="settings-heading">
          <strong>Resident</strong>
          <span>Desktop behavior</span>
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={autostartEnabled} onChange={(event) => onAutostartChange(event.target.checked)} />
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
              <button type="button" className="provider-action" title="Capture snapshot" aria-label="Capture screen snapshot" onClick={onCaptureScreen}>
                <Camera size={12} />
              </button>
            ) : null}
          </div>
        ))}
        <div className="screen-crop-card">
          <label className="screen-crop-toggle">
            <input type="checkbox" checked={screenCrop.enabled} onChange={(event) => onScreenCropEnabledChange(event.target.checked)} />
            <span>Crop</span>
          </label>
          <div className="screen-crop-grid" aria-label="Screen crop rectangle">
            {(["x", "y", "width", "height"] as const).map((field) => (
              <label key={field}>
                <span>{field === "width" ? "W" : field === "height" ? "H" : field.toUpperCase()}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={screenCrop[field]}
                  min={field === "width" || field === "height" ? 0 : undefined}
                  onChange={(event) => onScreenCropFieldChange(field, event.target.value)}
                  disabled={!screenCrop.enabled}
                />
              </label>
            ))}
          </div>
          <button type="button" className="screen-crop-picker-button" aria-label="Select crop area" onClick={onStartScreenCropPicker}>
            <Square size={12} />
            <span>Select</span>
          </button>
        </div>
      </div>
    </section>
  );
}
