import { randomUUID } from "node:crypto";
import type { ToolEmitter } from "../../shared/protocol.js";
import type { AgentRequest, AgentRuntimeOptions, AgentSessionState } from "../agent.js";
import { readProxyResponseText } from "./proxyStream.js";
import { resolveAgentSelection } from "./selection.js";

export async function streamOAuthProxyResponse(
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
      branchContext: request.branchContext,
      branch_context: request.branchContext,
      widgetContext: request.widgetContext,
      widget_context: request.widgetContext,
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

  await readProxyResponseText(response, signal, appendDelta);

  emit({ type: "message.completed", id: request.id, text: fullText });
  emit({ type: "session.state", state: "idle", id: request.id });
}

function ensureProxySessionId(session: AgentSessionState | undefined): string | undefined {
  if (!session) {
    return undefined;
  }
  session.proxySessionId ??= randomUUID();
  return session.proxySessionId;
}
