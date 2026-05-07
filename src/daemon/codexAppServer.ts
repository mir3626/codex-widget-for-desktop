import type { ChildProcess } from "node:child_process";
import WebSocket from "ws";
import type { AgentRequest } from "./agent.js";
import { spawnCodex } from "./codexCli.js";
import {
  buildCodexWidgetDeveloperInstructions,
  renderBranchContext,
  type AgentSelection,
  type CodexExecutionContext,
  terminateProcessTreeAndWait
} from "./codexRuntime.js";
import { renderWidgetContextSection } from "./widgetContext.js";
import type {
  CodexUserInput,
  ExecutionPermissionDecision,
  RuntimeInteraction,
  RuntimeInteractionDecision,
  RuntimeStatus,
  ToolEmitter
} from "../shared/protocol.js";

type JsonRpcId = string;

type JsonRpcMessage = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type ActiveTurn = {
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

type PendingInteraction = {
  rpcId: string | number;
  kind: RuntimeInteraction["kind"];
  action?: string;
  timer: NodeJS.Timeout;
};

export type ExecutionPermissionPolicy = {
  read: (action: string) => ExecutionPermissionDecision;
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

type ThreadStartResponse = {
  thread?: {
    id?: string;
  };
};

type TurnStartResponse = {
  turn?: {
    id?: string;
  };
};

type AppServerNotification = {
  method: string;
  params?: unknown;
};

const APP_SERVER_START_TIMEOUT_MS = 15_000;
const APP_SERVER_REQUEST_TIMEOUT_MS = 90_000;
const APP_SERVER_TURN_TIMEOUT_MS = 15 * 60_000;
const APP_SERVER_INTERACTION_TIMEOUT_MS = 10 * 60_000;

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
    return {
      state: this.ws?.readyState === WebSocket.OPEN ? "connected" : this.starting ? "starting" : "closed",
      pid: this.child?.pid,
      hasThread: Boolean(this.threadId),
      activeTurn: Boolean(this.activeTurn),
      startCount: this.startCount,
      lastStartedAt: this.lastStartedAt,
      lastExitedAt: this.lastExitedAt,
      lastError: this.lastError
    };
  }

  respondToInteraction(input: {
    id: string;
    decision: RuntimeInteractionDecision;
    answers?: Record<string, string>;
  }): InteractionResponseResult {
    const pending = this.pendingInteractions.get(input.id);
    if (!pending) {
      return { handled: false };
    }

    clearTimeout(pending.timer);
    this.pendingInteractions.delete(input.id);

    if (pending.kind === "input") {
      this.respond(pending.rpcId, { answers: input.decision === "decline" ? {} : input.answers ?? {} });
      return {
        handled: true,
        kind: pending.kind,
        action: pending.action,
        decision: input.decision === "decline" ? "decline" : "submit",
        remember: false
      };
    }

    const decision = input.decision === "always_allow" ? "approve" : input.decision;
    this.respond(pending.rpcId, {
      decision: decision === "approve" ? "accept" : "decline"
    });
    return {
      handled: true,
      kind: pending.kind,
      action: pending.action,
      decision: decision === "approve" ? "approve" : "decline",
      remember: input.decision === "always_allow"
    };
  }

  async runTurn(input: {
    request: AgentRequest;
    selection: AgentSelection;
    context: CodexExecutionContext;
    emit: ToolEmitter;
    executionPermissions?: ExecutionPermissionPolicy;
    signal: AbortSignal;
  }): Promise<void> {
    if (this.activeTurn) {
      throw new Error("Codex app-server already has an active turn.");
    }

    await this.ensureReady(input.context);
    let threadId = await this.ensureThread(input.selection, input.context);
    const provisionalActiveTurn: ActiveTurn = {
      widgetRequestId: input.request.id,
      threadId,
      turnId: "",
      fullText: "",
      emit: input.emit,
      executionPermissions: input.executionPermissions,
      resolve: () => undefined,
      reject: () => undefined,
      cleanup: () => undefined
    };
    this.activeTurn = provisionalActiveTurn;
    let turn: TurnStartResponse;
    try {
      turn = await this.startTurn(threadId, input);
    } catch (error) {
      if (!isRetryableThreadError(error)) {
        if (this.activeTurn === provisionalActiveTurn) {
          this.activeTurn = undefined;
        }
        throw error;
      }
      this.threadId = undefined;
      threadId = await this.ensureThread(input.selection, input.context);
      provisionalActiveTurn.threadId = threadId;
      turn = await this.startTurn(threadId, input);
    }

    const turnId = turn.turn?.id;
    if (!turnId) {
      if (this.activeTurn === provisionalActiveTurn) {
        this.activeTurn = undefined;
      }
      throw new Error("Codex app-server did not return a turn id.");
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Codex app-server turn timed out."));
      }, APP_SERVER_TURN_TIMEOUT_MS);

      const abort = () => {
        void this.interruptTurn(threadId, turnId);
        reject(new DOMException("Aborted", "AbortError"));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        input.signal.removeEventListener("abort", abort);
        if (this.activeTurn?.turnId === turnId) {
          this.activeTurn = undefined;
        }
      };

      this.activeTurn = {
        widgetRequestId: input.request.id,
        threadId,
        turnId,
        fullText: provisionalActiveTurn.fullText,
        emit: input.emit,
        executionPermissions: input.executionPermissions,
        resolve,
        reject,
        cleanup
      };

      if (input.signal.aborted) {
        abort();
        return;
      }
      input.signal.addEventListener("abort", abort, { once: true });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.threadId = undefined;
    this.rejectAll(new Error("Codex app-server bridge closed."));

    const ws = this.ws;
    this.ws = undefined;
    if (ws && ws.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        ws.close();
        setTimeout(resolve, 500);
      });
    }

    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null && !child.killed) {
      await terminateProcessTreeAndWait(child.pid);
    }
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
      const child = spawnCodex(["app-server", "--listen", "ws://127.0.0.1:0"], {
        cwd: context.workdir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      this.child = child;

      child.stdout?.resume();
      child.on("exit", (code) => this.handleChildExit(code));

      const url = await this.waitForListeningUrl(child);
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on("message", (raw) => this.handleMessage(raw.toString()));
      ws.on("close", () => this.handleSocketClose());
      ws.on("error", (error) => this.rejectAll(error instanceof Error ? error : new Error(String(error))));

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out connecting to Codex app-server.")), 10_000);
        ws.once("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });

      await this.request("initialize", {
        clientInfo: {
          name: "codex-widget-for-desktop",
          title: "Codex Widget",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true
        }
      });
      this.notify("initialized");
      this.lastError = undefined;
    } catch (error) {
      this.lastError = readErrorMessage(error);
      await this.close();
      throw error;
    }
  }

  private waitForListeningUrl(child: ChildProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      let stderr = "";
      const timer = setTimeout(() => {
        reject(new Error(`Codex app-server did not announce a WebSocket URL. ${stderr.trim()}`));
      }, APP_SERVER_START_TIMEOUT_MS);

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
        const match = /listening on:\s*(ws:\/\/[^\s]+)/.exec(stderr);
        if (!match?.[1]) {
          return;
        }
        clearTimeout(timer);
        resolve(match[1]);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Codex app-server exited before startup completed (${code ?? "unknown"}). ${stderr.trim()}`));
      });
    });
  }

  private async ensureThread(selection: AgentSelection, context: CodexExecutionContext): Promise<string> {
    if (this.threadId) {
      return this.threadId;
    }

    const response = (await this.request("thread/start", {
      model: selection.model,
      cwd: context.workdir,
      approvalPolicy: context.approvalPolicy,
      sandbox: context.sandbox,
      config: {
        model_reasoning_effort: selection.reasoningEffort
      },
      serviceName: "codex-widget",
      developerInstructions: buildCodexWidgetDeveloperInstructions(context),
      sessionStartSource: "startup"
    })) as ThreadStartResponse;

    const threadId = response.thread?.id;
    if (!threadId) {
      throw new Error("Codex app-server did not return a thread id.");
    }
    this.threadId = threadId;
    return threadId;
  }

  private async startTurn(
    threadId: string,
    input: {
      request: AgentRequest;
      selection: AgentSelection;
      context: CodexExecutionContext;
    }
  ): Promise<TurnStartResponse> {
    return (await this.request("turn/start", {
      threadId,
      input: buildTurnInput(input.request),
      cwd: input.context.workdir,
      approvalPolicy: input.context.approvalPolicy,
      model: input.selection.model,
      effort: input.selection.reasoningEffort
    })) as TurnStartResponse;
  }

  private request(method: string, params: unknown, timeoutMs = APP_SERVER_REQUEST_TIMEOUT_MS): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Codex app-server socket is not open."));
    }

    const id = String(this.nextRequestId++);
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server ${method}.`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        method,
        resolve,
        reject,
        timer
      });
      ws.send(JSON.stringify(payload));
    });
  }

  private notify(method: string, params?: unknown): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        ...(params === undefined ? {} : { params })
      })
    );
  }

  private async interruptTurn(threadId: string, turnId: string): Promise<void> {
    try {
      await this.request("turn/interrupt", { threadId, turnId }, 5_000);
    } catch {
      // The app-server may already have completed or disconnected.
    }
  }

  private handleMessage(raw: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      return;
    }

    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }

    if (message.id !== undefined) {
      this.handleResponse(message);
      return;
    }

    if (message.method) {
      this.handleNotification({ method: message.method, params: message.params });
    }
  }

  private handleResponse(message: JsonRpcMessage): void {
    const id = String(message.id);
    const pending = this.pendingRequests.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingRequests.delete(id);

    if (message.error) {
      pending.reject(new Error(`${pending.method}: ${message.error.message ?? "Codex app-server error"}`));
      return;
    }
    pending.resolve(message.result);
  }

  private handleServerRequest(message: JsonRpcMessage): void {
    const id = message.id;
    if (id === undefined || id === null) {
      return;
    }

    switch (message.method) {
      case "item/commandExecution/requestApproval":
        this.queueApprovalInteraction(id, message, "Command approval");
        return;
      case "item/fileChange/requestApproval":
        this.emitFileChangeArtifact("before", message);
        this.queueApprovalInteraction(id, message, "File change approval");
        return;
      case "item/tool/requestUserInput":
        this.queueUserInputInteraction(id, message);
        return;
      default:
        if (isExternalUrlApprovalRequest(message)) {
          this.queueApprovalInteraction(id, message, "Open browser");
          return;
        }
        this.respondError(id, -32601, `Unsupported app-server request: ${message.method ?? "unknown"}`);
    }
  }

  private queueApprovalInteraction(id: string | number, message: JsonRpcMessage, fallbackTitle: string): void {
    const active = this.activeTurn;
    if (!active) {
      this.respond(id, { decision: "decline" });
      return;
    }

    const params = readRecord(message.params);
    const item = readRecord(params?.item) ?? params;
    const externalUrl = readExternalUrlApprovalTarget(message.method, params, item);
    const action = readApprovalAction(item, fallbackTitle, externalUrl);
    const reason =
      externalUrl
        ? `Codex wants to open ${externalUrl} in your browser.`
        : readInteractionReason(item, params, "Codex needs permission before continuing.");
    const savedDecision = readSavedApprovalDecision(active.executionPermissions, action, item, fallbackTitle);
    if (savedDecision === "allow" || savedDecision === "deny") {
      this.respond(id, { decision: savedDecision === "allow" ? "accept" : "decline" });
      active.emit({
        type: "execution.permission.applied",
        id: active.widgetRequestId,
        action,
        decision: savedDecision
      });
      return;
    }

    const interactionId = this.storePendingInteraction(id, "approval", action);

    active.emit({
      type: "approval.required",
      id: active.widgetRequestId,
      action,
      reason
    });
    active.emit({
      type: "interaction.required",
      interaction: {
        id: interactionId,
        requestId: active.widgetRequestId,
        kind: "approval",
        title: action,
        body: reason,
        action
      }
    });
  }

  private queueUserInputInteraction(id: string | number, message: JsonRpcMessage): void {
    const active = this.activeTurn;
    if (!active) {
      this.respond(id, { answers: {} });
      return;
    }

    const params = readRecord(message.params);
    const interactionId = this.storePendingInteraction(id, "input");
    active.emit({
      type: "interaction.required",
      interaction: {
        id: interactionId,
        requestId: active.widgetRequestId,
        kind: "input",
        title: readInputTitle(params),
        body: readInteractionReason(params, undefined, "Codex needs more information to continue."),
        fields: readInputFields(params)
      }
    });
  }

  private emitFileChangeArtifact(phase: "before" | "after", message: Pick<JsonRpcMessage, "method" | "params">): void {
    const active = this.activeTurn;
    if (!active) {
      return;
    }

    const params = readRecord(message.params);
    const item = readRecord(params?.item) ?? params;
    const paths = readFileChangePaths(item);
    if (paths.length === 0) {
      return;
    }

    active.emit({
      type: "artifact.fileChange",
      id: active.widgetRequestId,
      changeId: readFileChangeId(item, active.turnId),
      phase,
      title: readFileChangeTitle(item, phase),
      operation: readFileChangeOperation(item),
      paths,
      detail: pickFileChangeDetail(item)
    });
  }

  private storePendingInteraction(
    rpcId: string | number,
    kind: RuntimeInteraction["kind"],
    action?: string
  ): string {
    const interactionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      const pending = this.pendingInteractions.get(interactionId);
      if (!pending) {
        return;
      }
      this.pendingInteractions.delete(interactionId);
      if (pending.kind === "input") {
        this.respond(pending.rpcId, { answers: {} });
        return;
      }
      this.respond(pending.rpcId, { decision: "decline" });
    }, APP_SERVER_INTERACTION_TIMEOUT_MS);

    this.pendingInteractions.set(interactionId, {
      rpcId,
      kind,
      action,
      timer
    });
    return interactionId;
  }

  private handleNotification(message: AppServerNotification): void {
    const active = this.activeTurn;

    if (message.method === "item/agentMessage/delta" && active) {
      const params = readRecord(message.params);
      if (params?.turnId !== active.turnId || typeof params.delta !== "string") {
        return;
      }
      active.fullText += params.delta;
      active.emit({ type: "message.delta", id: active.widgetRequestId, text: params.delta });
      return;
    }

    if (message.method === "turn/completed" && active) {
      const params = readRecord(message.params);
      const turn = readRecord(params?.turn);
      if (turn?.id !== active.turnId) {
        return;
      }

      const status = typeof turn.status === "string" ? turn.status : "completed";
      const fullText = active.fullText;
      const emit = active.emit;
      const requestId = active.widgetRequestId;
      const resolve = active.resolve;
      const reject = active.reject;
      active.cleanup();

      if (status === "failed") {
        reject(new Error(readTurnError(turn.error) ?? "Codex app-server turn failed."));
        return;
      }
      if (status === "interrupted") {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      emit({ type: "message.completed", id: requestId, text: fullText });
      emit({ type: "session.state", state: "idle", id: requestId });
      resolve();
      return;
    }

    if (!active) {
      return;
    }

    if (message.method === "item/started") {
      const item = readRecord(readRecord(message.params)?.item);
      const tool = describeToolItem(item);
      if (tool) {
        active.emit({ type: "tool.started", id: active.widgetRequestId, tool: tool.name, label: tool.label });
      }
      return;
    }

    if (message.method === "item/completed") {
      const item = readRecord(readRecord(message.params)?.item);
      const tool = describeToolItem(item);
      if (tool) {
        active.emit({ type: "tool.completed", id: active.widgetRequestId, tool: tool.name });
      }
      if (item?.type === "fileChange") {
        this.emitFileChangeArtifact("after", { method: message.method, params: { item } });
      }
      return;
    }

    if (
      message.method === "item/commandExecution/outputDelta" ||
      message.method === "item/fileChange/outputDelta" ||
      message.method === "item/mcpToolCall/progress"
    ) {
      const params = readRecord(message.params);
      const chunk =
        typeof params?.delta === "string"
          ? params.delta
          : typeof params?.message === "string"
            ? params.message
            : "";
      if (chunk) {
        active.emit({ type: "tool.output", id: active.widgetRequestId, tool: message.method, chunk });
      }
    }
  }

  private respond(id: string | number, result: unknown): void {
    this.ws?.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result
      })
    );
  }

  private respondError(id: string | number, code: number, message: string): void {
    this.ws?.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code,
          message
        }
      })
    );
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
    for (const [id, pending] of this.pendingInteractions.entries()) {
      clearTimeout(pending.timer);
      if (pending.kind === "input") {
        this.respond(pending.rpcId, { answers: {} });
      } else {
        this.respond(pending.rpcId, { decision: "decline" });
      }
      this.pendingInteractions.delete(id);
    }

    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }

    if (this.activeTurn) {
      const active = this.activeTurn;
      active.cleanup();
      active.reject(error);
    }
  }
}

