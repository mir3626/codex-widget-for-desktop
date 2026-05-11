import {
  ArrowDown,
  ArrowUp,
  Camera,
  Eye,
  Keyboard,
  MousePointerClick,
  Navigation,
  PlugZap,
  Redo2,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Undo2
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type {
  BrowserActionDirectCommandInput,
  BrowserActionMode,
  BrowserActionPolicyDecision
} from "../../shared/protocol.js";
import { useFloatingSurface } from "../hooks/useFloatingSurface";
import type { BrowserActionUiState } from "../types";

type BrowserActionMenuProps = {
  open: boolean;
  state: BrowserActionUiState;
  anchorRef?: RefObject<HTMLButtonElement | null>;
  onCommand: (command: BrowserActionDirectCommandInput) => void;
  onCancel: () => void;
  onPolicyChange: (decision: BrowserActionPolicyDecision) => void;
  onSafetyModeChange: (mode: BrowserActionMode) => void;
};

const SAFETY_MODES: Array<{ value: BrowserActionMode; label: string }> = [
  { value: "auto_safe_actions", label: "Auto safe" },
  { value: "ask_before_action", label: "Ask first" },
  { value: "read_only", label: "Read only" }
];

export function BrowserActionMenu({
  open,
  state,
  anchorRef,
  onCommand,
  onCancel,
  onPolicyChange,
  onSafetyModeChange
}: BrowserActionMenuProps) {
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const floating = useFloatingSurface(open, anchorRef ?? internalTriggerRef, { preferred: "bottom-end", offset: 6, margin: 8 });
  const [adapterId, setAdapterId] = useState("extension");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [targetText, setTargetText] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const activeAdapterId = useMemo(() => {
    if (state.adapters.some((adapter) => adapter.id === adapterId)) {
      return adapterId;
    }
    return state.adapters.find((adapter) => adapter.state === "ready")?.id ?? adapterId;
  }, [adapterId, state.adapters]);
  const adapterStatuses = state.adapters.length > 0 ? state.adapters : [{
    id: "extension",
    label: "Browser Bridge",
    state: "unavailable" as const,
    detail: "Bridge status not loaded.",
    capabilities: [],
    checkedAt: ""
  }];
  const visibleSafetyMode = state.safetyMode === "full_control_dev" ? "ask_before_action" : state.safetyMode;
  const bridge = summarizeBridgeStatus(state.bridgeStatus);

  const withAdapter = (command: BrowserActionDirectCommandInput): BrowserActionDirectCommandInput => ({
    ...command,
    adapterId: activeAdapterId || undefined
  });

  return open
    ? createPortal(
        <div
          id="browser-action-menu"
          ref={floating.surfaceRef}
          className={`browser-action-menu floating-surface placement-${floating.placement}`}
          style={floating.floatingStyle}
          role="menu"
          aria-label="Browser Action menu"
        >
          <div className="browser-menu-head">
            <div>
              <strong>Browser Bridge</strong>
              <span>{bridge.detail}</span>
            </div>
          </div>

          <div className={`browser-bridge-status ${bridge.tone}`}>
            <strong>{bridge.label}</strong>
            <span>{bridge.detail}</span>
          </div>

          <div className="browser-menu-section">
            <div className="browser-menu-eyebrow">Quick actions</div>
            <div className="browser-menu-grid primary">
              <MenuButton icon={<Eye size={13} />} label="Explain page" onClick={() => onCommand(withAdapter({ kind: "read" }))} />
              <MenuButton icon={<ArrowDown size={13} />} label="Scroll down" onClick={() => onCommand(withAdapter({ kind: "scroll", direction: "down", amount: "medium" }))} />
              <MenuButton icon={<ArrowUp size={13} />} label="Scroll up" onClick={() => onCommand(withAdapter({ kind: "scroll", direction: "up", amount: "medium" }))} />
              <MenuButton icon={<RefreshCw size={13} />} label="Reload" onClick={() => onCommand(withAdapter({ kind: "reload" }))} />
            </div>
          </div>

          <div className="browser-menu-section">
            <div className="browser-menu-eyebrow">Search or fill</div>
            <input
              aria-label="Browser Action target"
              value={targetText}
              onChange={(event) => setTargetText(event.target.value)}
              placeholder="target name, button, or field"
            />
            <input
              aria-label="Browser Action text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="text to type or search"
            />
            <div className="browser-menu-grid">
              <MenuButton icon={<MousePointerClick size={13} />} label="Click target" onClick={() => onCommand(withAdapter({ kind: "click", targetText }))} />
              <MenuButton icon={<Keyboard size={13} />} label="Type field" onClick={() => onCommand(withAdapter({ kind: "type", targetText, text }))} />
              <MenuButton icon={<Search size={13} />} label="Search" onClick={() => onCommand(withAdapter({ kind: "search", targetText, text }))} />
            </div>
          </div>

          <div className="browser-menu-section">
            <div className="browser-menu-eyebrow">Open page</div>
            <input
              aria-label="Browser Action URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
            />
            <div className="browser-menu-grid compact">
              <MenuButton icon={<Navigation size={13} />} label="Navigate URL" onClick={() => onCommand(withAdapter({ kind: "navigate", url }))} />
              <MenuButton icon={<Undo2 size={13} />} label="Back" onClick={() => onCommand(withAdapter({ kind: "back" }))} />
              <MenuButton icon={<Redo2 size={13} />} label="Forward" onClick={() => onCommand(withAdapter({ kind: "forward" }))} />
            </div>
          </div>

          <div className="browser-menu-section">
            <button type="button" className="browser-advanced-toggle" onClick={() => setAdvancedOpen((current) => !current)}>
              <PlugZap size={13} />
              <span>{advancedOpen ? "Hide diagnostics" : "Advanced diagnostics"}</span>
            </button>
            {advancedOpen ? (
              <>
                <div className="browser-menu-controls">
                  <label>
                    <span>Adapter</span>
                    <select aria-label="Browser Action adapter" value={activeAdapterId} onChange={(event) => setAdapterId(event.target.value)}>
                      {adapterStatuses.map((adapter) => (
                        <option key={adapter.id} value={adapter.id}>
                          {adapter.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Session</span>
                    <input readOnly aria-label="Browser Action session id" value={state.actionSessionId ? shortId(state.actionSessionId) : "idle"} />
                  </label>
                </div>
                <div className="browser-menu-grid">
                  <MenuButton icon={<Eye size={13} />} label="Observe state" onClick={() => onCommand(withAdapter({ kind: "observe" }))} />
                  <MenuButton icon={<PlugZap size={13} />} label="Adapter status" onClick={() => onCommand(withAdapter({ kind: "adapter_status" }))} />
                  <MenuButton icon={<Camera size={13} />} label="Screenshot" onClick={() => onCommand(withAdapter({ kind: "screenshot" }))} />
                  <MenuButton icon={<Square size={13} />} label="Cancel action" onClick={onCancel} />
                </div>
                <div className="browser-menu-controls single">
                  <label>
                    <span>Safety</span>
                    <select
                      aria-label="Browser Action safety mode"
                      value={visibleSafetyMode}
                      onChange={(event) => onSafetyModeChange(event.target.value as BrowserActionMode)}
                    >
                      {SAFETY_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="browser-policy-row">
                  <ShieldCheck size={13} />
                  <span>{state.policies.filter((policy) => !policy.revokedAt).length} saved browser policy</span>
                  <button type="button" onClick={() => onPolicyChange("allow")}>Allow safe</button>
                  <button type="button" onClick={() => onPolicyChange("ask")}>Ask</button>
                  <button type="button" onClick={() => onPolicyChange("deny")}>Deny risky</button>
                </div>
                <div className="browser-adapter-statuses">
                  {adapterStatuses.map((adapter) => (
                    <div key={adapter.id} className={`browser-adapter-status ${adapter.state}`}>
                      <strong>{adapter.label}</strong>
                      <small>{adapter.detail}</small>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>,
        document.body
      )
    : null;
}

function MenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" aria-label={label} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function summarizeBridgeStatus(status: BrowserActionUiState["bridgeStatus"]): { label: string; detail: string; tone: string } {
  if (!status) {
    return { label: "Bridge status not loaded", detail: "Open the extension popup or wait for heartbeat.", tone: "muted" };
  }
  const tab = status.activeTab;
  const tabLabel = tab?.title || tab?.url || "current tab";
  if (status.reloadRequired) {
    return {
      label: "Reload extension",
      detail: status.lastError || "Reload the unpacked Browser Bridge extension before retesting.",
      tone: "ask"
    };
  }
  if (!status.connected || status.mode === "off" || status.mode === "disconnected") {
    return { label: "Browser disconnected", detail: status.lastError || "Start the widget daemon and check extension settings.", tone: "off" };
  }
  if (status.mode === "permission_needed") {
    return { label: "Needs site permission", detail: tab?.origin || status.lastError || "Enable this site in the extension popup.", tone: "ask" };
  }
  if (status.mode === "restricted") {
    return { label: "Restricted page", detail: status.lastError || "Open a supported http or https page.", tone: "error" };
  }
  if (status.mode === "error") {
    return { label: "Bridge failed", detail: status.lastError || "Check extension diagnostics.", tone: "error" };
  }
  if (status.mode === "running") {
    return { label: "Browser running", detail: tabLabel, tone: "run" };
  }
  return { label: "Browser connected", detail: tabLabel, tone: "ready" };
}
