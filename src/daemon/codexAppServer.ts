import type { ChildProcess } from "node:child_process";
import WebSocket from "ws";
import type { AgentRequest } from "./agent.js";
import {
  renderBranchContext,
  type AgentSelection,
  type CodexExecutionContext
} from "./codexRuntime.js";
import {
  isRetryableThreadError,
  readErrorMessage
} from "./codexAppServer/messageReaders.js";
import {
  respondToPendingInteraction,
  storePendingInteraction
} from "./codexAppServer/interactions.js";
import {
  rejectPendingAppServerWork,
  sendJsonRpcError,
  sendJsonRpcNotification,
  sendJsonRpcRequest,
  sendJsonRpcResult
} from "./codexAppServer/rpc.js";
import type {
  RuntimeInteractionDecision,
  RuntimeStatus,
  ToolEmitter
} from "../shared/protocol.js";
import type {
  ActiveTurn,
  ExecutionPermissionPolicy,
  InteractionResponseResult,
  JsonRpcId,
  PendingInteraction,
  PendingRequest,
  TurnStartResponse
} from "./codexAppServer/types.js";
import { APP_SERVER_REQUEST_TIMEOUT_MS } from "./codexAppServer/constants.js";
import {
  runAppServerTurnLifecycle,
  type AppServerTurnInput
} from "./codexAppServer/turnLifecycle.js";
import {
  connectAndInitializeAppServer,
  createCodexAppServerStatus,
  ensureAppServerThread,
  startAppServerTurn
} from "./codexAppServer/bridgeLifecycle.js";
import { routeAppServerBridgeMessage } from "./codexAppServer/bridgeMessageRouter.js";
import { closeAppServerTransport } from "./codexAppServer/bridgeTransport.js";

export { buildTurnInput } from "./codexAppServer/turnInput.js";
export type { ExecutionPermissionPolicy, InteractionResponseResult } from "./codexAppServer/types.js";

export class CodexAppServerBridge {
  private child: ChildProcess | undefined;
  private ws: WebSocket | undefined;
  private starting: Promise<void> | undefined;
  private threadId: string | undefined;
  private nextRequestId = 1;
  private pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private pendingInteractions = new Map<string, PendingInteraction>();
  private activeTurn: ActiveTurn | undefined;
  private closing = false;
  private startCount = 0;
  private lastStartedAt: string | undefined;
  private lastExitedAt: string | undefined;
  private lastError: string | undefined;

  async warm(context: CodexExecutionContext): Promise<void> {
    await this.ensureReady(context);
  }

  resetThread(): void {
    this.threadId = undefined;
  }

  getThreadId(): string | undefined {
    return this.threadId;
  }

  setThreadId(threadId: string | undefined): void {
    this.threadId = threadId?.trim() || undefined;
  }

  async rollbackThread(numTurns: number): Promise<boolean> {
    if (!this.threadId || numTurns < 1) {
      return false;
    }
    try {
      await this.request("thread/rollback", {
        threadId: this.threadId,
        numTurns
      });
    } catch (error) {
      if (isRetryableThreadError(error)) {
        this.threadId = undefined;
        return false;
      }
      throw error;
    }
    return true;
  }

  getStatus(): RuntimeStatus["codexAppServer"] {
    return createCodexAppServerStatus({
      ws: this.ws,
      child: this.child,
      starting: this.starting,
      threadId: this.threadId,
      activeTurn: this.activeTurn,
      startCount: this.startCount,
      lastStartedAt: this.lastStartedAt,
      lastExitedAt: this.lastExitedAt,
      lastError: this.lastError
    });
  }

  respondToInteraction(input: {
    id: string;
    decision: RuntimeInteractionDecision;
    answers?: Record<string, string>;
  }): InteractionResponseResult {
    return respondToPendingInteraction({
      pendingInteractions: this.pendingInteractions,
      id: input.id,
      decision: input.decision,
      answers: input.answers,
      respond: (id, result) => this.respond(id, result)
    });
  }

