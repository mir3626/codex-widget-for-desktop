import type { ToolEmitter } from "../../shared/protocol.js";
import type { AgentRequest, AgentSessionState } from "../agent.js";
import { spawnCodex } from "../codexCli.js";
import {
  buildCodexExecArgs,
  buildCodexWidgetPrompt,
  resolveCodexExecutionContext,
  terminateProcessTree
} from "../codexRuntime.js";
import { resolveAgentSelection } from "./selection.js";

export async function streamCodexExecResponse(
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

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
