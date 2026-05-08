import {
  ArrowDown,
  ArrowUp,
  Camera,
  Eye,
  Keyboard,
  MousePointerClick,
  Navigation,
  Play,
  PlugZap,
  Redo2,
  RefreshCw,
  RotateCw,
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
  onStart: (mode: BrowserActionMode) => void;
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
  onStart,
  onCommand,
  onCancel,
  onPolicyChange,
  onSafetyModeChange
}: BrowserActionMenuProps) {
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const floating = useFloatingSurface(open, anchorRef ?? internalTriggerRef, { preferred: "bottom-end", offset: 6, margin: 8 });
  const [adapterId, setAdapterId] = useState("extension");
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
    label: "Extension",
    state: "unavailable" as const,
    detail: "Status not loaded.",
    capabilities: [],
    checkedAt: ""
  }];
  const visibleSafetyMode = state.safetyMode === "full_control_dev" ? "ask_before_action" : state.safetyMode;

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
              <strong>Browser Action</strong>
              <span>{state.actionSessionId ? shortId(state.actionSessionId) : "idle"}</span>
            </div>
            <div className="browser-menu-head-actions">
              <button type="button" aria-label="Start Browser Action session" data-tooltip="Start" onClick={() => onStart(state.safetyMode)}>
                <Play size={13} />
              </button>
              <button type="button" aria-label="Cancel Browser Action session" data-tooltip="Cancel" disabled={!state.actionSessionId} onClick={onCancel}>
                <Square size={13} />
              </button>
            </div>
          </div>

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

          <div className="browser-menu-section">
            <div className="browser-menu-eyebrow">Page</div>
            <div className="browser-menu-grid">
              <MenuButton icon={<PlugZap size={13} />} label="Adapter status" onClick={() => onCommand(withAdapter({ kind: "adapter_status" }))} />
              <MenuButton icon={<Eye size={13} />} label="Observe page" onClick={() => onCommand(withAdapter({ kind: "observe" }))} />
              <MenuButton icon={<Eye size={13} />} label="Read page" onClick={() => onCommand(withAdapter({ kind: "read" }))} />
              <MenuButton icon={<Camera size={13} />} label="Screenshot" onClick={() => onCommand(withAdapter({ kind: "screenshot" }))} />
            </div>
          </div>

          <div className="browser-menu-section">
            <div className="browser-menu-eyebrow">Target</div>
            <input
              aria-label="Browser Action target"
              value={targetText}
              onChange={(event) => setTargetText(event.target.value)}
              placeholder="target text"
            />
            <input
              aria-label="Browser Action text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="text or search"
            />
            <div className="browser-menu-grid">
              <MenuButton icon={<MousePointerClick size={13} />} label="Click target" onClick={() => onCommand(withAdapter({ kind: "click", targetText }))} />
              <MenuButton icon={<Keyboard size={13} />} label="Type field" onClick={() => onCommand(withAdapter({ kind: "type", targetText, text }))} />
              <MenuButton icon={<Search size={13} />} label="Search" onClick={() => onCommand(withAdapter({ kind: "search", targetText, text }))} />
            </div>
          </div>

          <div className="browser-menu-section">
            <div className="browser-menu-eyebrow">Navigation</div>
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
              <MenuButton icon={<RotateCw size={13} />} label="Reload" onClick={() => onCommand(withAdapter({ kind: "reload" }))} />
              <MenuButton icon={<ArrowDown size={13} />} label="Scroll down" onClick={() => onCommand(withAdapter({ kind: "scroll", direction: "down", amount: "medium" }))} />
              <MenuButton icon={<ArrowUp size={13} />} label="Scroll up" onClick={() => onCommand(withAdapter({ kind: "scroll", direction: "up", amount: "medium" }))} />
            </div>
          </div>

          <div className="browser-menu-section">
            <div className="browser-menu-eyebrow">Policy</div>
            <div className="browser-policy-row">
              <ShieldCheck size={13} />
              <span>{state.policies.filter((policy) => !policy.revokedAt).length} saved</span>
              <button type="button" onClick={() => onPolicyChange("allow")}>Allow safe</button>
              <button type="button" onClick={() => onPolicyChange("ask")}>Ask</button>
              <button type="button" onClick={() => onPolicyChange("deny")}>Deny risky</button>
            </div>
          </div>

          <div className="browser-adapter-statuses">
            {adapterStatuses.map((adapter) => (
              <div key={adapter.id} className={`browser-adapter-status ${adapter.state}`}>
                <strong>{adapter.label}</strong>
                <small>{adapter.detail}</small>
              </div>
            ))}
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
