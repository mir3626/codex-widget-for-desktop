import { randomUUID } from "node:crypto";
import type { BrowserExtensionBridgeStatus } from "../../shared/protocol.js";
import type { ProviderRegistry } from "../providers/providerRegistry.js";
import type { DomSnapshot } from "../providers/providerSnapshots.js";
import { PreparedBrowserViewContextStore } from "./contextStore.js";
import {
  contextMatchesBridgeStatus,
  contextSatisfiesFreshness,
  readPerceptionStatusForBridge
} from "./sourceIdentity.js";
import type {
  BrowserPerceptionObserveAck,
  BrowserPerceptionObserveCommand,
  BrowserPerceptionObserveRequest,
  BrowserPerceptionObserveResult,
  BrowserPerceptionObserveResultPayload,
  BrowserPerceptionObserveStatus,
  BrowserPerceptionScheduleResult,
  PreparedBrowserViewContext
} from "./types.js";

type PendingObserve = {
  command: BrowserPerceptionObserveCommand;
  request: BrowserPerceptionObserveRequest;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: BrowserPerceptionObserveResult) => void;
  ack?: BrowserPerceptionObserveAck;
};

export class BrowserPerceptionService {
  private store = new PreparedBrowserViewContextStore();
  private pendingCommands: BrowserPerceptionObserveCommand[] = [];
  private pending = new Map<string, PendingObserve>();
  private backgroundScheduledAtBySource = new Map<string, number>();
  private backgroundSourceByCommandId = new Map<string, { sourceKey: string; deadlineAt: number }>();

  ingestProviderSnapshot(input: {
    providers: ProviderRegistry;
    bridgeStatus?: BrowserExtensionBridgeStatus;
    reason: BrowserPerceptionObserveRequest["reason"];
  }): PreparedBrowserViewContext | undefined {
    const snapshot = input.providers.getDomSnapshot();
    const observation = input.providers.getDomObservation();
    if (!snapshot || !observation) {
      return undefined;
    }
    if (input.bridgeStatus && !snapshotMatchesBridgeStatus(snapshot, input.bridgeStatus)) {
      return undefined;
    }
    return this.store.ingest({
      snapshot,
      observation,
      bridgeStatus: input.bridgeStatus,
      reason: input.reason
    });
  }

  getActiveContext(): PreparedBrowserViewContext | undefined {
    return this.store.getActive();
  }

  markDirty(reason: string): void {
    this.store.markDirty(reason);
  }

  scheduleBackgroundObserve(input: {
    providers: ProviderRegistry;
    bridgeStatus: BrowserExtensionBridgeStatus;
    reason: string;
    maxAgeMs?: number;
    timeoutMs?: number;
    settleQuietMs?: number;
    cooldownMs?: number;
  }): BrowserPerceptionScheduleResult {
    const active = input.bridgeStatus.activeTab;
    if (!input.bridgeStatus.connected || active?.permission !== "allowed" || !active.url) {
      return {
        scheduled: false,
        reason: "bridge_not_observable",
        diagnostics: {
          connected: input.bridgeStatus.connected,
          permission: active?.permission,
          mode: input.bridgeStatus.mode
        }
      };
    }

    const request = normalizeObserveRequest({
      requestId: `background-${randomUUID()}`,
      reason: "background",
      requiredFreshness: "stable",
      maxAgeMs: input.maxAgeMs ?? 5_000,
      settleQuietMs: input.settleQuietMs ?? 250,
      timeoutMs: input.timeoutMs ?? 10_000,
      actionRisk: "read",
      allowSettlingForRead: true
    });
    const prepared = this.readUsablePreparedContext({ providers: input.providers, bridgeStatus: input.bridgeStatus, request });
    if (prepared) {
      return {
        scheduled: false,
        reason: "prepared_context_fresh",
        diagnostics: {
          contextId: prepared.contextId,
          routeKey: prepared.routeKey,
          viewRevision: prepared.viewRevision,
          capturedAt: prepared.capturedAt
        }
      };
    }

    const sourceKey = readBridgeSourceKey(input.bridgeStatus);
    if (sourceKey && this.hasPendingObserveForSource(sourceKey)) {
      return {
        scheduled: false,
        reason: "observe_already_pending",
        diagnostics: { sourceKey }
      };
    }

    const now = Date.now();
    const cooldownMs = input.cooldownMs ?? 750;
    const lastScheduledAt = sourceKey ? this.backgroundScheduledAtBySource.get(sourceKey) : undefined;
    if (sourceKey && lastScheduledAt && now - lastScheduledAt < cooldownMs) {
      return {
        scheduled: false,
        reason: "background_observe_cooldown",
        diagnostics: { sourceKey, cooldownMs, elapsedMs: now - lastScheduledAt }
      };
    }

    const command = this.createObserveCommand({ request, bridgeStatus: input.bridgeStatus });
    this.pendingCommands.push(command);
    if (sourceKey) {
      this.backgroundScheduledAtBySource.set(sourceKey, now);
      this.backgroundSourceByCommandId.set(command.commandId, {
        sourceKey,
        deadlineAt: Date.parse(command.deadlineAt)
      });
    }
    return {
      scheduled: true,
      command,
      reason: input.reason,
      diagnostics: {
        sourceKey,
        deadlineAt: command.deadlineAt,
        settleQuietMs: command.settleQuietMs
      }
    };
  }

