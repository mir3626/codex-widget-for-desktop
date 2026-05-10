import WebSocket from "ws";
import type {
  ActiveTurn,
  JsonRpcId,
  JsonRpcMessage,
  PendingInteraction,
  PendingRequest
} from "./types.js";

export function sendJsonRpcRequest(input: {
  ws: WebSocket | undefined;
  id: JsonRpcId;
  method: string;
  params: unknown;
  pendingRequests: Map<JsonRpcId, PendingRequest>;
  timeoutMs: number;
}): Promise<unknown> {
  const { ws, id, method, params, pendingRequests, timeoutMs } = input;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Codex app-server socket is not open."));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Timed out waiting for Codex app-server ${method}.`));
    }, timeoutMs);

    pendingRequests.set(id, {
      method,
      resolve,
      reject,
      timer
    });
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    }));
  });
}

export function sendJsonRpcNotification(ws: WebSocket | undefined, method: string, params?: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    method,
    ...(params === undefined ? {} : { params })
  }));
}

export function handleJsonRpcResponse(
  message: JsonRpcMessage,
  pendingRequests: Map<JsonRpcId, PendingRequest>
): void {
  const id = String(message.id);
  const pending = pendingRequests.get(id);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timer);
  pendingRequests.delete(id);

  if (message.error) {
    pending.reject(new Error(`${pending.method}: ${message.error.message ?? "Codex app-server error"}`));
    return;
  }
  pending.resolve(message.result);
}

export function sendJsonRpcResult(ws: WebSocket | undefined, id: string | number, result: unknown): void {
  ws?.send(JSON.stringify({
    jsonrpc: "2.0",
    id,
    result
  }));
}

export function sendJsonRpcError(ws: WebSocket | undefined, id: string | number, code: number, message: string): void {
  ws?.send(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  }));
}

export function rejectPendingAppServerWork(input: {
  ws: WebSocket | undefined;
  pendingInteractions: Map<string, PendingInteraction>;
  pendingRequests: Map<JsonRpcId, PendingRequest>;
  activeTurn: ActiveTurn | undefined;
  error: Error;
}): void {
  const { ws, pendingInteractions, pendingRequests, activeTurn, error } = input;
  for (const [id, pending] of pendingInteractions.entries()) {
    clearTimeout(pending.timer);
    if (pending.kind === "input") {
      sendJsonRpcResult(ws, pending.rpcId, { answers: {} });
    } else {
      sendJsonRpcResult(ws, pending.rpcId, { decision: "decline" });
    }
    pendingInteractions.delete(id);
  }

  for (const [id, pending] of pendingRequests.entries()) {
    clearTimeout(pending.timer);
    pending.reject(error);
    pendingRequests.delete(id);
  }

  if (activeTurn) {
    activeTurn.cleanup();
    activeTurn.reject(error);
  }
}
