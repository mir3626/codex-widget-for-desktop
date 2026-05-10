import type { AgentSessionState } from "../../agent.js";
import type { CodexAppServerBridge } from "../../codexAppServer.js";

export function resetAgentSession(agentSession: AgentSessionState): void {
  delete agentSession.codexThreadId;
  delete agentSession.proxySessionId;
}

export function resetRuntimeSession(
  controllers: Map<string, AbortController>,
  retainedMessages: Map<string, unknown>,
  agentSession: AgentSessionState,
  codexAppServer: CodexAppServerBridge
): void {
  for (const controller of controllers.values()) {
    controller.abort();
  }
  controllers.clear();
  retainedMessages.clear();
  resetAgentSession(agentSession);
  codexAppServer.resetThread();
}
