import { Ban, CheckCircle2, Compass, Play, RefreshCw, ShieldCheck, Square } from "lucide-react";
import type { BrowserActionMode, BrowserActionPolicyDecision } from "../../shared/protocol.js";
import type { BrowserActionUiState } from "../types";

type BrowserActionPanelProps = {
  state: BrowserActionUiState;
  visible: boolean;
  onStart: (mode: BrowserActionMode) => void;
  onRefreshAdapters: () => void;
  onObserve: () => void;
  onCancel: () => void;
  onPolicyChange: (decision: BrowserActionPolicyDecision) => void;
};

export function BrowserActionPanel({
  state,
  visible,
  onStart,
  onRefreshAdapters,
  onObserve,
  onCancel,
  onPolicyChange
}: BrowserActionPanelProps) {
  if (!visible) {
    return null;
  }
  const readyAdapters = state.adapters.filter((adapter) => adapter.state === "ready");
  const latestProgress = state.progress.at(-1);
  const bridge = summarizeBridgePanel(state);
  return (
    <section className="browser-action-panel" aria-label="Browser Action">
      <div className="browser-action-head">
        <div>
          <strong>Browser Bridge</strong>
          <span>{bridge.detail}</span>
        </div>
        <div className="browser-action-controls">
          <button type="button" data-tooltip="Start Browser Action" aria-label="Start Browser Action" onClick={() => onStart(state.safetyMode)}>
            <Play size={13} />
          </button>
          <button type="button" data-tooltip="Refresh diagnostics" aria-label="Refresh adapters" onClick={onRefreshAdapters}>
            <RefreshCw size={13} />
          </button>
          <button type="button" data-tooltip="Observe page" aria-label="Observe page" disabled={!state.actionSessionId} onClick={onObserve}>
            <Compass size={13} />
          </button>
          <button type="button" data-tooltip="Cancel Browser Action" aria-label="Cancel Browser Action" disabled={!state.actionSessionId} onClick={onCancel}>
            <Square size={13} />
          </button>
        </div>
      </div>
      <div className="browser-action-grid">
        <Metric label="Bridge" value={bridge.label} />
        <Metric label="Safety" value={state.safetyMode} />
        <Metric label="Progress" value={latestProgress?.status ?? "idle"} />
      </div>
      {state.adapters.length > 0 ? (
        <details className="browser-action-summary">
          <summary>Diagnostics</summary>
          <div className="browser-action-adapters">
            {state.adapters.map((adapter) => (
              <div key={adapter.id} className={`browser-action-adapter ${adapter.state}`}>
                {adapter.state === "ready" ? <CheckCircle2 size={12} /> : <Ban size={12} />}
                <span>{adapter.label}</span>
                <small>{adapter.detail}</small>
              </div>
            ))}
          </div>
          <pre>{readyAdapters.length ? `ready: ${readyAdapters.map((adapter) => adapter.id).join(", ")}` : "ready: none"}</pre>
        </details>
      ) : null}
      <div className="browser-action-policy">
        <ShieldCheck size={13} />
        <span>{state.policies.filter((policy) => !policy.revokedAt).length} saved browser policy</span>
        <button type="button" onClick={() => onPolicyChange("allow")}>Allow safe</button>
        <button type="button" onClick={() => onPolicyChange("ask")}>Ask</button>
        <button type="button" onClick={() => onPolicyChange("deny")}>Deny risky</button>
      </div>
      {state.planSummary ? <SummaryBlock title="Plan" value={state.planSummary} /> : null}
      {state.resultSummary ? <SummaryBlock title="Result" value={state.resultSummary} /> : null}
      {state.error ? <p className="browser-action-error">{state.error}</p> : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="browser-action-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="browser-action-summary">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2).slice(0, 1800)}</pre>
    </details>
  );
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function summarizeBridgePanel(state: BrowserActionUiState): { label: string; detail: string } {
  const status = state.bridgeStatus;
  if (!status) {
    return {
      label: "unknown",
      detail: state.actionSessionId ? `session ${shortId(state.actionSessionId)}` : "waiting for extension heartbeat"
    };
  }
  if (!status.connected || status.mode === "off" || status.mode === "disconnected") {
    return { label: "disconnected", detail: status.lastError || "extension not connected" };
  }
  if (status.mode === "permission_needed") {
    return { label: "needs permission", detail: status.activeTab?.origin || "enable this site in the extension popup" };
  }
  if (status.mode === "restricted") {
    return { label: "restricted", detail: status.lastError || "open a supported page" };
  }
  if (status.mode === "error") {
    return { label: "failed", detail: status.lastError || "check diagnostics" };
  }
  return {
    label: status.mode === "running" ? "running" : "connected",
    detail: status.activeTab?.title || status.activeTab?.url || "ready"
  };
}