export function buildTurnInput(request: AgentRequest): CodexUserInput[] {
  if (request.appServerInput?.length) {
    return mergeContextIntoOverride(request, request.appServerInput);
  }

  const input: CodexUserInput[] = [
    {
      type: "text",
      text: [
        `[mode=${request.mode}]`,
        renderWidgetContextSection(request.widgetContext),
        renderBranchContext(request.branchContext),
        "User request:",
        request.text
      ].filter((part) => part !== "").join("\n"),
      text_elements: []
    }
  ];

  for (const url of request.imageDataUrls ?? []) {
    if (isSupportedImageUrl(url)) {
      input.push({ type: "image", url });
    }
  }

  return input;
}

function mergeContextIntoOverride(request: AgentRequest, override: CodexUserInput[]): CodexUserInput[] {
  const contextPrefix = [
    `[mode=${request.mode}]`,
    renderWidgetContextSection(request.widgetContext),
    renderBranchContext(request.branchContext)
  ].filter((part) => part !== "").join("\n");
  const normalized = override.flatMap(normalizeUserInput);
  if (!contextPrefix) {
    return normalized;
  }
  const firstTextIndex = normalized.findIndex((item) => item.type === "text");
  if (firstTextIndex < 0) {
    return [
      { type: "text", text: contextPrefix, text_elements: [] },
      ...normalized
    ];
  }
  return normalized.map((item, index) => {
    if (index !== firstTextIndex || item.type !== "text") {
      return item;
    }
    return {
      ...item,
      text: [contextPrefix, item.text].filter(Boolean).join("\n\n")
    };
  });
}

