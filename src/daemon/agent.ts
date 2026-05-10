import type { CodexAppServerBridge, ExecutionPermissionPolicy } from "./codexAppServer.js";
import { augmentRequestWithProviderContext, type ProviderRegistry } from "./providers/providerRegistry.js";
import { maybeRunTerminalProvider } from "./providers/terminalProvider.js";
import { attachWidgetContext } from "./widgetContext.js";
import { tryStreamCodexAppServerResponse } from "./agent/appServerStream.js";
import { streamCodexExecResponse } from "./agent/codexExecStream.js";
import { streamMockResponse } from "./agent/mockStream.js";
import { streamOAuthProxyResponse } from "./agent/oauthProxyStream.js";
import {
  DEFAULT_MODEL_ID,
  type CodexUserInput,
  type AuthStatus,
  type BranchContextMessage,
  type ModelId,
  type ReasoningEffort,
  type ServerEvent,
  type ToolEmitter,
  type WidgetMode
} from "../shared/protocol.js";
import { emitModePreview } from "./tools.js";

export type AgentRequest = {
  id: string;
  text: string;
  mode: WidgetMode;
  model?: ModelId;
  reasoningEffort?: ReasoningEffort;
  imageDataUrls?: string[];
  appServerInput?: CodexUserInput[];
  branchContext?: BranchContextMessage[];
  widgetContext?: string;
};

export type AgentRuntimeOptions = {
  proxyUrl?: string;
  accessToken?: string;
  codexAuthenticated?: boolean;
  session?: AgentSessionState;
  codexAppServer?: CodexAppServerBridge;
  executionPermissions?: ExecutionPermissionPolicy;
  providers?: ProviderRegistry;
  authStatus?: AuthStatus;
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
  const contextAwareRequest = attachWidgetContext(request, {
    authStatus: options.authStatus,
    providers: options.providers
  });
  const effectiveRequest = augmentRequestWithProviderContext(contextAwareRequest, options.providers);

  if (options.codexAuthenticated) {
    if (shouldUseCodexAppServer(options.codexAppServer)) {
      const handled = await tryStreamCodexAppServerResponse(effectiveRequest, emit, signal, {
        codexAppServer: options.codexAppServer,
        executionPermissions: options.executionPermissions
      });
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

function shouldUseCodexAppServer(codexAppServer: CodexAppServerBridge | undefined): boolean {
  return Boolean(codexAppServer) && process.env.CODEX_WIDGET_CODEX_RUNTIME !== "exec";
}