  async ensureFreshContext(input: {
    providers: ProviderRegistry;
    bridgeStatus: BrowserExtensionBridgeStatus;
    request: BrowserPerceptionObserveRequest;
    onProgress?: (detail: Record<string, unknown>) => void;
  }): Promise<BrowserPerceptionObserveResult> {
    const request = normalizeObserveRequest(input.request);
    const prepared = this.readUsablePreparedContext({ providers: input.providers, bridgeStatus: input.bridgeStatus, request });
    if (prepared) {
      return {
        status: prepared.freshness === "settling" ? "settling_ready" : "ready",
        context: prepared,
        diagnostics: {
          source: "prepared_context",
          freshness: prepared.freshness,
          stability: prepared.stability,
          viewRevision: prepared.viewRevision,
          routeKey: prepared.routeKey
        }
      };
    }

    const bridgeProblem = readPerceptionStatusForBridge(input.bridgeStatus);
    if (bridgeProblem.status) {
      return {
        status: bridgeProblem.status,
        diagnostics: {
          bridgeMode: input.bridgeStatus.mode,
          bridgePermission: input.bridgeStatus.activeTab?.permission,
          reason: "bridge_not_observable"
        },
        userRecovery: bridgeProblem.userRecovery
      };
    }

    const command = this.createObserveCommand({ request, bridgeStatus: input.bridgeStatus });
    this.pendingCommands.push(command);
    input.onProgress?.({
      commandId: command.commandId,
      reason: request.reason,
      status: "observe_queued",
      deadlineAt: command.deadlineAt
    });
    return this.waitForCommandResult({ command, request });
  }

  pollExtensionCommand(): BrowserPerceptionObserveCommand | undefined {
    const now = Date.now();
    while (true) {
      const command = this.shiftNextPendingCommand();
      if (!command) {
        return undefined;
      }
      if (Date.parse(command.deadlineAt) <= now) {
        this.cleanupBackgroundCommand(command.commandId);
        this.resolvePending(command.commandId, {
          status: "timeout",
          commandId: command.commandId,
          wait: { waitedMs: Date.now() - Date.parse(command.createdAt), timeoutMs: Date.parse(command.deadlineAt) - Date.parse(command.createdAt) },
          diagnostics: { reason: "observe_command_expired_before_poll" }
        });
        continue;
      }
      return command;
    }
  }

  acknowledgeObserveCommand(ack: BrowserPerceptionObserveAck): BrowserPerceptionObserveAck {
    const pending = this.pending.get(ack.commandId);
    if (pending) {
      pending.ack = ack;
    }
    if (ack.status !== "accepted") {
      this.cleanupBackgroundCommand(ack.commandId);
      this.resolvePending(ack.commandId, {
        status: mapAckStatusToObserveStatus(ack.status),
        commandId: ack.commandId,
        ack,
        diagnostics: {
          reason: "extension_ack_not_accepted",
          ackStatus: ack.status,
          error: ack.error
        },
        userRecovery: ack.error
      });
    }
    return ack;
  }