function normalizeUserInput(input: CodexUserInput): CodexUserInput[] {
  if (input.type === "text") {
    return [{
      type: "text",
      text: input.text,
      text_elements: []
    }];
  }
  if (input.type === "image" && isSupportedImageUrl(input.url)) {
    return [input];
  }
  if (input.type === "localImage" && input.path.trim()) {
    return [{ type: "localImage", path: input.path.trim() }];
  }
  return [];
}

function isSupportedImageUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) || /^https?:\/\//i.test(value);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readApprovalAction(item: Record<string, unknown> | undefined, fallback: string, externalUrl?: string): string {
  if (externalUrl) {
    return "Open external URL";
  }

  const command = readCommandText(item);
  if (command && isPowerShellCommand(command)) {
    return "PowerShell command";
  }

  return readInteractionAction(item, fallback);
}

function readInteractionAction(item: Record<string, unknown> | undefined, fallback: string): string {
  if (!item) {
    return fallback;
  }

  for (const key of ["command", "url", "uri", "href", "path", "file", "title", "name", "tool"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return fallback;
}

function readCommandText(item: Record<string, unknown> | undefined): string {
  const command = item?.command;
  if (typeof command === "string") {
    return command.trim();
  }
  if (Array.isArray(command)) {
    return command.filter((part): part is string => typeof part === "string").join(" ").trim();
  }
  return "";
}

function isExternalUrlApprovalRequest(message: Pick<JsonRpcMessage, "method" | "params">): boolean {
  const method = message.method?.toLowerCase() ?? "";
  if (!method.includes("approval") && !method.includes("request")) {
    return false;
  }

  const params = readRecord(message.params);
  const item = readRecord(params?.item) ?? params;
  return Boolean(readExternalUrlApprovalTarget(message.method, params, item));
}

function readExternalUrlApprovalTarget(
  method: string | undefined,
  params: Record<string, unknown> | undefined,
  item: Record<string, unknown> | undefined
): string | undefined {
  const url = readFirstHttpUrl(item) ?? readFirstHttpUrl(params);
  if (!url) {
    return undefined;
  }

  const methodText = method?.toLowerCase() ?? "";
  const typeText = [item?.type, item?.kind, item?.tool, item?.name, item?.title]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/(open|browser|external|url|link)/.test(`${methodText} ${typeText}`)) {
    return url;
  }

  const command = readCommandText(item);
  if (command && isBrowserOpenCommand(command, url)) {
    return url;
  }

  return undefined;
}

function readFirstHttpUrl(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) {
    return undefined;
  }

  const seen = new Set<unknown>();
  const stack: unknown[] = [record];
  while (stack.length > 0) {
    const value = stack.shift();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);

    if (typeof value === "string") {
      const direct = normalizeHttpUrl(value);
      if (direct) {
        return direct;
      }
      const match = value.match(/https?:\/\/[^\s"'<>]+/i);
      const embedded = match ? normalizeHttpUrl(match[0]) : undefined;
      if (embedded) {
        return embedded;
      }
      continue;
    }

    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }

    const nested = readRecord(value);
    if (nested) {
      stack.push(...Object.values(nested));
    }
  }

  return undefined;
}

