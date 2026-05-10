import type { AgentRequest } from "../agent.js";
import type { ToolEmitter } from "../../shared/protocol.js";
import {
  extractTerminalSessionCommand,
  isDangerousTerminalSessionCommand,
  renderBlockedCommand,
  renderSessionResponse
} from "./terminalSessionCommands.js";
import { TerminalSession } from "./terminalSessionRuntime.js";

const terminalSession = new TerminalSession();

export function writeTerminalSessionInput(data: string, label = "input"): string {
  return terminalSession.write(data, label);
}

export function subscribeTerminalSessionOutput(listener: (chunk: string) => void): () => void {
  return terminalSession.subscribeIdleOutput(listener);
}

export async function maybeRunTerminalSessionProvider(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal
): Promise<boolean> {
  if (request.mode !== "terminal") {
    return false;
  }

  const parsed = extractTerminalSessionCommand(request.text);
  if (!parsed) {
    return false;
  }

  emit({ type: "session.state", state: "tooling", id: request.id });

  if (parsed.type === "start") {
    completeText(request.id, terminalSession.start(), emit);
    return true;
  }
  if (parsed.type === "stop") {
    completeText(request.id, terminalSession.stop(), emit);
    return true;
  }
  if (parsed.type === "status") {
    completeText(request.id, terminalSession.status(), emit);
    return true;
  }
  if (parsed.type === "write") {
    if (isDangerousTerminalSessionCommand(parsed.data) && process.env.CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE !== "1") {
      completeText(request.id, renderBlockedCommand(parsed.data), emit);
      return true;
    }

    completeText(request.id, await terminalSession.writeAndDrain(parsed.data, parsed.label, request, emit, signal), emit);
    return true;
  }
  if (parsed.type === "resize") {
    completeText(request.id, terminalSession.resize(parsed.cols, parsed.rows), emit);
    return true;
  }

  if (isDangerousTerminalSessionCommand(parsed.command) && process.env.CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE !== "1") {
    completeText(request.id, renderBlockedCommand(parsed.command), emit);
    return true;
  }

  const result = await terminalSession.run(parsed.command, request, emit, signal);
  completeText(request.id, renderSessionResponse(parsed.command, result.cwd, result.exitCode, result.output), emit);
  return true;
}

function completeText(id: string, text: string, emit: ToolEmitter): void {
  emit({ type: "message.delta", id, text });
  emit({ type: "message.completed", id, text });
  emit({ type: "session.state", state: "idle", id });
}
