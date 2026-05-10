import type { AgentRequest } from "../agent.js";
import type {
  AgentSelection,
  CodexExecutionContext
} from "../codexRuntime.js";
import type { ToolEmitter } from "../../shared/protocol.js";
import { APP_SERVER_TURN_TIMEOUT_MS } from "./constants.js";
import { isRetryableThreadError } from "./messageReaders.js";
import type {
  ActiveTurn,
  ExecutionPermissionPolicy,
  TurnStartResponse
} from "./types.js";

export type AppServerTurnInput = {
  request: AgentRequest;
  selection: AgentSelection;
  context: CodexExecutionContext;
  emit: ToolEmitter;
  executionPermissions?: ExecutionPermissionPolicy;
  signal: AbortSignal;
};

export async function runAppServerTurnLifecycle(
  input: AppServerTurnInput,
  hooks: {
    getActiveTurn: () => ActiveTurn | undefined;
    setActiveTurn: (turn: ActiveTurn | undefined) => void;
    clearThread: () => void;
    ensureReady: (context: CodexExecutionContext) => Promise<void>;
    ensureThread: (selection: AgentSelection, context: CodexExecutionContext) => Promise<string>;
    startTurn: (threadId: string, input: AppServerTurnInput) => Promise<TurnStartResponse>;
    interruptTurn: (threadId: string, turnId: string) => Promise<void>;
  }
): Promise<void> {
  if (hooks.getActiveTurn()) {
    throw new Error("Codex app-server already has an active turn.");
  }

  await hooks.ensureReady(input.context);
  let threadId = await hooks.ensureThread(input.selection, input.context);
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
  hooks.setActiveTurn(provisionalActiveTurn);

  let turn: TurnStartResponse;
  try {
    turn = await hooks.startTurn(threadId, input);
  } catch (error) {
    if (!isRetryableThreadError(error)) {
      if (hooks.getActiveTurn() === provisionalActiveTurn) {
        hooks.setActiveTurn(undefined);
      }
      throw error;
    }
    hooks.clearThread();
    threadId = await hooks.ensureThread(input.selection, input.context);
    provisionalActiveTurn.threadId = threadId;
    turn = await hooks.startTurn(threadId, input);
  }

  const turnId = turn.turn?.id;
  if (!turnId) {
    if (hooks.getActiveTurn() === provisionalActiveTurn) {
      hooks.setActiveTurn(undefined);
    }
    throw new Error("Codex app-server did not return a turn id.");
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Codex app-server turn timed out."));
    }, APP_SERVER_TURN_TIMEOUT_MS);

    const abort = () => {
      void hooks.interruptTurn(threadId, turnId);
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", abort);
      if (hooks.getActiveTurn()?.turnId === turnId) {
        hooks.setActiveTurn(undefined);
      }
    };

    hooks.setActiveTurn({
      widgetRequestId: input.request.id,
      threadId,
      turnId,
      fullText: provisionalActiveTurn.fullText,
      emit: input.emit,
      executionPermissions: input.executionPermissions,
      resolve,
      reject,
      cleanup
    });

    if (input.signal.aborted) {
      abort();
      return;
    }
    input.signal.addEventListener("abort", abort, { once: true });
  });
}