function normalizeHttpUrl(value: string): string | undefined {
  const trimmed = value.trim().replace(/[),.;]+$/g, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    return url.toString();
  } catch {
    return undefined;
  }
}

function isBrowserOpenCommand(command: string, url: string): boolean {
  const canonicalUrl = url.replace(/\/$/, "");
  const escapedUrl = escapeRegex(canonicalUrl);
  if (!new RegExp(`${escapedUrl}/?`, "i").test(command)) {
    return false;
  }

  const normalized = command.replace(/\s+/g, " ").trim();
  if (/^(?:start(?:\s+"[^"]*")?|cmd\s+\/c\s+start(?:\s+"[^"]*")?|open|xdg-open|explorer(?:\.exe)?|rundll32\s+url\.dll,FileProtocolHandler)\b/i.test(normalized)) {
    return true;
  }

  return isPowerShellCommand(normalized) && /\b(?:start-process|start)\b/i.test(normalized);
}

function readSavedApprovalDecision(
  permissions: ExecutionPermissionPolicy | undefined,
  action: string,
  item: Record<string, unknown> | undefined,
  fallbackTitle: string
): ExecutionPermissionDecision {
  const savedDecision = permissions?.read(action) ?? "ask";
  if (savedDecision === "allow" || savedDecision === "deny") {
    return savedDecision;
  }

  const legacyAction = readInteractionAction(item, fallbackTitle);
  if (legacyAction && legacyAction !== action) {
    const legacyDecision = permissions?.read(legacyAction) ?? "ask";
    if (legacyDecision === "allow" || legacyDecision === "deny") {
      return legacyDecision;
    }
  }

  return "ask";
}

