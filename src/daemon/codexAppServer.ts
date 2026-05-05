import type { ChildProcess } from "node:child_process";
import WebSocket from "ws";
import type { AgentRequest } from "./agent.js";
import { spawnCodex } from "./codexCli.js";
import {
  buildCodexWidgetDeveloperInstructions,
  type AgentSelection,
  type CodexExecutionContext,
  terminateProcessTree
} from "./codexRuntime.js";
import type { RuntimeInteraction, RuntimeStatus, ToolEmitter } from "../shared/protocol.js";

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
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

type PendingInteraction = {
  rpcId: string | number;
  kind: RuntimeInteraction["kind"];
  timer: NodeJS.Timeout;
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

  async warm(context: CodexExecutionContext): Promise<void> {
    await this.ensureReady(context);
  }

  resetThread(): void {
    this.threadId = undefined;
  }

  getStatus(): RuntimeStatus["codexAppServer"] {
    return {
      state: this.ws?.readyState === WebSocket.OPEN ? "connected" : this.starting ? "starting" : "closed",
      pid: this.child?.pid,
      hasThread: Boolean(this.threadId),
      activeTurn: Boolean(this.activeTurn)
    };
  }

  respondToInteraction(input: {
    id: string;
    decision: "approve" | "decline" | "submit";
    answers?: Record<string, string>;
  }): boolean {
    const pending = this.pendingInteractions.get(input.id);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timer);
    this.pendingInteractions.delete(input.id);

    if (pending.kind === "input") {
      this.respond(pending.rpcId, { answers: input.answers ?? {} });
      return true;
    }

    this.respond(pending.rpcId, {
      decision: input.decision === "approve" ? "approve" : "decline"
    });
    return true;
  }

  async runTurn(input: {
    request: AgentRequest;
    selection: AgentSelection;
    context: CodexExecutionContext;
    emit: ToolEmitter;
    signal: AbortSignal;
  }): Promise<void> {
    if (this.activeTurn) {
      throw new Error("Codex app-server already has an active turn.");
    }

    await this.ensureReady(input.context);
    const threadId = await this.ensureThread(input.selection, input.context);
    const turn = (await this.request("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: `[mode=${input.request.mode}] ${input.request.text}`,
          text_elements: []
        }
      ],
      cwd: input.context.workdir,
      approvalPolicy: input.context.approvalPolicy,
      model: input.selection.model,
      effort: input.selection.reasoningEffort
    })) as TurnStartResponse;

    const turnId = turn.turn?.id;
    if (!turnId) {
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
        fullText: "",
        emit: input.emit,
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
      terminateProcessTree(child.pid);
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
        this.queueApprovalInteraction(id, message, "File change approval");
        return;
      case "item/tool/requestUserInput":
        this.queueUserInputInteraction(id, message);
        return;
      default:
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
    const action = readInteractionAction(item, fallbackTitle);
    const reason = readInteractionReason(item, params, "Codex needs permission before continuing.");
    const interactionId = this.storePendingInteraction(id, "approval");

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

  private storePendingInteraction(
    rpcId: string | number,
    kind: RuntimeInteraction["kind"]
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
      this.rejectAll(new Error("Codex app-server socket closed."));
    }
  }

  private handleChildExit(code: number | null): void {
    this.child = undefined;
    this.ws = undefined;
    this.threadId = undefined;
    if (!this.closing) {
      this.rejectAll(new Error(`Codex app-server exited with ${code ?? "unknown"}.`));
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

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readInteractionAction(item: Record<string, unknown> | undefined, fallback: string): string {
  if (!item) {
    return fallback;
  }

  for (const key of ["command", "path", "file", "title", "name", "tool"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return fallback;
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
