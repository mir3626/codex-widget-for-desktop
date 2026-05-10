import { WebSocket } from "ws";
import type { MessageSnapshotStatus, ServerEvent } from "../../shared/protocol.js";

const MAX_RETAINED_MESSAGES = 80;

export type RetainedMessage = {
  id: string;
  text: string;
  status: MessageSnapshotStatus;
  updatedAt: number;
};

export function broadcast(clients: Set<WebSocket>, event: ServerEvent): void {
  for (const client of clients) {
    send(client, event);
  }
}

export function retainAndBroadcast(
  clients: Set<WebSocket>,
  retainedMessages: Map<string, RetainedMessage>,
  event: ServerEvent
): void {
  retainServerEvent(retainedMessages, event);
  broadcast(clients, event);
}

export function replayRetainedMessages(socket: WebSocket, retainedMessages: Map<string, RetainedMessage>): void {
  for (const message of [...retainedMessages.values()].sort((left, right) => left.updatedAt - right.updatedAt)) {
    send(socket, {
      type: "message.snapshot",
      id: message.id,
      text: message.text,
      status: message.status
    });
  }
}

export function sessionStateToSnapshotStatus(state: Extract<ServerEvent, { type: "session.state" }>["state"]): MessageSnapshotStatus | undefined {
  if (state === "idle") {
    return undefined;
  }
  if (state === "thinking" || state === "tooling" || state === "streaming" || state === "cancelled" || state === "error") {
    return state;
  }
  return undefined;
}

export function send(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function retainServerEvent(retainedMessages: Map<string, RetainedMessage>, event: ServerEvent): void {
  if (event.type === "message.delta") {
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: `${current?.text ?? ""}${event.text}`,
      status: current?.status === "tooling" ? "tooling" : "streaming",
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "message.completed") {
    retainMessage(retainedMessages, {
      id: event.id,
      text: event.text,
      status: "done",
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "session.state" && event.id) {
    const status = sessionStateToSnapshotStatus(event.state);
    if (!status) {
      return;
    }
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: current?.text ?? "",
      status,
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "tool.started" || event.type === "tool.completed") {
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: current?.text ?? "",
      status: event.type === "tool.started" ? "tooling" : "streaming",
      updatedAt: Date.now()
    });
    return;
  }

  if (event.type === "error" && event.id) {
    const current = retainedMessages.get(event.id);
    retainMessage(retainedMessages, {
      id: event.id,
      text: current?.text ?? "",
      status: "error",
      updatedAt: Date.now()
    });
  }
}

function retainMessage(retainedMessages: Map<string, RetainedMessage>, message: RetainedMessage): void {
  retainedMessages.set(message.id, message);
  if (retainedMessages.size <= MAX_RETAINED_MESSAGES) {
    return;
  }

  const oldest = [...retainedMessages.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0];
  if (oldest) {
    retainedMessages.delete(oldest.id);
  }
}