  completeObserveResult(input: {
    providers: ProviderRegistry;
    bridgeStatus?: BrowserExtensionBridgeStatus;
    payload: BrowserPerceptionObserveResultPayload;
  }): BrowserPerceptionObserveResult {
    const pending = this.pending.get(input.payload.commandId);
    if (!pending) {
      if (input.payload.status === "succeeded" && input.payload.snapshot) {
        const snapshot = input.providers.setDomSnapshot(input.payload.snapshot);
        const context = this.ingestProviderSnapshot({
          providers: input.providers,
          bridgeStatus: input.bridgeStatus,
          reason: readObserveResultReason(input.payload.metadata)
        });
        this.cleanupBackgroundCommand(input.payload.commandId);
        const sourceKey = input.bridgeStatus ? readBridgeSourceKey(input.bridgeStatus) : undefined;
        if (sourceKey) {
          this.dropQueuedBackgroundCommandsForSource(sourceKey);
        }
        return {
          status: context?.freshness === "settling" ? "settling_ready" : "ready",
          context,
          commandId: input.payload.commandId,
          diagnostics: {
            reason: "observe_result_without_waiter_ingested",
            payloadStatus: input.payload.status,
            url: snapshot.url,
            title: snapshot.title,
            mutationRevision: input.payload.mutationRevision,
            mutationQuietMs: input.payload.mutationQuietMs,
            readyState: input.payload.readyState
          }
        };
      }
      this.cleanupBackgroundCommand(input.payload.commandId);
      return {
        status: input.payload.status === "succeeded" ? "ready" : "error",
        commandId: input.payload.commandId,
        diagnostics: { reason: "observe_result_without_waiter", payloadStatus: input.payload.status }
      };
    }
    if (input.payload.status !== "succeeded" || !input.payload.snapshot) {
      const result: BrowserPerceptionObserveResult = {
        status: input.payload.status === "cancelled" ? "cancelled" : input.payload.status === "expired" ? "timeout" : "error",
        commandId: input.payload.commandId,
        ack: pending.ack,
        wait: { waitedMs: Date.now() - Date.parse(pending.command.createdAt), timeoutMs: Date.parse(pending.command.deadlineAt) - Date.parse(pending.command.createdAt) },
        diagnostics: {
          reason: "extension_observe_failed",
          payloadStatus: input.payload.status,
          error: input.payload.error,
          metadata: input.payload.metadata
        },
        userRecovery: input.payload.error
      };
      this.cleanupBackgroundCommand(input.payload.commandId);
      this.resolvePending(input.payload.commandId, result);
      return result;
    }

    const snapshot = input.providers.setDomSnapshot(input.payload.snapshot);
    const context = this.ingestProviderSnapshot({
      providers: input.providers,
      bridgeStatus: input.bridgeStatus,
      reason: pending.request.reason
    });
    const result: BrowserPerceptionObserveResult = {
      status: context?.freshness === "settling" ? "settling_ready" : "ready",
      context,
      commandId: input.payload.commandId,
      ack: pending.ack,
      wait: { waitedMs: Date.now() - Date.parse(pending.command.createdAt), timeoutMs: Date.parse(pending.command.deadlineAt) - Date.parse(pending.command.createdAt) },
      diagnostics: {
        reason: "extension_observe_succeeded",
        url: snapshot.url,
        title: snapshot.title,
        mutationRevision: input.payload.mutationRevision,
        mutationQuietMs: input.payload.mutationQuietMs,
        readyState: input.payload.readyState,
        bridgeLatencyTrace: input.payload.metadata?.latencyTrace
      }
    };
    this.cleanupBackgroundCommand(input.payload.commandId);
    const sourceKey = input.bridgeStatus ? readBridgeSourceKey(input.bridgeStatus) : undefined;
    if (sourceKey) {
      this.dropQueuedBackgroundCommandsForSource(sourceKey);
    }
    this.resolvePending(input.payload.commandId, result);
    return result;
  }

