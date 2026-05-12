import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  ExecutionPermissionSummary,
  LedgerSnapshot,
  MessageSnapshotStatus,
  ProviderStatus,
  RuntimeInteraction,
  RuntimeStatus,
  ServerEvent,
  SessionSnapshot
} from "../../shared/protocol.js";
import type { BrowserActionUiState, CapabilityJobsUiState, LogLine, TerminalLine } from "../types";

export type WidgetServerEventDeps = {
  activeSessionIdRef: MutableRefObject<string | null>;
  appendAssistantDelta(id: string, text: string): void;
  appendLog(text: string, tone: LogLine["tone"]): void;
  appendTerminalLine(kind: TerminalLine["kind"], text: string): void;
  appendTerminalOutput(id: string, chunk: string): void;
  applyAssistantSnapshot(id: string, text: string, status: MessageSnapshotStatus): void;
  applyAuthStatus(auth: Extract<ServerEvent, { type: "auth.status" }>["auth"], options?: { quiet?: boolean }): void;
  applySessionSnapshot(snapshot: SessionSnapshot): void;
  applyVisionProviderEvent(event: Extract<ServerEvent, { type: "provider.vision" }>): void;
  addInteraction(interaction: RuntimeInteraction): void;
  completeAssistantMessage(id: string, text: string): void;
  completeTerminalRequest(id: string, text: string): void;
  markAssistantMessage(id: string, status: "thinking" | "tooling" | "streaming" | "cancelled" | "error"): void;
  registerTerminalRequest(id: string, command: string, echoCommand?: boolean): void;
  resetVisibleSession(sendToDaemon?: boolean): void;
  restorePromptFocus(): void;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setBrowserAction: Dispatch<SetStateAction<BrowserActionUiState>>;
  setCapabilityJobs: Dispatch<SetStateAction<CapabilityJobsUiState>>;
  setExecutionPermissions: Dispatch<SetStateAction<ExecutionPermissionSummary[]>>;
  setLedger: Dispatch<SetStateAction<LedgerSnapshot | null>>;
  setProviderStatuses: Dispatch<SetStateAction<ProviderStatus[]>>;
  setRuntimeStatus: Dispatch<SetStateAction<RuntimeStatus | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setTrashLedger: Dispatch<SetStateAction<LedgerSnapshot | null>>;
  terminalOutputRequestIdsRef: MutableRefObject<Set<string>>;
  terminalRequestIdsRef: MutableRefObject<Set<string>>;
  trashArtifactSessionIdRef: MutableRefObject<string | null>;
};