  async runTurn(input: {
    request: AgentRequest;
    selection: AgentSelection;
    context: CodexExecutionContext;
    emit: ToolEmitter;
    executionPermissions?: ExecutionPermissionPolicy;
    signal: AbortSignal;
  }): Promise<void> {
    await runAppServerTurnLifecycle(input, {
      getActiveTurn: () => this.activeTurn,
      setActiveTurn: (turn) => {
        this.activeTurn = turn;
      },
      clearThread: () => {
        this.threadId = undefined;
      },
      ensureReady: (context) => this.ensureReady(context),
      ensureThread: (selection, context) => this.ensureThread(selection, context),
      startTurn: (threadId, turnInput) => this.startTurn(threadId, turnInput),
      interruptTurn: (threadId, turnId) => this.interruptTurn(threadId, turnId)
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.threadId = undefined;
    this.rejectAll(new Error("Codex app-server bridge closed."));

    const ws = this.ws;
    this.ws = undefined;
    const child = this.child;
    this.child = undefined;
    await closeAppServerTransport({ ws, child });
    this.closing = false;
  }

  private async ensureReady(context: CodexExecutionContext): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }

    this.starting = this.start(context).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async start(context: CodexExecutionContext): Promise<void> {
    await this.close();
    this.closing = false;
    this.startCount += 1;
    this.lastStartedAt = new Date().toISOString();
    this.lastExitedAt = undefined;

    try {
      await connectAndInitializeAppServer({
        context,
        request: (method, params, timeoutMs) => this.request(method, params, timeoutMs),
        notify: (method, params) => this.notify(method, params),
        onSpawn: (child) => {
          this.child = child;
        },
        onSocket: (ws) => {
          this.ws = ws;
        },
        onMessage: (raw) => this.handleMessage(raw),
        onSocketClose: () => this.handleSocketClose(),
        onSocketError: (error) => this.rejectAll(error),
        onChildExit: (code) => this.handleChildExit(code)
      });
      this.lastError = undefined;
    } catch (error) {
      this.lastError = readErrorMessage(error);
      await this.close();
      throw error;
    }
  }

  private async ensureThread(selection: AgentSelection, context: CodexExecutionContext): Promise<string> {
    return ensureAppServerThread({
      threadId: this.threadId,
      selection,
      context,
      request: (method, params, timeoutMs) => this.request(method, params, timeoutMs),
      setThreadId: (threadId) => {
        this.threadId = threadId;
      }
    });
  }

  private async startTurn(
    threadId: string,
    input: AppServerTurnInput
  ): Promise<TurnStartResponse> {
    return startAppServerTurn({
      threadId,
      turnInput: input,
      request: (method, params, timeoutMs) => this.request(method, params, timeoutMs)
    });
  }

  private request(method: string, params: unknown, timeoutMs = APP_SERVER_REQUEST_TIMEOUT_MS): Promise<unknown> {
    return sendJsonRpcRequest({
      ws: this.ws,
      id: String(this.nextRequestId++),
      method,
      params,
      pendingRequests: this.pendingRequests,
      timeoutMs
    });
  }

  private notify(method: string, params?: unknown): void {
    sendJsonRpcNotification(this.ws, method, params);
  }

  private async interruptTurn(threadId: string, turnId: string): Promise<void> {
    try {
      await this.request("turn/interrupt", { threadId, turnId }, 5_000);
    } catch {
      // The app-server may already have completed or disconnected.
    }
  }

  private handleMessage(raw: string): void {
    routeAppServerBridgeMessage({
      raw,
      pendingRequests: this.pendingRequests,
      activeTurn: this.activeTurn,
      respond: (id, result) => this.respond(id, result),
      respondError: (id, code, errorMessage) => this.respondError(id, code, errorMessage),
      storePendingInteraction: (rpcId, kind, action) => this.storePendingInteraction(rpcId, kind, action)
    });
  }

  private storePendingInteraction(
    rpcId: string | number,
    kind: PendingInteraction["kind"],
    action?: string
  ): string {
    return storePendingInteraction({
      pendingInteractions: this.pendingInteractions,
      rpcId,
      kind,
      action,
      respond: (id, result) => this.respond(id, result)
    });
  }

  private respond(id: string | number, result: unknown): void {
    sendJsonRpcResult(this.ws, id, result);
  }

  private respondError(id: string | number, code: number, message: string): void {
    sendJsonRpcError(this.ws, id, code, message);
  }

  private handleSocketClose(): void {
    this.ws = undefined;
    this.threadId = undefined;
    if (!this.closing) {
      const error = new Error("Codex app-server socket closed.");
      this.lastError = error.message;
      this.rejectAll(error);
    }
  }

  private handleChildExit(code: number | null): void {
    this.child = undefined;
    this.ws = undefined;
    this.threadId = undefined;
    this.lastExitedAt = new Date().toISOString();
    if (!this.closing) {
      const error = new Error(`Codex app-server exited with ${code ?? "unknown"}.`);
      this.lastError = error.message;
      this.rejectAll(error);
    }
  }

  private rejectAll(error: Error): void {
    rejectPendingAppServerWork({
      ws: this.ws,
      pendingInteractions: this.pendingInteractions,
      pendingRequests: this.pendingRequests,
      activeTurn: this.activeTurn,
      error
    });
  }
}