  cancelCommand(commandId: string, reason = "cancelled"): void {
    this.cleanupBackgroundCommand(commandId);
    this.resolvePending(commandId, {
      status: "cancelled",
      commandId,
      diagnostics: { reason }
    });
  }

  private readUsablePreparedContext(input: {
    providers: ProviderRegistry;
    bridgeStatus: BrowserExtensionBridgeStatus;
    request: RequiredObserveRequest;
  }): PreparedBrowserViewContext | undefined {
    const context = this.ingestProviderSnapshot({
      providers: input.providers,
      bridgeStatus: input.bridgeStatus,
      reason: input.request.reason
    }) ?? this.store.getActiveForBridge(input.bridgeStatus);
    if (!context) {
      return undefined;
    }
    if (input.bridgeStatus.connected && input.bridgeStatus.activeTab?.permission === "allowed" && input.bridgeStatus.activeTab.url && !contextMatchesBridgeStatus(context, input.bridgeStatus)) {
      return undefined;
    }
    return contextSatisfiesFreshness({
      context,
      requiredFreshness: input.request.requiredFreshness,
      maxAgeMs: input.request.maxAgeMs,
      allowSettlingForRead: input.request.allowSettlingForRead,
      minCapturedAt: input.bridgeStatus.connected && input.bridgeStatus.activeTab?.permission === "allowed"
        ? input.request.minCapturedAt
        : undefined
    })
      ? context
      : undefined;
  }

  private createObserveCommand(input: {
    request: RequiredObserveRequest;
    bridgeStatus: BrowserExtensionBridgeStatus;
  }): BrowserPerceptionObserveCommand {
    const now = new Date();
    return {
      kind: "observe_now",
      commandId: `browser-observe-${randomUUID()}`,
      requestId: input.request.requestId,
      reason: input.request.reason,
      expectedActiveTab: input.bridgeStatus.activeTab
        ? {
            tabId: input.bridgeStatus.activeTab.tabId,
            windowId: input.bridgeStatus.activeTab.windowId,
            url: input.bridgeStatus.activeTab.url,
            title: input.bridgeStatus.activeTab.title,
            origin: input.bridgeStatus.activeTab.origin,
            permission: input.bridgeStatus.activeTab.permission
          }
        : undefined,
      deadlineAt: new Date(now.getTime() + input.request.timeoutMs).toISOString(),
      settleQuietMs: input.request.settleQuietMs,
      includeMutationState: true,
      createdAt: now.toISOString()
    };
  }

  private waitForCommandResult(input: {
    command: BrowserPerceptionObserveCommand;
    request: RequiredObserveRequest;
  }): Promise<BrowserPerceptionObserveResult> {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(input.command.commandId);
        resolve({
          status: "timeout",
          commandId: input.command.commandId,
          wait: { waitedMs: Date.now() - startedAt, timeoutMs: input.request.timeoutMs },
          diagnostics: { reason: "observe_command_timeout", requestId: input.request.requestId }
        });
      }, input.request.timeoutMs);
      this.pending.set(input.command.commandId, {
        command: input.command,
        request: input.request,
        timer,
        resolve
      });
    });
  }

  private resolvePending(commandId: string, result: BrowserPerceptionObserveResult): void {
    this.cleanupBackgroundCommand(commandId);
    const pending = this.pending.get(commandId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(commandId);
    pending.resolve(result);
  }

  private hasPendingObserveForSource(sourceKey: string): boolean {
    const now = Date.now();
    this.cleanupExpiredBackgroundCommands(now);
    const matches = (command: BrowserPerceptionObserveCommand): boolean =>
      readCommandSourceKey(command) === sourceKey && Date.parse(command.deadlineAt) > now;
    return this.pendingCommands.some(matches) ||
      Array.from(this.pending.values()).some((pending) => matches(pending.command)) ||
      Array.from(this.backgroundSourceByCommandId.values()).some((entry) => entry.sourceKey === sourceKey && entry.deadlineAt > now);
  }

  private shiftNextPendingCommand(): BrowserPerceptionObserveCommand | undefined {
    const foregroundIndex = this.pendingCommands.findIndex((command) => command.reason !== "background");
    if (foregroundIndex >= 0) {
      return this.pendingCommands.splice(foregroundIndex, 1)[0];
    }
    return this.pendingCommands.shift();
  }

  private cleanupBackgroundCommand(commandId: string): void {
    this.backgroundSourceByCommandId.delete(commandId);
  }

  private cleanupExpiredBackgroundCommands(now = Date.now()): void {
    for (const [commandId, entry] of this.backgroundSourceByCommandId) {
      if (entry.deadlineAt <= now) {
        this.backgroundSourceByCommandId.delete(commandId);
      }
    }
  }

  private dropQueuedBackgroundCommandsForSource(sourceKey: string): void {
    this.pendingCommands = this.pendingCommands.filter((command) => {
      if (command.reason !== "background" || readCommandSourceKey(command) !== sourceKey) {
        return true;
      }
      this.cleanupBackgroundCommand(command.commandId);
      return false;
    });
  }
}

