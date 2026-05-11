import { Dispatch, SetStateAction, useState } from "react";
import type {
  BrowserActionDirectCommandInput,
  BrowserActionMode,
  BrowserActionPolicyDecision,
  ClientMessage
} from "../../shared/protocol.js";
import type { BrowserActionUiState } from "../types";

export function useBrowserActionController(input: {
  activeSessionId: string | null;
  send(message: ClientMessage): boolean;
}): {
  browserAction: BrowserActionUiState;
  setBrowserAction: Dispatch<SetStateAction<BrowserActionUiState>>;
  showBrowserActionMenu: boolean;
  setShowBrowserActionMenu: Dispatch<SetStateAction<boolean>>;
  startBrowserAction(mode: BrowserActionMode): void;
  refreshBrowserActionAdapters(): void;
  observeBrowserAction(): void;
  runBrowserActionCommand(command: BrowserActionDirectCommandInput): void;
  setBrowserActionSafetyMode(mode: BrowserActionMode): void;
  cancelBrowserAction(): void;
  updateBrowserActionPolicy(decision: BrowserActionPolicyDecision): void;
} {
  const [browserAction, setBrowserAction] = useState<BrowserActionUiState>({
    actionSessionId: null,
    bridgeStatus: null,
    adapters: [],
    policies: [],
    observationSummary: null,
    planSummary: null,
    resultSummary: null,
    diagnosticsSummary: null,
    progress: [],
    error: null,
    safetyMode: "auto_safe_actions"
  });
  const [showBrowserActionMenu, setShowBrowserActionMenu] = useState(false);

  function startBrowserAction(mode: BrowserActionMode) {
    const actionSessionId = `browser-action-ui-${crypto.randomUUID()}`;
    setBrowserAction((current) => ({
      ...current,
      actionSessionId,
      safetyMode: mode,
      progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: "starting" }],
      error: null
    }));
    input.send({
      type: "browserAction.start",
      actionSessionId,
      sessionId: input.activeSessionId ?? undefined,
      mode
    });
    input.send({ type: "browserAction.adapters", actionSessionId });
  }

  function refreshBrowserActionAdapters() {
    input.send({ type: "browserAction.adapters", actionSessionId: browserAction.actionSessionId ?? undefined });
  }

  function observeBrowserAction() {
    if (!browserAction.actionSessionId) {
      startBrowserAction(browserAction.safetyMode);
      return;
    }
    input.send({ type: "browserAction.observe", actionSessionId: browserAction.actionSessionId });
  }

  function runBrowserActionCommand(command: BrowserActionDirectCommandInput) {
    const actionSessionId = browserAction.actionSessionId ?? command.actionSessionId;
    input.send({
      type: "browserAction.command",
      requestId: `browser-action-direct-${crypto.randomUUID()}`,
      command: {
        ...command,
        actionSessionId: actionSessionId ?? undefined,
        sessionId: input.activeSessionId ?? command.sessionId,
        mode: command.mode ?? browserAction.safetyMode
      }
    });
    setBrowserAction((current) => ({
      ...current,
      progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: `direct_${command.kind}` }],
      error: null
    }));
  }

  function setBrowserActionSafetyMode(mode: BrowserActionMode) {
    setBrowserAction((current) => ({
      ...current,
      safetyMode: mode
    }));
  }

  function cancelBrowserAction() {
    if (!browserAction.actionSessionId) {
      return;
    }
    input.send({ type: "browserAction.cancel", actionSessionId: browserAction.actionSessionId });
    setBrowserAction((current) => ({
      ...current,
      progress: [...current.progress.slice(-5), { id: crypto.randomUUID(), status: "cancel_requested" }]
    }));
  }

  function updateBrowserActionPolicy(decision: BrowserActionPolicyDecision) {
    input.send({
      type: "browserAction.policy.set",
      policy: {
        decision,
        actionFamily: decision === "deny" ? "all" : decision === "allow" ? "safe_read_scroll" : "safe_click_type",
        targetRisk: decision === "deny" ? "destructive" : "low",
        mode: "any",
        note: decision === "allow" ? "Renderer quick policy for safe Browser Action reads and scrolls." : "Renderer quick Browser Action policy."
      }
    });
  }

  return {
    browserAction,
    setBrowserAction,
    showBrowserActionMenu,
    setShowBrowserActionMenu,
    startBrowserAction,
    refreshBrowserActionAdapters,
    observeBrowserAction,
    runBrowserActionCommand,
    setBrowserActionSafetyMode,
    cancelBrowserAction,
    updateBrowserActionPolicy
  };
}
