import type { ToolEmitter } from "../../shared/protocol.js";
import type { AgentRequest } from "../agent.js";
import type { CodexAppServerBridge, ExecutionPermissionPolicy } from "../codexAppServer.js";
import { resolveCodexExecutionContext } from "../codexRuntime.js";
import { resolveAgentSelection } from "./selection.js";

export async function tryStreamCodexAppServerResponse(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal,
  options: {
    codexAppServer?: CodexAppServerBridge;
    executionPermissions?: ExecutionPermissionPolicy;
  }
): Promise<boolean> {
  const codexAppServer = options.codexAppServer;
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
      executionPermissions: options.executionPermissions,
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
