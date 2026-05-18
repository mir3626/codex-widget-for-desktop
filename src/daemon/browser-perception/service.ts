import { randomUUID } from "node:crypto";
import type { BrowserExtensionBridgeStatus } from "../../shared/protocol.js";
import type { ProviderRegistry } from "../providers/providerRegistry.js";
import { PreparedBrowserViewContextStore } from "./contextStore.js";
import {
  contextMatchesBridgeStatus,
  contextSatisfiesFreshness,
  readPerceptionStatusForBridge
} from "./sourceIdentity.js";
import {
  isObserveAckStatus,
  mapAckStatusToObserveStatus,
  normalizeObserveRequest,
  readBridgeSourceKey,
  readCommandSourceKey,
  readObserveResultReason,
  snapshotMatchesBridgeStatus,
  type RequiredObserveRequest
} from "./observeUtils.js";
import type {
  BrowserPerceptionObserveAck,
  BrowserPerceptionObserveCommand,
  BrowserPerceptionObserveRequest,
  BrowserPerceptionObserveResult,
  BrowserPerceptionObserveResultPayload,
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
    const commandId = typeof ack.commandId === "string" ? ack.commandId.trim() : "";
    if (!commandId) {
      throw new Error("Browser Perception observe acknowledgement requires commandId.");
    }
    if (!isObserveAckStatus(ack.status)) {
      throw new Error("Browser Perception observe acknowledgement has invalid status.");
    }
    if (!this.hasKnownObserveCommand(commandId)) {
      throw new Error(`Browser Perception observe command not pending: ${commandId}`);
    }
    const normalizedAck: BrowserPerceptionObserveAck = { ...ack, commandId };
    const pending = this.pending.get(commandId);
    if (pending) {
      pending.ack = normalizedAck;
    }
    if (normalizedAck.status !== "accepted") {
      this.cleanupBackgroundCommand(commandId);
      this.resolvePending(commandId, {
        status: mapAckStatusToObserveStatus(normalizedAck.status),
        commandId,
        ack: normalizedAck,
        diagnostics: {
          reason: "extension_ack_not_accepted",
          ackStatus: normalizedAck.status,
          error: normalizedAck.error
        },
        userRecovery: normalizedAck.error
      });
    }
    return normalizedAck;
  }

  completeObserveResult(input: {
    providers: ProviderRegistry;
    bridgeStatus?: BrowserExtensionBridgeStatus;
    payload: BrowserPerceptionObserveResultPayload;
  }): BrowserPerceptionObserveResult {
    const commandId = typeof input.payload.commandId === "string" ? input.payload.commandId.trim() : "";
    if (!commandId) {
      throw new Error("Browser Perception observe result requires commandId.");
    }
    const pending = this.pending.get(commandId);
    if (!pending && !this.hasKnownObserveCommand(commandId)) {
      throw new Error(`Browser Perception observe command not pending: ${commandId}`);
    }
    const payload: BrowserPerceptionObserveResultPayload = { ...input.payload, commandId };
    if (!pending) {
      if (payload.status === "succeeded" && payload.snapshot) {
        const snapshot = input.providers.setDomSnapshot(payload.snapshot);
        const context = this.ingestProviderSnapshot({
          providers: input.providers,
          bridgeStatus: input.bridgeStatus,
          reason: readObserveResultReason(payload.metadata)
        });
        this.cleanupBackgroundCommand(commandId);
        const sourceKey = input.bridgeStatus ? readBridgeSourceKey(input.bridgeStatus) : undefined;
        if (sourceKey) {
          this.dropQueuedBackgroundCommandsForSource(sourceKey);
        }
        return {
          status: context?.freshness === "settling" ? "settling_ready" : "ready",
          context,
          commandId,
          diagnostics: {
            reason: "observe_result_without_waiter_ingested",
            payloadStatus: payload.status,
            url: snapshot.url,
            title: snapshot.title,
            mutationRevision: payload.mutationRevision,
            mutationQuietMs: payload.mutationQuietMs,
            readyState: payload.readyState
          }
        };
      }
      this.cleanupBackgroundCommand(commandId);
      return {
        status: payload.status === "succeeded" ? "ready" : "error",
        commandId,
        diagnostics: { reason: "observe_result_without_waiter", payloadStatus: payload.status }
      };
    }
    if (payload.status !== "succeeded" || !payload.snapshot) {
      const result: BrowserPerceptionObserveResult = {
        status: payload.status === "cancelled" ? "cancelled" : payload.status === "expired" ? "timeout" : "error",
        commandId,
        ack: pending.ack,
        wait: { waitedMs: Date.now() - Date.parse(pending.command.createdAt), timeoutMs: Date.parse(pending.command.deadlineAt) - Date.parse(pending.command.createdAt) },
        diagnostics: {
          reason: "extension_observe_failed",
          payloadStatus: payload.status,
          error: payload.error,
          metadata: payload.metadata
        },
        userRecovery: payload.error
      };
      this.cleanupBackgroundCommand(commandId);
      this.resolvePending(commandId, result);
      return result;
    }

    const snapshot = input.providers.setDomSnapshot(payload.snapshot);
    const context = this.ingestProviderSnapshot({
      providers: input.providers,
      bridgeStatus: input.bridgeStatus,
      reason: pending.request.reason
    });
    const retry = this.retryPendingObserveIfContextNotReady({
      pending,
      context,
      bridgeStatus: input.bridgeStatus,
      commandId
    });
    if (retry) {
      return retry;
    }
    const result: BrowserPerceptionObserveResult = {
      status: context?.freshness === "settling" ? "settling_ready" : "ready",
      context,
      commandId,
      ack: pending.ack,
      wait: { waitedMs: Date.now() - Date.parse(pending.command.createdAt), timeoutMs: Date.parse(pending.command.deadlineAt) - Date.parse(pending.command.createdAt) },
      diagnostics: {
        reason: "extension_observe_succeeded",
        url: snapshot.url,
        title: snapshot.title,
        mutationRevision: payload.mutationRevision,
        mutationQuietMs: payload.mutationQuietMs,
        readyState: payload.readyState,
        bridgeLatencyTrace: payload.metadata?.latencyTrace
      }
    };
    this.cleanupBackgroundCommand(commandId);
    const sourceKey = input.bridgeStatus ? readBridgeSourceKey(input.bridgeStatus) : undefined;
    if (sourceKey) {
      this.dropQueuedBackgroundCommandsForSource(sourceKey);
    }
    this.resolvePending(commandId, result);
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

  private retryPendingObserveIfContextNotReady(input: {
    pending: PendingObserve;
    context: PreparedBrowserViewContext | undefined;
    bridgeStatus?: BrowserExtensionBridgeStatus;
    commandId: string;
  }): BrowserPerceptionObserveResult | undefined {
    if (!input.context) {
      return undefined;
    }
    const request = normalizeObserveRequest(input.pending.request);
    if (contextSatisfiesFreshness({
      context: input.context,
      requiredFreshness: request.requiredFreshness,
      maxAgeMs: request.maxAgeMs,
      allowSettlingForRead: request.allowSettlingForRead,
      minCapturedAt: input.bridgeStatus?.connected && input.bridgeStatus.activeTab?.permission === "allowed"
        ? request.minCapturedAt
        : undefined
    })) {
      return undefined;
    }

    const now = Date.now();
    const deadlineAt = Date.parse(input.pending.command.deadlineAt);
    const remainingMs = Number.isFinite(deadlineAt) ? Math.max(0, deadlineAt - now) : 0;
    const minimumRetryMs = Math.max(150, request.settleQuietMs);
    if (!input.bridgeStatus || remainingMs <= minimumRetryMs) {
      const result: BrowserPerceptionObserveResult = {
        status: "blocked",
        commandId: input.commandId,
        ack: input.pending.ack,
        wait: {
          waitedMs: Date.now() - Date.parse(input.pending.command.createdAt),
          timeoutMs: Date.parse(input.pending.command.deadlineAt) - Date.parse(input.pending.command.createdAt)
        },
        diagnostics: {
          reason: "observe_result_did_not_satisfy_freshness",
          requestId: request.requestId,
          requiredFreshness: request.requiredFreshness,
          actionRisk: request.actionRisk,
          contextFreshness: input.context.freshness,
          contextStability: input.context.stability,
          mutationRevision: input.context.mutationRevision,
          routeKey: input.context.routeKey,
          remainingMs
        },
        userRecovery: "Wait for the page to finish updating, then retry the Browser Action."
      };
      this.cleanupBackgroundCommand(input.commandId);
      this.resolvePending(input.commandId, result);
      return result;
    }

    const retryRequest: RequiredObserveRequest = {
      ...request,
      reason: "retry",
      timeoutMs: remainingMs
    };
    const previousAck = input.pending.ack;
    const retryCommand = this.createObserveCommand({ request: retryRequest, bridgeStatus: input.bridgeStatus });
    clearTimeout(input.pending.timer);
    this.pending.delete(input.commandId);
    input.pending.command = retryCommand;
    input.pending.request = retryRequest;
    delete input.pending.ack;
    input.pending.timer = setTimeout(() => {
      this.pending.delete(retryCommand.commandId);
      input.pending.resolve({
        status: "timeout",
        commandId: retryCommand.commandId,
        wait: {
          waitedMs: Date.now() - Date.parse(retryCommand.createdAt),
          timeoutMs: retryRequest.timeoutMs
        },
        diagnostics: {
          reason: "observe_retry_timeout",
          requestId: retryRequest.requestId,
          previousCommandId: input.commandId
        }
      });
    }, retryRequest.timeoutMs);
    this.pending.set(retryCommand.commandId, input.pending);
    this.pendingCommands.push(retryCommand);
    this.cleanupBackgroundCommand(input.commandId);
    return {
      status: "blocked",
      commandId: input.commandId,
      ack: previousAck,
      diagnostics: {
        reason: "observe_result_requeued_for_stability",
        requestId: request.requestId,
        retryCommandId: retryCommand.commandId,
        requiredFreshness: request.requiredFreshness,
        actionRisk: request.actionRisk,
        contextFreshness: input.context.freshness,
        contextStability: input.context.stability,
        mutationRevision: input.context.mutationRevision,
        routeKey: input.context.routeKey,
        remainingMs
      }
    };
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

  private hasKnownObserveCommand(commandId: string): boolean {
    if (this.pending.has(commandId)) {
      return true;
    }
    const now = Date.now();
    this.cleanupExpiredBackgroundCommands(now);
    const queued = this.pendingCommands.some((command) => command.commandId === commandId && Date.parse(command.deadlineAt) > now);
    const background = this.backgroundSourceByCommandId.get(commandId);
    return queued || Boolean(background && background.deadlineAt > now);
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
