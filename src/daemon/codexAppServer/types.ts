import type { ChildProcess } from "node:child_process";
import type {
  ExecutionPermissionDecision,
  RuntimeInteraction,
  RuntimeInteractionDecision,
  ToolEmitter
} from "../../shared/protocol.js";

export type JsonRpcId = string;

export type JsonRpcMessage = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type ExecutionPermissionPolicy = {
  read: (action: string) => ExecutionPermissionDecision;
};

export type ActiveTurn = {
  widgetRequestId: string;
  threadId: string;
  turnId: string;
  fullText: string;
  emit: ToolEmitter;
  executionPermissions?: ExecutionPermissionPolicy;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

export type PendingInteraction = {
  rpcId: string | number;
  kind: RuntimeInteraction["kind"];
  action?: string;
  timer: NodeJS.Timeout;
};

export type InteractionResponseResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      kind: RuntimeInteraction["kind"];
      action?: string;
      decision: Exclude<RuntimeInteractionDecision, "always_allow">;
      remember: boolean;
    };

export type ThreadStartResponse = {
  thread?: {
    id?: string;
  };
};

export type TurnStartResponse = {
  turn?: {
    id?: string;
  };
};

export type AppServerNotification = {
  method: string;
  params?: unknown;
};

export type BridgeProcessState = {
  child?: ChildProcess;
};
