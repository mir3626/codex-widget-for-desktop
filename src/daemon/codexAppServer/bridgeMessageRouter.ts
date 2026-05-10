import { handleAppServerNotification } from "./notifications.js";
import {
  emitFileChangeArtifact,
  handleAppServerRequest
} from "./requests.js";
import { handleJsonRpcResponse } from "./rpc.js";
import type {
  ActiveTurn,
  AppServerNotification,
  JsonRpcId,
  JsonRpcMessage,
  PendingInteraction,
  PendingRequest
} from "./types.js";

export function routeAppServerBridgeMessage(input: {
  raw: string;
  pendingRequests: Map<JsonRpcId, PendingRequest>;
  activeTurn: ActiveTurn | undefined;
  respond(id: string | number, result: unknown): void;
  respondError(id: string | number, code: number, message: string): void;
  storePendingInteraction(rpcId: string | number, kind: PendingInteraction["kind"], action?: string): string;
}): void {
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(input.raw) as JsonRpcMessage;
  } catch {
    return;
  }

  if (message.id !== undefined && message.method) {
    routeServerRequest({
      active: input.activeTurn,
      message,
      respond: input.respond,
      respondError: input.respondError,
      storePendingInteraction: input.storePendingInteraction
    });
    return;
  }

  if (message.id !== undefined) {
    handleJsonRpcResponse(message, input.pendingRequests);
    return;
  }

  if (message.method) {
    routeNotification({
      active: input.activeTurn,
      message: { method: message.method, params: message.params }
    });
  }
}

function routeServerRequest(input: {
  active: ActiveTurn | undefined;
  message: JsonRpcMessage;
  respond(id: string | number, result: unknown): void;
  respondError(id: string | number, code: number, message: string): void;
  storePendingInteraction(rpcId: string | number, kind: PendingInteraction["kind"], action?: string): string;
}): void {
  handleAppServerRequest({
    active: input.active,
    message: input.message,
    respond: input.respond,
    respondError: input.respondError,
    storePendingInteraction: input.storePendingInteraction,
    emitFileChangeArtifact: (phase, artifactMessage) => {
      emitFileChangeArtifact({
        active: input.active,
        phase,
        message: artifactMessage
      });
    }
  });
}

function routeNotification(input: {
  active: ActiveTurn | undefined;
  message: AppServerNotification;
}): void {
  handleAppServerNotification({
    active: input.active,
    message: input.message,
    emitFileChangeArtifact: (phase, artifactMessage) => {
      emitFileChangeArtifact({
        active: input.active,
        phase,
        message: artifactMessage
      });
    }
  });
}
