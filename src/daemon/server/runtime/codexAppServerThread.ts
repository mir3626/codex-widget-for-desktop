import type { OAuthSession } from "../../oauth.js";
import type { CodexAppServerBridge } from "../../codexAppServer.js";
import { resolveCodexExecutionContext } from "../../codexRuntime.js";
import type { StorageService } from "../../storage/storage.js";
import type { ClientMessage } from "../../../shared/protocol.js";

const CODEX_APP_SERVER_RUNTIME_PROVIDER = "codex-app-server";

export function syncCodexAppServer(auth: OAuthSession, codexAppServer: CodexAppServerBridge): void {
  const status = auth.getStatus();
  if (status.mode !== "codex" || !status.authenticated || process.env.CODEX_WIDGET_CODEX_RUNTIME === "exec") {
    codexAppServer.resetThread();
    return;
  }

  void codexAppServer.warm(resolveCodexExecutionContext()).catch(() => undefined);
}

export async function prepareRegeneration(
  message: Extract<ClientMessage, { type: "ask" }>,
  auth: OAuthSession,
  codexAppServer: CodexAppServerBridge
): Promise<void> {
  const dropTurns = Math.floor(message.regenerate?.dropTurns ?? 0);
  if (dropTurns < 1) {
    return;
  }

  const status = auth.getStatus();
  if (status.mode === "codex" && status.authenticated && process.env.CODEX_WIDGET_CODEX_RUNTIME !== "exec") {
    await codexAppServer.rollbackThread(dropTurns);
  }
}

export function bindCodexAppServerThread(
  storage: StorageService,
  sessionId: string,
  codexAppServer: CodexAppServerBridge
): void {
  const thread = storage.readRuntimeThread(sessionId, CODEX_APP_SERVER_RUNTIME_PROVIDER);
  codexAppServer.setThreadId(thread?.threadId);
}

export function persistCodexAppServerThread(
  storage: StorageService,
  sessionId: string,
  codexAppServer: CodexAppServerBridge,
  error?: unknown
): void {
  const threadId = codexAppServer.getThreadId();
  if (!threadId) {
    storage.clearRuntimeThread(
      sessionId,
      CODEX_APP_SERVER_RUNTIME_PROVIDER,
      error instanceof Error ? error.message : undefined
    );
    return;
  }

  storage.writeRuntimeThread({
    sessionId,
    provider: CODEX_APP_SERVER_RUNTIME_PROVIDER,
    threadId,
    state: error ? "error" : "connected",
    lastError: error instanceof Error ? error.message : undefined
  });
}