function isPowerShellCommand(command: string): boolean {
  const executable = readCommandExecutable(command).replace(/\//g, "\\");
  return /(?:^|\\)(?:powershell|pwsh)(?:\.exe)?$/i.test(executable);
}

function readCommandExecutable(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith('"')) {
    const closingQuote = trimmed.indexOf('"', 1);
    return closingQuote > 1 ? trimmed.slice(1, closingQuote).trim() : trimmed;
  }

  return trimmed.split(/\s+/, 1)[0]?.trim() ?? "";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readInteractionReason(
  primary: Record<string, unknown> | undefined,
  secondary: Record<string, unknown> | undefined,
  fallback: string
): string {
  for (const record of [primary, secondary]) {
    if (!record) {
      continue;
    }

    for (const key of ["reason", "message", "description", "prompt", "summary"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return fallback;
}

function readInputTitle(params: Record<string, unknown> | undefined): string {
  const title = params?.title;
  return typeof title === "string" && title.trim() ? title.trim() : "Input required";
}

function readInputFields(params: Record<string, unknown> | undefined): RuntimeInteraction["fields"] {
  const rawFields = params?.fields;
  if (Array.isArray(rawFields)) {
    const fields = rawFields.flatMap((field, index) => {
      const record = readRecord(field);
      if (!record) {
        return [];
      }

      const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `answer_${index + 1}`;
      const label =
        typeof record.label === "string" && record.label.trim()
          ? record.label.trim()
          : typeof record.name === "string" && record.name.trim()
            ? record.name.trim()
            : `Answer ${index + 1}`;
      const placeholder =
        typeof record.placeholder === "string" && record.placeholder.trim() ? record.placeholder.trim() : undefined;

      return [
        {
          id,
          label,
          placeholder,
          multiline: record.multiline === true
        }
      ];
    });

    if (fields.length > 0) {
      return fields;
    }
  }

  return [
    {
      id: "answer",
      label: "Response",
      placeholder: "Type a response for Codex",
      multiline: true
    }
  ];
}

function describeToolItem(item: Record<string, unknown> | undefined): { name: string; label: string } | undefined {
  if (!item || typeof item.type !== "string" || typeof item.id !== "string") {
    return undefined;
  }

  if (item.type === "commandExecution") {
    return {
      name: item.id,
      label: typeof item.command === "string" ? item.command : "Command"
    };
  }
  if (item.type === "fileChange") {
    return { name: item.id, label: "File change" };
  }
  if (item.type === "mcpToolCall") {
    return {
      name: item.id,
      label: [item.server, item.tool].filter((value) => typeof value === "string").join(" / ") || "MCP tool"
    };
  }
  if (item.type === "dynamicToolCall") {
    return {
      name: item.id,
      label: [item.namespace, item.tool].filter((value) => typeof value === "string").join(" / ") || "Tool"
    };
  }
  if (item.type === "webSearch") {
    return {
      name: item.id,
      label: typeof item.query === "string" ? `Web search: ${item.query}` : "Web search"
    };
  }

  return undefined;
}

function readFileChangePaths(item: Record<string, unknown> | undefined): string[] {
  if (!item) {
    return [];
  }

  const candidates: string[] = [];
  for (const key of ["path", "file", "filePath", "targetPath"]) {
    const value = item[key];
    if (typeof value === "string") {
      candidates.push(value);
    }
  }

  for (const key of ["paths", "files", "filePaths", "changes"]) {
    const value = item[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (typeof entry === "string") {
        candidates.push(entry);
        continue;
      }
      const record = readRecord(entry);
      for (const nestedKey of ["path", "file", "filePath", "targetPath"]) {
        const nested = record?.[nestedKey];
        if (typeof nested === "string") {
          candidates.push(nested);
        }
      }
    }
  }

  return [...new Set(candidates.map((path) => path.trim()).filter(Boolean))].slice(0, 20);
}

function readFileChangeId(item: Record<string, unknown> | undefined, fallback: string): string {
  for (const key of ["id", "changeId", "itemId"]) {
    const value = item?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function readFileChangeTitle(item: Record<string, unknown> | undefined, phase: "before" | "after"): string {
  for (const key of ["title", "summary", "description"]) {
    const value = item?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  const paths = readFileChangePaths(item);
  return paths.length === 1 ? `File ${phase}: ${paths[0]}` : "File change";
}

function readFileChangeOperation(item: Record<string, unknown> | undefined): "create" | "modify" | "delete" {
  const operation = typeof item?.operation === "string" ? item.operation.toLowerCase() : "";
  const kind = typeof item?.kind === "string" ? item.kind.toLowerCase() : "";
  const changeType = typeof item?.changeType === "string" ? item.changeType.toLowerCase() : "";
  const combined = `${operation} ${kind} ${changeType}`;
  if (/\b(delete|remove|unlink)\b/.test(combined)) {
    return "delete";
  }
  if (/\b(create|add|new)\b/.test(combined)) {
    return "create";
  }
  return "modify";
}

function pickFileChangeDetail(item: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!item) {
    return {};
  }
  const detail: Record<string, unknown> = {};
  for (const key of ["id", "type", "operation", "kind", "changeType", "summary", "description"]) {
    if (item[key] !== undefined) {
      detail[key] = item[key];
    }
  }
  return detail;
}

function readTurnError(value: unknown): string | undefined {
  const error = readRecord(value);
  if (!error) {
    return undefined;
  }
  if (typeof error.message === "string") {
    return error.message;
  }
  if (typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

function readErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isRetryableThreadError(value: unknown): boolean {
  const message = readErrorMessage(value).toLowerCase();
  return (
    message.includes("thread") &&
    (message.includes("not found") ||
      message.includes("unknown") ||
      message.includes("invalid") ||
      message.includes("does not exist") ||
      message.includes("closed"))
  );
}
