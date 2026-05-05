import { randomUUID } from "node:crypto";
import type { CodexAppServerBridge } from "./codexAppServer.js";
import { spawnCodex } from "./codexCli.js";
import { augmentRequestWithProviderContext, type ProviderRegistry } from "./providers/providerRegistry.js";
import { maybeRunTerminalProvider } from "./providers/terminalProvider.js";
import {
  buildCodexExecArgs,
  buildCodexWidgetPrompt,
  resolveCodexExecutionContext,
  terminateProcessTree,
  type AgentSelection
} from "./codexRuntime.js";
import {
  DEFAULT_MODEL_ID,
  normalizeModelId,
  normalizeReasoningEffort,
  type AuthStatus,
  type ModelId,
  type ReasoningEffort,
  type ServerEvent,
  type ToolEmitter,
  type WidgetMode
} from "../shared/protocol.js";
import { delay, emitModePreview } from "./tools.js";

export type AgentRequest = {
  id: string;
  text: string;
  mode: WidgetMode;
  model?: ModelId;
  reasoningEffort?: ReasoningEffort;
};

export type AgentRuntimeOptions = {
  proxyUrl?: string;
  accessToken?: string;
  codexAuthenticated?: boolean;
  session?: AgentSessionState;
  codexAppServer?: CodexAppServerBridge;
  providers?: ProviderRegistry;
};

export type AgentSessionState = {
  codexThreadId?: string;
  proxySessionId?: string;
};

export async function runAgentStream(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal,
  options: AgentRuntimeOptions = {}
): Promise<void> {
  emit({ type: "session.state", state: "thinking", id: request.id });

  if (await maybeRunTerminalProvider(request, emit, signal)) {
    return;
  }

  await emitModePreview(request.id, request.mode, emit, signal, options.providers);
  emit({ type: "session.state", state: "streaming", id: request.id });
  const effectiveRequest = augmentRequestWithProviderContext(request, options.providers);

  if (options.codexAuthenticated) {
    if (shouldUseCodexAppServer(options.codexAppServer)) {
      const handled = await tryStreamCodexAppServerResponse(effectiveRequest, emit, signal, options.codexAppServer);
      if (handled) {
        return;
      }
    }
    await streamCodexExecResponse(effectiveRequest, emit, signal, options.session);
    return;
  }

  if (options.proxyUrl && options.accessToken) {
    await streamOAuthProxyResponse(effectiveRequest, emit, signal, {
      proxyUrl: options.proxyUrl,
      accessToken: options.accessToken,
      session: options.session
    });
    return;
  }

  await streamMockResponse(effectiveRequest, emit, signal);
}

async function tryStreamCodexAppServerResponse(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal,
  codexAppServer: CodexAppServerBridge | undefined
): Promise<boolean> {
  if (!codexAppServer) {
    return false;
  }

  const selection = resolveAgentSelection(request);
  const context = resolveCodexExecutionContext();
  let producedOutput = false;
  const guardedEmit: ToolEmitter = (event) => {
    if (event.type === "message.delta" || event.type === "tool.output") {
      producedOutput = true;
    }
    emit(event);
  };

  try {
    await codexAppServer.runTurn({
      request,
      selection,
      context,
      emit: guardedEmit,
      signal
    });
    return true;
  } catch (error) {
    if (signal.aborted || producedOutput) {
      throw error;
    }
    return false;
  }
}

async function streamCodexExecResponse(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal,
  session?: AgentSessionState
): Promise<void> {
  const selection = resolveAgentSelection(request);
  const context = resolveCodexExecutionContext();
  const child = spawnCodex(
    buildCodexExecArgs(selection, context, session?.codexThreadId),
    {
      cwd: context.workdir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );

  signal.addEventListener(
    "abort",
    () => {
      if (child.exitCode === null && !child.killed) {
        terminateProcessTree(child.pid);
      }
    },
    { once: true }
  );

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Unable to open Codex CLI streams.");
  }

  child.stdin.end(buildCodexWidgetPrompt(request, context));

  let fullText = "";
  let stderr = "";
  let stdoutBuffer = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        const event = readCodexJsonLine(line);
        if (event?.threadId && session) {
          session.codexThreadId = event.threadId;
        }
        if (event?.delta) {
          fullText += event.delta;
          emit({ type: "message.delta", id: request.id, text: event.delta });
        }
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });

  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  if (stdoutBuffer.trim()) {
    const event = readCodexJsonLine(stdoutBuffer.trim());
    if (event?.threadId && session) {
      session.codexThreadId = event.threadId;
    }
    if (event?.delta) {
      fullText += event.delta;
      emit({ type: "message.delta", id: request.id, text: event.delta });
    }
  }
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `codex exec exited with ${exitCode ?? "unknown"}.`);
  }

  emit({ type: "message.completed", id: request.id, text: fullText });
  emit({ type: "session.state", state: "idle", id: request.id });
}

