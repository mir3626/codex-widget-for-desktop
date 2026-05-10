import type { ChildProcess } from "node:child_process";
import WebSocket from "ws";
import type {
  AgentSelection,
  CodexExecutionContext
} from "../codexRuntime.js";
import { buildCodexWidgetDeveloperInstructions } from "../codexRuntime.js";
import type { RuntimeStatus } from "../../shared/protocol.js";
import { startAppServerConnection } from "./connection.js";
import type {
  ActiveTurn,
  ThreadStartResponse,
  TurnStartResponse
} from "./types.js";
import type { AppServerTurnInput } from "./turnLifecycle.js";
import { buildTurnInput } from "./turnInput.js";

export type AppServerRequestFn = (method: string, params: unknown, timeoutMs?: number) => Promise<unknown>;
export type AppServerNotifyFn = (method: string, params?: unknown) => void;

export function createCodexAppServerStatus(input: {
  ws: WebSocket | undefined;
  child: ChildProcess | undefined;
  starting: Promise<void> | undefined;
  threadId: string | undefined;
  activeTurn: ActiveTurn | undefined;
  startCount: number;
  lastStartedAt: string | undefined;
  lastExitedAt: string | undefined;
  lastError: string | undefined;
}): RuntimeStatus["codexAppServer"] {
  return {
    state: input.ws?.readyState === WebSocket.OPEN ? "connected" : input.starting ? "starting" : "closed",
    pid: input.child?.pid,
    hasThread: Boolean(input.threadId),
    activeTurn: Boolean(input.activeTurn),
    startCount: input.startCount,
    lastStartedAt: input.lastStartedAt,
    lastExitedAt: input.lastExitedAt,
    lastError: input.lastError
  };
}

export async function connectAndInitializeAppServer(input: {
  context: CodexExecutionContext;
  request: AppServerRequestFn;
  notify: AppServerNotifyFn;
  onSpawn(child: ChildProcess): void;
  onSocket(ws: WebSocket): void;
  onMessage(raw: string): void;
  onSocketClose(): void;
  onSocketError(error: Error): void;
  onChildExit(code: number | null): void;
}): Promise<void> {
  await startAppServerConnection({
    context: input.context,
    onSpawn: input.onSpawn,
    onSocket: input.onSocket,
    onMessage: input.onMessage,
    onSocketClose: input.onSocketClose,
    onSocketError: input.onSocketError,
    onChildExit: input.onChildExit
  });

  await input.request("initialize", {
    clientInfo: {
      name: "codex-widget-for-desktop",
      title: "Codex Widget",
      version: "0.1.0"
    },
    capabilities: {
      experimentalApi: true
    }
  });
  input.notify("initialized");
}

export async function ensureAppServerThread(input: {
  threadId: string | undefined;
  selection: AgentSelection;
  context: CodexExecutionContext;
  request: AppServerRequestFn;
  setThreadId(threadId: string): void;
}): Promise<string> {
  if (input.threadId) {
    return input.threadId;
  }

  const response = (await input.request("thread/start", {
    model: input.selection.model,
    cwd: input.context.workdir,
    approvalPolicy: input.context.approvalPolicy,
    sandbox: input.context.sandbox,
    config: {
      model_reasoning_effort: input.selection.reasoningEffort
    },
    serviceName: "codex-widget",
    developerInstructions: buildCodexWidgetDeveloperInstructions(input.context),
    sessionStartSource: "startup"
  })) as ThreadStartResponse;

  const threadId = response.thread?.id;
  if (!threadId) {
    throw new Error("Codex app-server did not return a thread id.");
  }
  input.setThreadId(threadId);
  return threadId;
}

export async function startAppServerTurn(input: {
  threadId: string;
  turnInput: AppServerTurnInput;
  request: AppServerRequestFn;
}): Promise<TurnStartResponse> {
  return (await input.request("turn/start", {
    threadId: input.threadId,
    input: buildTurnInput(input.turnInput.request),
    cwd: input.turnInput.context.workdir,
    approvalPolicy: input.turnInput.context.approvalPolicy,
    model: input.turnInput.selection.model,
    effort: input.turnInput.selection.reasoningEffort
  })) as TurnStartResponse;
}
