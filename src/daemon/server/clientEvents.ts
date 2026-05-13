import { WebSocket } from "ws";
import type { BrowserActionPolicy } from "../browser-action/index.js";
import type { StorageService } from "../storage/storage.js";
import type { ExecutionPermissionSummary, SessionSnapshot } from "../../shared/protocol.js";
import { broadcast, send } from "./events.js";

export function sendSessionSnapshot(socket: WebSocket, storage: StorageService): void {
  try {
    send(socket, { type: "session.snapshot", snapshot: storage.ensureSessionSnapshot() });
  } catch (error) {
    send(socket, {
      type: "error",
      message: error instanceof Error ? error.message : "Unable to load sessions."
    });
  }
}

export function sendExecutionPermissions(socket: WebSocket, storage: StorageService): void {
  try {
    send(socket, { type: "execution.permissions", permissions: storage.readExecutionPermissions() });
  } catch (error) {
    send(socket, {
      type: "error",
      message: error instanceof Error ? error.message : "Unable to load execution permissions."
    });
  }
}

export function broadcastExecutionPermissions(clients: Set<WebSocket>, permissions: ExecutionPermissionSummary[]): void {
  broadcast(clients, { type: "execution.permissions", permissions });
}

export function sendBrowserActionPolicies(socket: WebSocket, storage: StorageService): void {
  try {
    send(socket, { type: "browserAction.policies", policies: storage.readBrowserActionPolicies() });
  } catch (error) {
    send(socket, {
      type: "error",
      message: error instanceof Error ? error.message : "Unable to load Browser Action policies."
    });
  }
}

export function broadcastBrowserActionPolicies(clients: Set<WebSocket>, policies: BrowserActionPolicy[]): void {
  broadcast(clients, { type: "browserAction.policies", policies });
}

export function sendLedgerSnapshot(socket: WebSocket, storage: StorageService, sessionId?: string): void {
  try {
    send(socket, { type: "ledger.snapshot", snapshot: storage.readLedgerSnapshot(sessionId) });
  } catch (error) {
    send(socket, {
      type: "error",
      message: error instanceof Error ? error.message : "Unable to load artifact ledger."
    });
  }
}

export function broadcastLedgerSnapshot(clients: Set<WebSocket>, storage: StorageService, sessionId?: string): void {
  try {
    broadcast(clients, { type: "ledger.snapshot", snapshot: storage.readLedgerSnapshot(sessionId) });
  } catch {
    // Ledger refresh must not interrupt streaming turns.
  }
}

export function publishSessionMutation(
  socket: WebSocket,
  clients: Set<WebSocket>,
  storage: StorageService,
  mutate: () => SessionSnapshot,
  options: { reset?: boolean } = {}
): void {
  try {
    const snapshot = mutate();
    if (options.reset) {
      broadcast(clients, { type: "session.reset" });
    }
    broadcast(clients, { type: "session.snapshot", snapshot });
    broadcastLedgerSnapshot(clients, storage, snapshot.activeSessionId);
    broadcast(clients, { type: "session.state", state: "idle" });
  } catch (error) {
    send(socket, {
      type: "error",
      message: error instanceof Error ? error.message : "Unable to update sessions."
    });
  }
}