function snapshotMatchesBridgeStatus(snapshot: DomSnapshot, status: BrowserExtensionBridgeStatus): boolean {
  const active = status.activeTab;
  if (!status.connected || active?.permission !== "allowed") {
    return true;
  }
  const bridge = snapshot.bridge;
  if (bridge?.tabId !== undefined && active.tabId !== undefined && String(bridge.tabId) !== String(active.tabId)) {
    return false;
  }
  if (bridge?.windowId !== undefined && active.windowId !== undefined && String(bridge.windowId) !== String(active.windowId)) {
    return false;
  }
  if (bridge?.url && active.url && bridge.url !== active.url) {
    return false;
  }
  return true;
}

type RequiredObserveRequest = Required<Omit<BrowserPerceptionObserveRequest, "minCapturedAt">> & {
  minCapturedAt?: Date;
};

function normalizeObserveRequest(request: BrowserPerceptionObserveRequest): RequiredObserveRequest {
  return {
    requestId: request.requestId,
    reason: request.reason,
    requiredFreshness: request.requiredFreshness ?? "stable",
    maxAgeMs: request.maxAgeMs ?? 10_000,
    settleQuietMs: request.settleQuietMs ?? 500,
    timeoutMs: request.timeoutMs ?? 35_000,
    allowSettlingForRead: request.allowSettlingForRead ?? request.actionRisk === "read",
    actionRisk: request.actionRisk ?? "side_effect",
    minCapturedAt: request.minCapturedAt
  };
}

function mapAckStatusToObserveStatus(status: BrowserPerceptionObserveAck["status"]): BrowserPerceptionObserveStatus {
  if (status === "missing_permission") {
    return "permission_required";
  }
  if (status === "restricted_page" || status === "unsupported") {
    return "restricted_page";
  }
  if (status === "wrong_tab" || status === "busy") {
    return "blocked";
  }
  return "error";
}

function readBridgeSourceKey(status: BrowserExtensionBridgeStatus): string | undefined {
  const active = status.activeTab;
  if (!active?.url) {
    return undefined;
  }
  return [
    active.windowId ?? "",
    active.tabId ?? "",
    active.url,
    active.title ?? "",
    active.permission ?? ""
  ].join("|");
}

function readCommandSourceKey(command: BrowserPerceptionObserveCommand): string | undefined {
  const source = command.expectedActiveTab;
  if (!source?.url) {
    return undefined;
  }
  return [
    source.windowId ?? "",
    source.tabId ?? "",
    source.url,
    source.title ?? "",
    source.permission ?? ""
  ].join("|");
}

function readObserveResultReason(metadata: Record<string, unknown> | undefined): BrowserPerceptionObserveRequest["reason"] {
  const value = metadata?.reason;
  return value === "background" ||
    value === "prompt" ||
    value === "direct_action" ||
    value === "before_step" ||
    value === "after_step" ||
    value === "retry" ||
    value === "extension_poll" ||
    value === "legacy_snapshot"
    ? value
    : "background";
}
