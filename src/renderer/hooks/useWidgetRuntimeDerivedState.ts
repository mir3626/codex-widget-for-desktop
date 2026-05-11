import { useMemo } from "react";
import type {
  LedgerSnapshot,
  ProviderStatus,
  RuntimeStatus,
  WidgetMode
} from "../../shared/protocol.js";
import type { LogLine } from "../types";
import type { NativeDaemonStatus } from "../shell";
import { formatNativeDaemonStatus } from "../utils/format";

export function useWidgetRuntimeDerivedState(input: {
  auth: {
    authenticated: boolean;
    reason?: string;
    signInAvailable: boolean;
    modelLabel?: string;
  };
  connected: boolean;
  ledger: LedgerSnapshot | null;
  logLines: LogLine[];
  mode: WidgetMode;
  nativeDaemonStatus: NativeDaemonStatus | null;
  providerStatuses: ProviderStatus[];
  runtimeStatus: RuntimeStatus | null;
  status: string;
  opacity: number;
}) {
  const providerStatusByMode = useMemo(
    () => new Map(input.providerStatuses.map((provider) => [provider.mode, provider])),
    [input.providerStatuses]
  );
  const activeProviderStatus = providerStatusByMode.get(input.mode);
  const terminalProviderStatus = providerStatusByMode.get("terminal");
  const providerSnapshots = input.ledger?.providerSnapshots ?? [];
  const visibleActivities = input.ledger?.activities.slice(0, 1) ?? [];
  const activityBadgeCount = input.ledger
    ? input.ledger.activities.length + input.ledger.artifacts.length + providerSnapshots.length
    : 0;
  const statusTone: "online" | "warning" | "offline" = input.connected ? (input.auth.authenticated ? "online" : "warning") : "offline";
  const displayStatus = input.connected ? input.status : formatNativeDaemonStatus(input.nativeDaemonStatus, input.status);
  const authLabel = input.auth.authenticated ? "Sign out" : "Sign in";
  const liveLabel = input.auth.authenticated
    ? input.auth.modelLabel && input.auth.modelLabel !== "codex"
      ? input.auth.modelLabel
      : ""
    : input.auth.reason ?? "Not signed in";
  const opacityLabel = `${Math.round(input.opacity * 100)}%`;
  const authButtonTitle = input.auth.authenticated
    ? "Sign out"
    : input.auth.signInAvailable
      ? "Sign in"
      : input.auth.reason ?? "Sign in is not configured";

  return {
    activeProviderStatus,
    activityBadgeCount,
    authButtonTitle,
    authLabel,
    displayStatus,
    fallbackLines: input.logLines,
    liveLabel,
    opacityLabel,
    providerSnapshots,
    providerStatusByMode,
    statusTone,
    terminalProviderStatus,
    visibleActivities
  };
}