async function streamOAuthProxyResponse(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal,
  options: Required<Pick<AgentRuntimeOptions, "proxyUrl" | "accessToken">> & Pick<AgentRuntimeOptions, "session">
): Promise<void> {
  const selection = resolveAgentSelection(request);
  const sessionId = ensureProxySessionId(options.session);
  const response = await fetch(options.proxyUrl, {
    method: "POST",
    headers: {
      Accept: "text/event-stream, application/x-ndjson, application/json, text/plain",
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      id: request.id,
      mode: request.mode,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
      reasoning_effort: selection.reasoningEffort,
      sessionId,
      session_id: sessionId,
      input: request.text,
      stream: true
    }),
    signal
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("OAuth session is not authorized. Sign in again.");
  }
  if (!response.ok) {
    throw new Error(`OAuth proxy request failed (${response.status}).`);
  }

  let fullText = "";
  const appendDelta = (delta: string) => {
    if (!delta) {
      return;
    }
    fullText += delta;
    emit({ type: "message.delta", id: request.id, text: delta });
  };

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    appendDelta(extractText(await response.json()) ?? "");
  } else if (response.body && contentType.includes("text/event-stream")) {
    await readSseStream(response.body, signal, appendDelta);
  } else if (response.body && contentType.includes("application/x-ndjson")) {
    await readNdjsonStream(response.body, signal, appendDelta);
  } else if (response.body) {
    await readTextStream(response.body, signal, appendDelta);
  } else {
    throw new Error("OAuth proxy response did not include a body.");
  }

  emit({ type: "message.completed", id: request.id, text: fullText });
  emit({ type: "session.state", state: "idle", id: request.id });
}

async function streamMockResponse(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal
): Promise<void> {
  const response = [
    "OAuth 프록시 로그인이 없어 로컬 데모 스트림으로 답변합니다. ",
    "daemon은 이미 WebSocket 이벤트를 통해 부분 응답, 도구 상태, 완료 이벤트를 위젯으로 push하고 있습니다. ",
    request.mode === "agent"
      ? "OAuth provider와 CODEX_WIDGET_AGENT_PROXY_URL을 설정하고 로그인하면 같은 UI에서 프록시 스트리밍으로 전환됩니다."
      : "이 모드는 지금은 provider stub이며, 같은 세션에 OAuth 프록시 provider를 붙이면 DOM, 화면, 터미널 출력이 그대로 흘러옵니다."
  ].join("");

  let fullText = "";
  for (const chunk of chunkText(response, 12)) {
    await delay(35, signal);
    fullText += chunk;
    emit({ type: "message.delta", id: request.id, text: chunk });
  }

  emit({ type: "message.completed", id: request.id, text: fullText });
  emit({ type: "session.state", state: "idle", id: request.id });
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

export function daemonInfo(
  port: number,
  auth: AuthStatus
): Extract<ServerEvent, { type: "connected" }>["daemon"] {
  return {
    port,
    model: process.env.CODEX_WIDGET_MODEL_LABEL ?? process.env.CODEX_WIDGET_MODEL ?? DEFAULT_MODEL_ID,
    liveModel: auth.configured && auth.authenticated,
    auth
  };
}

function resolveAgentSelection(request: AgentRequest): AgentSelection {
  return {
    model: normalizeModelId(request.model ?? process.env.CODEX_WIDGET_MODEL),
    reasoningEffort: normalizeReasoningEffort(request.reasoningEffort ?? process.env.CODEX_WIDGET_REASONING_EFFORT)
  };
}

function ensureProxySessionId(session: AgentSessionState | undefined): string | undefined {
  if (!session) {
    return undefined;
  }
  session.proxySessionId ??= randomUUID();
  return session.proxySessionId;
}

function shouldUseCodexAppServer(codexAppServer: CodexAppServerBridge | undefined): boolean {
  return Boolean(codexAppServer) && process.env.CODEX_WIDGET_CODEX_RUNTIME !== "exec";
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  appendDelta: (delta: string) => void
): Promise<void> {
  const dataLines: string[] = [];
  const flushEvent = () => {
    if (dataLines.length === 0) {
      return;
    }
    const payload = dataLines.join("\n");
    dataLines.length = 0;
    if (payload === "[DONE]") {
      return;
    }
    appendDelta(extractText(parseMaybeJson(payload)) ?? "");
  };

  await readLineStream(body, signal, (line) => {
    if (line === "") {
      flushEvent();
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  });
  flushEvent();
}

async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  appendDelta: (delta: string) => void
): Promise<void> {
  await readLineStream(body, signal, (line) => {
    if (!line.trim()) {
      return;
    }
    appendDelta(extractText(parseMaybeJson(line)) ?? "");
  });
}

async function readLineStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onLine: (line: string) => void
): Promise<void> {
  let buffer = "";
  await readTextStream(body, signal, (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      onLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });
  if (buffer.length > 0) {
    onLine(buffer.replace(/\r$/, ""));
  }
}

async function readTextStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onChunk: (chunk: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    onChunk(decoder.decode(value, { stream: true }));
  }

  const rest = decoder.decode();
  if (rest) {
    onChunk(rest);
  }
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readCodexJsonLine(line: string): { delta?: string; threadId?: string } | undefined {
  const event = parseMaybeJson(line);
  if (!isRecord(event)) {
    return undefined;
  }
  if (event.type === "thread.started" && typeof event.thread_id === "string") {
    return { threadId: event.thread_id };
  }
  if (event.type !== "item.completed" || !isRecord(event.item)) {
    return undefined;
  }
  if (event.item.type === "agent_message" && typeof event.item.text === "string") {
    return { delta: event.item.text };
  }
  return undefined;
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.delta === "string") {
    return value.delta;
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.output_text === "string") {
    return value.output_text;
  }
  if (typeof value.message === "string") {
    return value.message;
  }
  if (typeof value.content === "string") {
    return value.content;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
